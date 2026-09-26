import { createHash, randomUUID } from 'node:crypto';
import admin, { adminDb } from '@/lib/firebase-admin';
import { isKoperasiAdminConfigured, koperasiAdminDb } from '@/lib/koperasi-admin';
import { isConvertedAway } from '@/lib/employeeConversion';
import {
  bankDetailsDiffer, diffKoperasiMember, employeeLinkedToMember, hasSakuBank,
  KOPERASI_EDIT_FIELDS, koperasiEmployeeActive, koperasiMemberSnapshot,
  mirroredStatus, parseKoperasiMemberEdit, sakuBankDetails, validateKoperasiMemberEdit,
  type KoperasiEmployeeCollection, type KoperasiMember, type KoperasiMemberSnapshot,
} from '@/lib/koperasiMembers';
import { buildFinancialAuditRecord, newFinancialAuditRef, type FinancialAuditInput } from './audit';
import { HttpError, type AuthenticatedProfile } from './auth';

const COLLECTIONS: readonly KoperasiEmployeeCollection[] = ['Employees_Loyalis', 'Employees_BlueCollar'];
type Data = Record<string, unknown>;

export function requireKoperasiAdmin() {
  if (!isKoperasiAdminConfigured()) throw new HttpError(503, 'Kredensial Koperasi belum dikonfigurasi di server.');
}
export function memberCommandBody(value: unknown): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Payload tidak valid.');
  return value as Data;
}
function documentId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new HttpError(400, `${label} tidak valid.`);
  return value;
}
function requestId(body: Data): string {
  const id = body.requestId ?? randomUUID();
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new HttpError(400, 'requestId tidak valid.');
  return id;
}
function note(body: Data): string {
  if (body.note !== undefined && typeof body.note !== 'string') throw new HttpError(400, 'Catatan tidak valid.');
  const value = String(body.note || '').trim();
  if (value.length > 500) throw new HttpError(400, 'Catatan maksimal 500 karakter.');
  return value;
}
function employeeCollection(value: unknown): KoperasiEmployeeCollection {
  if (!(COLLECTIONS as readonly unknown[]).includes(value)) throw new HttpError(400, 'Koleksi pegawai tidak valid.');
  return value as KoperasiEmployeeCollection;
}
function operation(actor: AuthenticatedProfile, id: string, command: Data) {
  return {
    ref: adminDb.collection('FinancialIdempotencyKeys').doc(`${actor.uid}__${id}`),
    hash: createHash('sha256').update(JSON.stringify(command)).digest('hex'),
  };
}
type Operation = ReturnType<typeof operation>;
function previousResult(snapshot: FirebaseFirestore.DocumentSnapshot, op: Operation): Data | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data()!;
  if (data.requestHash !== op.hash) throw new HttpError(409, 'requestId sudah digunakan untuk perintah berbeda.');
  if (data.state === 'pending') return null;
  return { ...data.result, idempotent: true };
}

/** Reserve the command before crossing projects. A pending receipt is resumed,
 * never returned as success; it also preserves bank before-values after a lost
 * commit response and blocks concurrent reuse of an id for a different command. */
async function prepareOperation<T extends Data>(op: Operation, intent: T): Promise<{ intent: T; completed: Data | null }> {
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(op.ref);
    const completed = previousResult(snapshot, op);
    if (completed) return { intent, completed };
    if (snapshot.exists) return { intent: snapshot.data()!.intent as T, completed: null };
    transaction.create(op.ref, { requestHash: op.hash, state: 'pending', intent,
      createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return { intent, completed: null };
  });
}
async function finishOperation(actor: AuthenticatedProfile, op: Operation, audit: FinancialAuditInput, result: Data) {
  return adminDb.runTransaction(async transaction => {
    const previous = previousResult(await transaction.get(op.ref), op);
    if (previous) return previous;
    transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, audit));
    transaction.set(op.ref, {
      requestHash: op.hash, entityType: audit.entityType, entityId: audit.entityId,
      state: 'completed', result, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ...result, idempotent: false };
  });
}
async function loadMember(memberId: string): Promise<KoperasiMember> {
  const snapshot = await koperasiAdminDb().collection('users').doc(memberId).get();
  if (!snapshot.exists) throw new HttpError(404, 'Anggota Koperasi tidak ditemukan.');
  return { ...snapshot.data(), id: snapshot.id };
}
function expectedSnapshot(value: unknown): KoperasiMemberSnapshot {
  const data = memberCommandBody(value);
  for (const field of KOPERASI_EDIT_FIELDS) {
    if (!Object.hasOwn(data, field) || (data[field] !== null && typeof data[field] !== (field.startsWith('iuran') ? 'number' : 'string'))) {
      throw new HttpError(400, 'Snapshot expected tidak lengkap. Muat ulang data anggota.');
    }
  }
  return koperasiMemberSnapshot(data);
}

export async function editKoperasiMember(actor: AuthenticatedProfile, body: Data) {
  requireKoperasiAdmin();
  const memberId = documentId(body.memberId, 'ID anggota');
  const id = requestId(body);
  const input = parseKoperasiMemberEdit(body.input);
  const expected = expectedSnapshot(body.expected);
  const errors = validateKoperasiMemberEdit(input, { paymentStatus: expected.paymentStatus as string | null });
  if (Object.keys(errors).length) throw new HttpError(400, Object.values(errors)[0]!);
  const after = koperasiMemberSnapshot({ ...input, status: mirroredStatus(input.membershipStatus) });
  const op = operation(actor, id, { action: 'edit', memberId, input, expected });
  const replay = previousResult(await op.ref.get(), op);
  if (replay) return replay;

  const prepared = await prepareOperation(op, { memberId, expected, after });
  if (prepared.completed) return prepared.completed;

  const outcome = await koperasiAdminDb().runTransaction(async transaction => {
    const ref = koperasiAdminDb().collection('users').doc(memberId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpError(404, 'Anggota Koperasi tidak ditemukan.');
    const before = koperasiMemberSnapshot(snapshot.data()!);
    // A retry after a lost response (or SAKU audit outage) does not reapply the write.
    if (JSON.stringify(before) === JSON.stringify(after)) return { before: expected, alreadyApplied: true };
    if (JSON.stringify(before) !== JSON.stringify(expected)) throw new HttpError(409, 'Data sudah diubah, muat ulang data anggota.');
    transaction.update(ref, {
      ...after, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: `internal-bak:${actor.uid}`,
    });
    return { before, alreadyApplied: false };
  });
  return finishOperation(actor, op, {
    action: 'KOPERASI_MEMBER_UPDATED', entityType: 'KoperasiMember', entityId: memberId,
    requestId: id, reason: input.note, before: outcome.before, after,
    metadata: { changes: diffKoperasiMember(outcome.before, after), recoveredFromExpected: outcome.alreadyApplied },
  }, { memberId });
}

/** Queries both identifiers, including legacy links with just one field. */
async function memberHolders(transaction: FirebaseFirestore.Transaction, member: KoperasiMember) {
  const snapshots = await Promise.all(COLLECTIONS.flatMap(collection => [
    transaction.get(adminDb.collection(collection).where('koperasiAuthUid', '==', member.uid || member.id)),
    transaction.get(adminDb.collection(collection).where('koperasiUserId', '==', member.id)),
  ]));
  const holders = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const snapshot of snapshots) for (const doc of snapshot.docs) {
    // Historical Pekarya links remain for the final pre-conversion slip lock.
    if (!isConvertedAway(doc.data())) holders.set(doc.ref.path, doc);
  }
  return [...holders.values()];
}

export async function linkKoperasiMember(actor: AuthenticatedProfile, body: Data) {
  requireKoperasiAdmin();
  if (body.action !== 'link' && body.action !== 'unlink') throw new HttpError(400, 'Tindakan tautan tidak valid.');
  const action = body.action;
  const memberId = documentId(body.memberId, 'ID anggota');
  const employeeId = documentId(body.employeeId, 'ID pegawai');
  const collection = employeeCollection(body.employeeCollection);
  const expectedId = body.expectedEmployeeId === null ? null : documentId(body.expectedEmployeeId, 'Tautan sebelumnya');
  const expectedCollection = expectedId ? employeeCollection(body.expectedEmployeeCollection) : null;
  const id = requestId(body);
  const reason = note(body);
  const op = operation(actor, id, { action, memberId, employeeId, collection, expectedId, expectedCollection, reason });
  // Replay before re-reading Koperasi: the earlier result is authoritative.
  let result = previousResult(await op.ref.get(), op);
  if (!result) {
    const member = await loadMember(memberId);
    result = await adminDb.runTransaction(async transaction => {
      const previous = previousResult(await transaction.get(op.ref), op);
      if (previous) return previous;
      const targetRef = adminDb.collection(collection).doc(employeeId);
      const [target, holders] = await Promise.all([transaction.get(targetRef), memberHolders(transaction, member)]);
      if (!target.exists) throw new HttpError(404, 'Pegawai tidak ditemukan.');
      const employee = target.data()!;
      if (isConvertedAway(employee)) throw new HttpError(409, 'Pekarya sudah dialihkan ke Loyalis. Gunakan data Loyalis.');
      const holder = holders[0];
      if (holders.length > 1 || (holder?.id || null) !== expectedId || (holder?.ref.parent.id || null) !== expectedCollection) {
        throw new HttpError(409, 'Tautan anggota sudah berubah atau sudah dipegang pegawai lain. Muat ulang.');
      }
      const now = admin.firestore.FieldValue.serverTimestamp();
      const before = holder ? { employeeId: holder.id, collection: holder.ref.parent.id,
        koperasiAuthUid: holder.data().koperasiAuthUid || null, koperasiUserId: holder.data().koperasiUserId || null } : null;
      if (action === 'link') {
        if (!koperasiEmployeeActive(employee, collection)) throw new HttpError(409, 'Hanya pegawai aktif yang dapat ditautkan.');
        if ((employee.koperasiAuthUid && employee.koperasiAuthUid !== (member.uid || member.id)) ||
            (employee.koperasiUserId && employee.koperasiUserId !== member.id)) {
          throw new HttpError(409, 'Pegawai sudah tertaut ke anggota Koperasi lain.');
        }
        if (holder && holder.ref.path !== targetRef.path) transaction.update(holder.ref, {
          koperasiAuthUid: null, koperasiUserId: null, updatedAt: now, updatedBy: actor.uid,
        });
        transaction.update(targetRef, {
          koperasiAuthUid: member.uid || member.id, koperasiUserId: member.id, updatedAt: now, updatedBy: actor.uid,
        });
      } else {
        if (!holder || holder.ref.path !== targetRef.path || !employeeLinkedToMember(member, employee)) {
          throw new HttpError(409, 'Tautan tidak lagi sesuai. Muat ulang data anggota.');
        }
        transaction.update(targetRef, { koperasiAuthUid: null, koperasiUserId: null, updatedAt: now, updatedBy: actor.uid });
      }
      const saved = { memberId, employeeId: action === 'link' ? employeeId : null, collection,
        bankSyncPending: action === 'link' };
      transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
        action: action === 'link' ? 'KOPERASI_MEMBER_LINKED' : 'KOPERASI_MEMBER_UNLINKED',
        entityType: 'KoperasiMember', entityId: memberId, requestId: id, reason, before,
        after: action === 'link' ? { employeeId, collection, koperasiAuthUid: member.uid || member.id, koperasiUserId: member.id } : null,
      }));
      transaction.create(op.ref, { requestHash: op.hash, entityType: 'KoperasiMember', entityId: memberId,
        result: saved, createdAt: now });
      return { ...saved, idempotent: false };
    });
  }
  // A link is committed even if Koperasi is temporarily unavailable. A replay
  // resumes this step, and the UI can also retry through the bank-sync dialog.
  if (action === 'link' && result.bankSyncPending) {
    try {
      const sync = await syncKoperasiBanks(actor, { memberIds: [memberId], requestId: `${id.slice(0, 84)}_bank_${op.hash.slice(0, 32)}` });
      const warning = (sync.skipped as unknown[])?.length ? 'Rekening SAKU kosong; rekening Koperasi belum disamakan.' : null;
      result = { ...result, bankSyncPending: false, warning };
      await op.ref.update({ result });
    } catch {
      result = { ...result, warning: 'Tautan tersimpan. Rekening Koperasi belum tersinkron; coba Samakan rekening.' };
    }
  }
  return result;
}

export async function syncKoperasiBanks(actor: AuthenticatedProfile, body: Data) {
  requireKoperasiAdmin();
  const id = requestId(body);
  if ('bankDetails' in body || 'bank' in body || 'nomorRekening' in body) throw new HttpError(400, 'Rekening hanya boleh berasal dari data SAKU.');
  const single = typeof body.employeeId === 'string';
  if (single === Array.isArray(body.memberIds)) throw new HttpError(400, 'Pilih employeeId atau memberIds.');
  const employeeId = single ? documentId(body.employeeId, 'ID pegawai') : null;
  const memberIds = single ? [] : [...new Set((body.memberIds as unknown[]).map(value => documentId(value, 'ID anggota')))].sort();
  if (!single && (!memberIds.length || memberIds.length > 400)) throw new HttpError(400, 'Pilih 1–400 anggota untuk disamakan.');
  const op = operation(actor, id, { action: 'bank-sync', employeeId, memberIds });
  const replay = previousResult(await op.ref.get(), op);
  if (replay) return replay;

  const snapshots = await Promise.all(COLLECTIONS.map(collection => adminDb.collection(collection).get()));
  const employees = snapshots.flatMap(snapshot => snapshot.docs).filter(doc => !isConvertedAway(doc.data()));
  const members: KoperasiMember[] = [];
  if (employeeId) {
    const targets = employees.filter(doc => doc.id === employeeId);
    if (targets.length !== 1) throw new HttpError(404, 'Pegawai aktif dalam sistem tidak ditemukan secara unik.');
    const employee = targets[0].data();
    if (employee.koperasiUserId) members.push(await loadMember(employee.koperasiUserId));
    else if (employee.koperasiAuthUid) {
      const byUid = await koperasiAdminDb().collection('users').where('uid', '==', employee.koperasiAuthUid).get();
      if (byUid.size > 1) throw new HttpError(409, 'UID Koperasi tidak unik. Periksa tautan anggota.');
      members.push(byUid.empty ? await loadMember(employee.koperasiAuthUid) : { ...byUid.docs[0].data(), id: byUid.docs[0].id });
    }
  } else {
    members.push(...await Promise.all(memberIds.map(loadMember)));
  }

  const changes: Array<{ memberId: string; employeeId: string; collection: KoperasiEmployeeCollection; before: KoperasiMember['bankDetails']; after: ReturnType<typeof sakuBankDetails> }> = [];
  const skipped: Data[] = [];
  for (const member of members) {
    const holders = employees.filter(doc => employeeLinkedToMember(member, doc.data()));
    if (holders.length !== 1 || (employeeId && holders[0].id !== employeeId)) {
      skipped.push({ memberId: member.id, reason: 'Tautan pegawai tidak unik atau tidak ditemukan.' });
      continue;
    }
    const holder = holders[0];
    const bank = sakuBankDetails(holder.data(), holder.ref.parent.id as KoperasiEmployeeCollection);
    if (!hasSakuBank(bank)) {
      skipped.push({ memberId: member.id, reason: 'Rekening SAKU kosong.' });
      continue;
    }
    if (!bankDetailsDiffer(member.bankDetails, bank)) continue;
    changes.push({ memberId: member.id, employeeId: holder.id, collection: holder.ref.parent.id as KoperasiEmployeeCollection,
      before: member.bankDetails || null, after: bank });
  }
  const prepared = await prepareOperation(op, { changes, skipped });
  if (prepared.completed) return prepared.completed;
  const planned = prepared.intent.changes;
  const batch = koperasiAdminDb().batch();
  let writes = 0;
  // A frozen server-derived intent survives a lost response. Recheck identity,
  // source bank and target version before applying it, so an old retry cannot
  // copy a bank belonging to a newer/different employee link.
  if (planned.length) {
    const currentMembers = await koperasiAdminDb().getAll(...planned.map(change => koperasiAdminDb().collection('users').doc(change.memberId)));
    for (const [index, snapshot] of currentMembers.entries()) {
      const change = planned[index];
      if (!snapshot.exists) throw new HttpError(409, 'Anggota sudah berubah, muat ulang rekening.');
      const currentMember: KoperasiMember = { ...snapshot.data(), id: snapshot.id };
      const holders = employees.filter(doc => employeeLinkedToMember(currentMember, doc.data()));
      const source = holders[0];
      if (holders.length !== 1 || source.id !== change.employeeId || source.ref.parent.id !== change.collection) {
        throw new HttpError(409, 'Tautan sudah berubah, muat ulang rekening.');
      }
      if (!bankDetailsDiffer(currentMember.bankDetails, change.after)) continue;
      if (bankDetailsDiffer(sakuBankDetails(source.data(), change.collection), change.after) ||
        bankDetailsDiffer(currentMember.bankDetails, { bank: change.before?.bank || '', nomorRekening: change.before?.nomorRekening || '' })) {
        throw new HttpError(409, 'Rekening sudah diubah, muat ulang dan mulai sinkronisasi baru.');
      }
      batch.update(snapshot.ref, { bankDetails: change.after }, { lastUpdateTime: snapshot.updateTime! });
      writes += 1;
    }
  }
  if (writes) {
    try { await batch.commit(); }
    catch (error) {
      if ((error as { code?: number }).code === 9) throw new HttpError(409, 'Data sudah diubah, muat ulang rekening.');
      throw error;
    }
  }
  return finishOperation(actor, op, {
    action: 'KOPERASI_BANK_SYNCED', entityType: 'KoperasiMember', entityId: employeeId || memberIds.join(',').slice(0, 1000),
    requestId: id, reason: 'Rekening mengikuti data pegawai SAKU.', before: planned.map(change => ({ memberId: change.memberId, bankDetails: change.before })),
    after: planned.map(change => ({ memberId: change.memberId, bankDetails: change.after })),
    metadata: { members: planned, skipped: prepared.intent.skipped },
  }, { synced: planned.length, skipped: prepared.intent.skipped });
}
