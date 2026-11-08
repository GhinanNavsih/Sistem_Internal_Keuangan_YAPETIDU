import { randomUUID, createHash } from 'node:crypto';
import admin, { adminDb } from '@/lib/firebase-admin';
import { koperasiAdminAuth, koperasiAdminDb } from '@/lib/koperasi-admin';
import { koperasiEmployeeActive, sakuBankDetails, toKoperasiEmployee, type KoperasiEmployeeCollection } from '@/lib/koperasiMembers';
import { type AuthenticatedProfile, HttpError } from './auth';
import { documentId, finishOperation, operation, prepareOperation, previousResult, requestId, requireKoperasiAdmin } from './koperasiMembers';

type Data = Record<string, unknown>;
const collections = ['Employees_Loyalis', 'Employees_BlueCollar'] as const;
function employeeCollection(value: unknown): KoperasiEmployeeCollection {
  if (!collections.includes(value as KoperasiEmployeeCollection)) throw new HttpError(400, 'Koleksi pegawai tidak valid.');
  return value as KoperasiEmployeeCollection;
}
function emailAddress(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, 'Isi email Koperasi yang valid.');
  return email;
}
export async function currentKoperasiEnrollmentPeriod() {
  const periods = await adminDb.collection('PayrollPeriods').get();
  const valid = periods.docs.filter(doc => /^\d{4}-\d{2}$/.test(doc.id));
  const lastClosed = valid.filter(doc => doc.data().attendanceStatus === 'closed').map(doc => doc.id).sort().at(-1) || '';
  const open = valid.filter(doc => doc.id > lastClosed && doc.data().attendanceStatus !== 'closed' && !doc.data().payrollRosterSeal).sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!open) throw new HttpError(409, 'Belum ada periode payroll terbuka untuk pendaftaran Koperasi.');
  return open.id;
}
async function authByEmail(email: string) {
  try { return await koperasiAdminAuth().getUserByEmail(email); }
  catch (error) { if ((error as { code?: string }).code === 'auth/user-not-found') return null; throw error; }
}
async function enrollmentSource(body: Data) {
  const collection = employeeCollection(body.employeeCollection);
  const employeeId = documentId(body.employeeId, 'ID pegawai');
  const snapshot = await adminDb.collection(collection).doc(employeeId).get();
  if (!snapshot.exists) throw new HttpError(404, 'Pegawai tidak ditemukan.');
  const employee = toKoperasiEmployee(employeeId, collection, snapshot.data()!);
  if (!koperasiEmployeeActive(employee, collection)) throw new HttpError(409, 'Hanya pegawai aktif yang dapat didaftarkan.');
  if (!employee.name.trim()) throw new HttpError(409, 'Nama pegawai belum tersedia.');
  const email = emailAddress(body.email || employee.email);
  const identity = await authByEmail(email);
  const users = await koperasiAdminDb().collection('users').get();
  const employeeNik = String(employee.nik || '').replace(/\D/g, '');
  const matches = users.docs.filter(doc => {
    const member = doc.data();
    return doc.id === employee.koperasiUserId || (employee.koperasiAuthUid && (member.uid || doc.id) === employee.koperasiAuthUid) ||
      String(member.email || '').trim().toLowerCase() === email || (identity && member.uid === identity.uid) ||
      (employeeNik && String(member.nik || '').replace(/\D/g, '') === employeeNik);
  });
  return { collection, employeeId, employee, email, identity, matches };
}
export async function koperasiEnrollmentPreview(body: Data) {
  requireKoperasiAdmin();
  const firstPayrollPeriod = await currentKoperasiEnrollmentPeriod();
  if (!body.employeeId) return { firstPayrollPeriod, matches: [], authExists: false };
  const source = await enrollmentSource(body);
  return { firstPayrollPeriod, authExists: Boolean(source.identity), matches: source.matches.map(doc => ({ id: doc.id, nama: doc.data().nama || '', email: doc.data().email || '', role: doc.data().role || '', membershipStatus: doc.data().membershipStatus ?? doc.data().status ?? '' })) };
}

/** Password is used only by Auth.createUser. Durable intents contain no credentials. */
export async function enrollKoperasiEmployee(actor: AuthenticatedProfile, body: Data) {
  requireKoperasiAdmin();
  const id = requestId(body);
  const collection = employeeCollection(body.employeeCollection);
  const employeeId = documentId(body.employeeId, 'ID pegawai');
  const email = emailAddress(body.email);
  const paymentStatus = String(body.paymentStatus || '');
  if (!['Payroll Deduction', 'Yayasan Subsidy'].includes(paymentStatus)) throw new HttpError(400, 'Pilih Potong Gaji atau Subsidi Yayasan.');
  const existingMemberId = body.existingMemberId ? documentId(body.existingMemberId, 'ID anggota') : null;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > 500) throw new HttpError(400, 'Catatan maksimal 500 karakter.');
  const command = { action: 'enroll', collection, employeeId, email, paymentStatus, existingMemberId, note };
  const op = operation(actor, id, command);
  const replay = previousResult(await op.ref.get(), op);
  if (replay) return replay;
  const reservation = adminDb.collection('KoperasiEnrollments').doc(`${collection}__${employeeId}`);
  const prior = await reservation.get();
  const commandHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  if (prior.exists && prior.data()!.commandHash !== commandHash) throw new HttpError(409, 'Pegawai sudah terdaftar atau memiliki pendaftaran yang perlu diselesaikan.');
  if (prior.data()?.state === 'completed') return { ...prior.data()!.result, idempotent: true };
  let intent = prior.data()?.intent;
  if (!intent) {
    const source = await enrollmentSource(body);
    if (source.matches.length > 1) throw new HttpError(409, 'Identitas cocok dengan beberapa akun Koperasi. Perbaiki data ganda terlebih dahulu.');
    if (source.matches.length && source.matches[0].id !== existingMemberId) throw new HttpError(409, 'Akun Koperasi sudah ada. Pilih akun tersebut untuk ditautkan dan diaktifkan.');
    if (existingMemberId && source.matches[0]?.id !== existingMemberId) throw new HttpError(409, 'Akun yang dipilih tidak cocok dengan identitas pegawai.');
    const member = source.matches[0]?.data();
    if (source.employee.koperasiUserId || source.employee.koperasiAuthUid) {
      if (!existingMemberId || source.employee.koperasiUserId && source.employee.koperasiUserId !== existingMemberId) throw new HttpError(409, 'Pegawai sudah tertaut ke akun Koperasi.');
      if ((member?.membershipStatus ?? member?.status) === 'approved') throw new HttpError(409, 'Pegawai sudah menjadi anggota aktif.');
    }
    if (member?.uid && source.identity && member.uid !== source.identity.uid) throw new HttpError(409, 'Email dan UID Koperasi tidak sesuai.');
    if (member?.email && String(member.email).toLowerCase() !== email) throw new HttpError(409, 'Gunakan email akun Koperasi yang sudah ada.');
    let identity = source.identity;
    if (member?.uid) {
      try { identity = await koperasiAdminAuth().getUser(member.uid); }
      catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error; }
    }
    if (identity?.disabled) throw new HttpError(409, 'Akun Koperasi dinonaktifkan. Aktifkan akun sebelum mendaftarkan pegawai.');
    if (!identity && (typeof body.initialPassword !== 'string' || body.initialPassword.length < 6 || body.initialPassword.length > 128)) throw new HttpError(400, 'Password awal harus berisi 6–128 karakter.');
    const firstPayrollPeriod = await currentKoperasiEnrollmentPeriod();
    const uid = identity?.uid || member?.uid || randomUUID();
    intent = { collection, employeeId, email, uid, memberId: existingMemberId || uid, existing: Boolean(member),
      firstPayrollPeriod, previousAuthUid: source.employee.koperasiAuthUid || null, previousMemberUid: member?.uid || existingMemberId || uid, name: source.employee.name, nik: source.employee.nik || '',
      phone: String(source.employee.phoneNumber || source.employee.personal_info?.phone || ''),
      unit: source.employee.employment_profile?.department_unit || source.employee.employment?.jobCategory || '',
      bankDetails: sakuBankDetails(source.employee, collection), paymentStatus,
      originalStatus: member?.membershipStatus ?? member?.status ?? null };
  }
  const prepared = await prepareOperation(op, intent);
  if (prepared.completed) return prepared.completed;
  intent = prepared.intent;
  // Reserve both employee and member in SAKU, including cross-collection holders.
  await adminDb.runTransaction(async transaction => {
    const [claim, employee, period, memberClaim, ...holders] = await Promise.all([
      transaction.get(reservation), transaction.get(adminDb.collection(collection).doc(employeeId)),
      transaction.get(adminDb.doc(`PayrollPeriods/${intent.firstPayrollPeriod}`)),
      transaction.get(adminDb.collection('KoperasiMemberEnrollments').doc(intent.memberId)),
      ...collections.flatMap(name => [transaction.get(adminDb.collection(name).where('koperasiUserId', '==', intent.memberId)), transaction.get(adminDb.collection(name).where('koperasiAuthUid', '==', intent.uid)), transaction.get(adminDb.collection(name).where('koperasiAuthUid', '==', intent.previousMemberUid))]),
    ]);
    if (claim.exists && claim.data()!.commandHash !== commandHash) throw new HttpError(409, 'Pendaftaran pegawai sudah berubah.');
    if (claim.exists && claim.data()!.intent.uid !== intent.uid) throw new HttpError(409, 'Pendaftaran sedang diproses. Muat ulang dan coba lagi.');
    if (memberClaim.exists && memberClaim.data()!.state === 'pending' && memberClaim.data()!.employeePath !== employee.ref.path) throw new HttpError(409, 'Akun sedang didaftarkan untuk pegawai lain.');
    if (holders.some(snapshot => snapshot.docs.some(doc => doc.ref.path !== employee.ref.path && !doc.data().conversion?.toEmployeeId))) throw new HttpError(409, 'Akun Koperasi sudah tertaut ke pegawai lain.');
    if (!employee.exists || !koperasiEmployeeActive(employee.data()!, collection)) throw new HttpError(409, 'Status pegawai sudah berubah.');
    if ((employee.data()!.koperasiUserId && employee.data()!.koperasiUserId !== intent.memberId) || (employee.data()!.koperasiAuthUid && employee.data()!.koperasiAuthUid !== intent.uid && employee.data()!.koperasiAuthUid !== intent.previousAuthUid)) throw new HttpError(409, 'Tautan pegawai sudah berubah.');
    if (claim.data()?.state === 'completed') return;
    if (!period.exists || period.data()!.attendanceStatus === 'closed' || period.data()!.payrollRosterSeal) throw new HttpError(409, 'Periode payroll pendaftaran sudah ditutup. Selesaikan pendaftaran sebelum menutup periode.');
    transaction.set(reservation, { commandHash, intent, firstPayrollPeriod: intent.firstPayrollPeriod, state: 'pending', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    transaction.set(adminDb.collection('KoperasiMemberEnrollments').doc(intent.memberId), { employeePath: employee.ref.path, state: 'pending' });
    transaction.update(period.ref, { koperasiEnrollmentRevision: Number(period.data()!.koperasiEnrollmentRevision || 0) + 1 });
  });
  let identity;
  try { identity = await koperasiAdminAuth().getUser(intent.uid); }
  catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    if (typeof body.initialPassword !== 'string' || body.initialPassword.length < 6) throw new HttpError(400, 'Isi kembali password awal untuk melanjutkan pendaftaran.');
    try { identity = await koperasiAdminAuth().createUser({ uid: intent.uid, email: intent.email, password: body.initialPassword, displayName: intent.name }); }
    catch (createError) {
      if ((createError as { code?: string }).code !== 'auth/uid-already-exists') throw new HttpError(409, 'Akun Koperasi belum dapat dibuat. Periksa email dan coba lagi.');
      identity = await koperasiAdminAuth().getUser(intent.uid);
    }
  }
  if (identity.email?.toLowerCase() !== intent.email || identity.disabled) throw new HttpError(409, 'Identitas akun Koperasi berubah.');
  const koperasi = koperasiAdminDb();
  const memberRef = koperasi.collection('users').doc(intent.memberId);
  await koperasi.runTransaction(async transaction => {
    const [snapshot, counter, allUsers] = await Promise.all([
      transaction.get(memberRef), transaction.get(koperasi.doc('counters/memberNumber')),
      transaction.get(koperasi.collection('users')),
    ]);
    if (snapshot.exists && !intent.existing && snapshot.data()!.sakuEnrollmentKey !== reservation.id) throw new HttpError(409, 'Akun anggota sudah dibuat melalui proses lain.');
    if (snapshot.data()?.sakuEnrollmentKey === reservation.id) return;
    if (allUsers.docs.some(doc => doc.id !== intent.memberId && (doc.data().uid === intent.uid || String(doc.data().email || '').toLowerCase() === intent.email || intent.nik.replace(/\D/g, '') && String(doc.data().nik || '').replace(/\D/g, '') === intent.nik.replace(/\D/g, '')))) throw new HttpError(409, 'Identitas anggota sudah digunakan. Muat ulang data.');
    const year = new Intl.DateTimeFormat('en', { year: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date());
    const maximum = Math.max(0, ...allUsers.docs.map(doc => String(doc.data().nomorAnggota || '')).filter(number => number.startsWith(year)).map(number => Number(number.slice(2)) || 0));
    const next = Math.max(maximum, counter.data()?.year === year ? Number(counter.data()!.sequence || 0) : 0) + 1;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const current = snapshot.data();
    const policy = current?.payrollSavings || { startPeriod: intent.firstPayrollPeriod, initialPeriod: intent.firstPayrollPeriod,
      initialPaid: intent.existing && intent.originalStatus === 'approved' };
    transaction.set(memberRef, { ...(current || { nama: intent.name, email: intent.email, nik: intent.nik, nomorWhatsapp: intent.phone,
      kantor: 'Unipdu', satuanKerja: intent.unit, role: 'Member', nominalTabungan: 0,
      iuranPokok: 250000, iuranWajib: 25000, createdAt: now, registrationDate: new Date().toISOString(), timestamp: Date.now() }),
      uid: intent.uid, nomorAnggota: current?.nomorAnggota || `${year}${String(next).padStart(3, '0')}`,
      bankDetails: intent.bankDetails, payrollSavings: policy, sakuEnrollmentKey: reservation.id,
      // Activation follows SAKU linking. The monthly job skips payrollSavings even while pending.
      membershipStatus: 'Pending', status: 'pending', updatedAt: now, updatedBy: `internal-bak:${actor.uid}` });
    if (!current?.nomorAnggota) transaction.set(koperasi.doc('counters/memberNumber'), { year, sequence: next });
  });
  await adminDb.runTransaction(async transaction => {
    const employeeRef = adminDb.collection(collection).doc(employeeId);
    const [employee, period] = await Promise.all([transaction.get(employeeRef), transaction.get(adminDb.doc(`PayrollPeriods/${intent.firstPayrollPeriod}`))]);
    if (!employee.exists || !koperasiEmployeeActive(employee.data()!, collection) || period.data()?.attendanceStatus === 'closed' || period.data()?.payrollRosterSeal) throw new HttpError(409, 'Pegawai atau periode payroll berubah. Pendaftaran belum diaktifkan.');
    if ((employee.data()!.koperasiUserId && employee.data()!.koperasiUserId !== intent.memberId) || (employee.data()!.koperasiAuthUid && employee.data()!.koperasiAuthUid !== intent.uid && employee.data()!.koperasiAuthUid !== intent.previousAuthUid)) throw new HttpError(409, 'Tautan pegawai berubah.');
    transaction.update(employeeRef, { koperasiUserId: intent.memberId, koperasiAuthUid: intent.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: actor.uid });
  });
  await memberRef.update({ membershipStatus: 'approved', status: 'approved', paymentStatus: intent.paymentStatus });
  const result = { memberId: intent.memberId, uid: intent.uid, firstPayrollPeriod: intent.firstPayrollPeriod, resumed: prior.exists };
  const finished = await finishOperation(actor, op, { action: 'KOPERASI_MEMBER_ENROLLED', entityType: 'KoperasiMember', entityId: intent.memberId,
    requestId: id, reason: note || 'Pendaftaran pegawai oleh Super Admin.', before: intent.existing ? { memberId: intent.memberId, membershipStatus: intent.originalStatus } : null,
    after: { ...result, membershipStatus: 'approved', paymentStatus }, metadata: { employeeId, collection } }, result,
    transaction => {
      transaction.update(reservation, { state: 'completed', result });
      transaction.update(adminDb.collection('KoperasiMemberEnrollments').doc(intent.memberId), { state: 'completed' });
    });
  return finished;
}
