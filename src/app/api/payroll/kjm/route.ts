import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { emptyKjmEdits, kjmAssessmentDate, KJM_RULE_VERSION, KJM_SOURCE_KIND, reviewKjm, type KjmCourse, type KjmEdits, type KjmReview } from '@/lib/payroll/kjm';
import { parseKjmWorkbook } from '@/lib/payroll/kjmWorkbook';
import { kjmHash, loadKjmMaster, parseKjmEdits } from '@/lib/server/kjm';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { assertPeriodAcceptsInput } from '@/lib/server/payrollPeriod';
import { calculatePayrollTotals, validateMoneyFields } from '@/lib/payroll/domain';
import { classifySlipForPropagation, mergeOwnedFields, assertOnlyOwnedChanged } from '@/lib/payroll/slipPropagation';
import { recalculateSlipTaxes } from '@/lib/payroll/payrollTax';
import { vakasiApprovedEarningsForEmployee, vakasiEventNamesForEmployee, vakasiOwnedEarningPredicate } from '@/lib/payroll/vakasiTambahan';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
interface Draft {
  period: string; semester: string; fileName: string; courses: KjmCourse[]; edits: KjmEdits;
  status: 'draft' | 'approved'; revision: number; review: KjmReview; reviewHash: string;
  approvedFromRevision?: number; rateVersion: string; ruleVersion?: string;
}
function validPeriod(value: unknown): string {
  try { kjmAssessmentDate(String(value)); } catch { throw new HttpError(400, 'Periode wajib YYYY-MM.'); }
  return String(value);
}
function validId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new HttpError(400, 'ID impor tidak valid.');
  return value;
}
const reviewHash = (review: KjmReview, version: string) => kjmHash({ review, version, ruleVersion: KJM_RULE_VERSION });
const claimDocId = (semester: string, employeeId: string) => `${semester.replace('/', '')}_${employeeId}`;
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request); requireRole(actor, ['super_admin']);
    const period = validPeriod(request.nextUrl.searchParams.get('period'));
    const master = await loadKjmMaster();
    const id = request.nextUrl.searchParams.get('id');
    if (id) {
      const doc = await adminDb.collection('KjmImports').doc(validId(id)).get();
      if (!doc.exists || doc.data()?.period !== period) throw new HttpError(404, 'Impor tidak ditemukan pada periode ini.');
      return Response.json({ ...master, draft: { id: doc.id, ...doc.data() } });
    }
    const [importsSnap, periodSnap] = await Promise.all([
      adminDb.collection('KjmImports').where('period', '==', period).get(),
      adminDb.collection('PayrollPeriods').doc(period).get(),
    ]);
    const imports = importsSnap.docs.map(d => {
      const r = d.data() as Draft; return { id: d.id, fileName: r.fileName, semester: r.semester, status: r.status, total: r.review.total, revision: r.revision };
    });
    return Response.json({ ...master, imports, closed: periodSnap.data()?.attendanceStatus === 'closed' });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request); requireRole(actor, ['super_admin']);
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      if (Number(request.headers.get('content-length')) > 6_000_000) throw new HttpError(400, 'Maksimum berkas 5 MB.');
      const form = await request.formData();
      const file = form.get('file');
      const period = validPeriod(form.get('period'));
      const semester = String(form.get('semester') || '').trim();
      if (!/^(20\d{2}\/[12]|20\d{2}[12])$/.test(semester)) throw new HttpError(400, 'Semester wajib seperti 2025/1 atau 2025/2.');
      if (!(file instanceof File) || !/\.xlsx$/i.test(file.name) || file.size > 5_000_000 || file.size === 0) throw new HttpError(400, 'Unggah XLSX maksimum 5 MB.');
      let courses: KjmCourse[];
      try { courses = parseKjmWorkbook(Buffer.from(await file.arrayBuffer())); }
      catch (e) { throw new HttpError(400, (e as Error).message); }
      // Source identity ignores workbook formatting, name, output sheets and row ordering.
      const canonical = courses.map(c => [c.nipy, c.program, c.code, c.name, c.kelas, c.sks, c.attendance]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const id = kjmHash(canonical);
      const ref = adminDb.collection('KjmImports').doc(id);
      await adminDb.runTransaction(async tx => {
        const existing = await tx.get(ref);
        if (existing.exists) throw new HttpError(409, `Data mentah ini sudah diimpor pada ${existing.data()?.period}. Buka impor tersebut; jangan membayar ulang.`);
        assertPeriodAcceptsInput((await tx.get(adminDb.collection('PayrollPeriods').doc(period))).data());
        const master = await loadKjmMaster(tx);
        const edits = emptyKjmEdits();
        const review = reviewKjm(courses, edits, master.employees, master.rates, period);
        const draft: Draft = { period, semester, fileName: file.name.slice(0, 180), courses, edits, status: 'draft', revision: 1,
          review, reviewHash: reviewHash(review, master.version), rateVersion: master.version };
        if (Buffer.byteLength(JSON.stringify(draft)) > 850_000) throw new HttpError(400, 'Data impor terlalu besar.');
        tx.create(ref, { ...draft, ruleVersion: KJM_RULE_VERSION, createdBy: actor.uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        tx.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, { action: 'KJM_IMPORT', entityType: 'KjmImports', entityId: id,
          reason: 'Impor data mentah; belum masuk payroll', metadata: { period, semester, sourceRows: courses.length } }));
      });
      return Response.json({ id }, { status: 201 });
    }
    const body = await request.json();
    const id = validId(body.id);
    const action = body.action;
    if (!['save', 'approve', 'revoke', 'delete'].includes(action) || !Number.isSafeInteger(body.revision)) throw new HttpError(400, 'Perintah/revisi tidak valid.');
    const edits = action === 'save' ? parseKjmEdits(body.edits) : null;
    const result = await adminDb.runTransaction(async tx => {
      const ref = adminDb.collection('KjmImports').doc(id);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new HttpError(404, 'Impor tidak ditemukan.');
      const before = snapshot.data() as Draft;
      if (action === 'delete') {
        if (before.revision !== body.revision) throw new HttpError(409, 'Data telah berubah. Muat ulang sebelum menghapus.');
        if (before.status !== 'draft') throw new HttpError(409, 'Impor yang sudah disetujui tidak dapat dihapus. Batalkan persetujuannya terlebih dahulu.');
        assertPeriodAcceptsInput((await tx.get(adminDb.collection('PayrollPeriods').doc(before.period))).data());

        const projectionRef = adminDb.collection('VakasiTambahan').doc(`KJM_${id}`);
        const resultRows = Array.isArray(before.review?.results) ? before.review.results : [];
        const claimRefs = resultRows.flatMap((result) => {
          const employeeId = result?.employee?.id;
          return typeof employeeId === 'string' && employeeId
            ? [adminDb.collection('KjmPaymentClaims').doc(claimDocId(before.semester, employeeId))]
            : [];
        });
        const [projectionSnapshot, ...claimSnapshots] = await tx.getAll(projectionRef, ...claimRefs);
        if (projectionSnapshot.exists) {
          const projection = projectionSnapshot.data() || {};
          if (projection.status === 'approved') throw new HttpError(409, 'Impor masih terhubung ke KJM yang disetujui. Batalkan persetujuannya terlebih dahulu.');
          if (projection.sourceKjmImportId !== id) throw new HttpError(409, 'Proyeksi KJM tidak cocok dengan impor ini. Penghapusan dibatalkan.');
        }
        if (claimSnapshots.some((claim) => claim.exists && claim.data()?.importId !== id)) {
          throw new HttpError(409, 'Klaim pembayaran KJM tidak cocok dengan impor ini. Penghapusan dibatalkan.');
        }
        tx.delete(ref);
        if (projectionSnapshot.exists) tx.delete(projectionRef);
        claimSnapshots.forEach((claim) => { if (claim.exists) tx.delete(claim.ref); });
        tx.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
          action: 'KJM_DELETE', entityType: 'KjmImports', entityId: id,
          reason: 'Admin menghapus impor KJM draft sebelum pembayaran',
          before: { revision: before.revision, status: before.status, period: before.period, semester: before.semester,
            fileName: before.fileName, sourceRows: before.courses.length, reviewHash: before.reviewHash },
          after: null, metadata: { deleted: true, projectionDeleted: projectionSnapshot.exists, claimsDeleted: claimSnapshots.filter((claim) => claim.exists).length },
        }));
        return { id, period: before.period, status: 'deleted' as const, revision: before.revision };
      }
      // Retrying a completed approval cannot create a second earning.
      if (action === 'approve' && before.status === 'approved' && before.approvedFromRevision === body.revision && before.reviewHash === body.reviewHash) {
        return { period: before.period, employeeIds: before.review.results.map(r => r.employee.id), status: before.status, revision: before.revision };
      }
      if (before.revision !== body.revision) throw new HttpError(409, 'Data telah berubah. Muat ulang sebelum melanjutkan.');
      if (before.status === 'approved' && action !== 'revoke') throw new HttpError(409, 'Batalkan persetujuan sebelum mengubah impor.');
      if (before.status !== 'approved' && action === 'revoke') throw new HttpError(409, 'Impor belum disetujui.');
      assertPeriodAcceptsInput((await tx.get(adminDb.collection('PayrollPeriods').doc(before.period))).data());
      const master = await loadKjmMaster(tx);
      const review = action === 'revoke' ? before.review : reviewKjm(before.courses, edits || before.edits, master.employees, master.rates, before.period);
      const hash = action === 'revoke' ? before.reviewHash : reviewHash(review, master.version);
      if (action === 'approve') {
        if (body.confirmed !== true || body.reviewHash !== before.reviewHash || hash !== before.reviewHash) throw new HttpError(409, 'Master/perhitungan berubah atau review belum dikonfirmasi. Simpan ulang dan periksa hasil.');
        if (review.issues.length) throw new HttpError(409, 'Selesaikan semua masalah review sebelum menyetujui.');
        if (review.results.length > 200) throw new HttpError(400, 'Maksimum 200 penerima per impor.');
      }
      const financial = action !== 'save';
      const employeeIds = financial ? review.results.map(r => r.employee.id) : [];
      const claims = employeeIds.map(employeeId => adminDb.collection('KjmPaymentClaims').doc(claimDocId(before.semester, employeeId)));
      const now = admin.firestore.FieldValue.serverTimestamp();
      const eventName = `Kelebihan Jam Mengajar ${before.semester}`;
      const event = {
        sourceKind: KJM_SOURCE_KIND, sourceKjmImportId: id, eventName, period: before.period,
        isEndOfMonth: true, departmentUnit: null, status: action === 'approve' ? 'approved' : 'voided',
        eventWorkers: Object.fromEntries(review.results.filter(r => r.total > 0).map(r => [r.employee.id,
          { employeeName: r.employee.name, payGiven: r.total, employeeCollection: 'Employees_Loyalis' }])),
        ownedEarningLabelsByEmployee: Object.fromEntries(review.results.map(r => [r.employee.id, [eventName]])),
        totalPayout: review.total, revision: before.revision + 1, updatedBy: actor.uid, updatedAt: now,
      };
      const slipWrites: { ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData; changes: unknown }[] = [];
      if (financial && employeeIds.length) {
        const slips = await tx.getAll(...employeeIds.map(employeeId => adminDb.collection('PayrollSlipStates').doc(`${before.period.replace('-', '_')}_${employeeId}`)));
        if (slips.some(d => !['eligible', 'no_slip'].includes(classifySlipForPropagation(d.exists, d.data()?.status, false)))) throw new HttpError(409, 'Ada slip penerima yang sudah diverifikasi/dikunci/dibayar. Kembalikan ke draft sebelum mengubah KJM.');
        const existingClaims = await tx.getAll(...claims);
        if (action === 'approve' && existingClaims.some(d => d.exists && d.data()?.importId !== id)) throw new HttpError(409, 'Ada pegawai yang sudah mendapat KJM semester ini dari impor lain.');
        if (action === 'revoke' && existingClaims.some(d => d.exists && d.data()?.importId !== id)) throw new HttpError(409, 'Klaim pembayaran berubah. Periksa rekonsiliasi KJM sebelum membatalkan.');
        // Read every period event in this transaction, so concurrent event changes
        // and slip locking cannot leave approval committed with a stale payslip.
        const events = await tx.get(adminDb.collection('VakasiTambahan').where('period', '==', before.period));
        const projected = [...events.docs.filter(d => d.id !== `KJM_${id}`).map(d => d.data()), event];
        for (const slip of slips) {
          if (!slip.exists) continue; // Future slips read the approved projection.
          const old = slip.data()!;
          const employeeId = employeeIds[slips.indexOf(slip)];
          const owned = vakasiOwnedEarningPredicate(vakasiEventNamesForEmployee(projected, employeeId));
          const stored = validateMoneyFields(old.earnings ?? [], 'earnings');
          const { merged, changes } = mergeOwnedFields(stored, vakasiApprovedEarningsForEmployee(projected, employeeId), owned, 'earnings');
          if (!changes.length) continue;
          assertOnlyOwnedChanged(stored, merged, owned);
          const deductions = validateMoneyFields(old.deductions ?? [], 'deductions');
          const taxes = recalculateSlipTaxes(old, merged, deductions);
          slipWrites.push({ ref: slip.ref, changes, data: { ...old, employeeId, period: before.period.replace('-', '_'), status: 'draft',
            earnings: merged, deductions, taxes, ...calculatePayrollTotals(merged, deductions, taxes),
            revision: Number(old.revision || 0) + 1, updatedAt: now, updatedBy: actor.uid } });
        }
      }
      const after = { ...before, edits: edits || before.edits, review, reviewHash: hash,
        ...(action === 'revoke' ? {} : { ruleVersion: KJM_RULE_VERSION }),
        rateVersion: action === 'revoke' ? before.rateVersion : master.version,
        revision: before.revision + 1, status: action === 'approve' ? 'approved' : 'draft',
        updatedBy: actor.uid, updatedAt: now,
        ...(action === 'approve' ? { approvedBy: actor.uid, approvedAt: now, approvedFromRevision: before.revision } : {}) };
      if (Buffer.byteLength(JSON.stringify(after)) > 850_000) throw new HttpError(400, 'Koreksi terlalu besar.');
      tx.set(ref, after, { merge: true });
      if (financial) {
        tx.set(adminDb.collection('VakasiTambahan').doc(`KJM_${id}`), event);
        claims.forEach(claim => action === 'approve' ? tx.set(claim, { importId: id, period: before.period, approvedBy: actor.uid, approvedAt: now }) : tx.delete(claim));
        slipWrites.forEach(slip => tx.set(slip.ref, slip.data));
      }
      tx.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, { action: `KJM_${action.toUpperCase()}`, entityType: 'KjmImports', entityId: id,
        reason: action === 'approve' ? 'Admin mengonfirmasi hasil review KJM untuk payroll' : action === 'revoke' ? 'Persetujuan KJM dibatalkan' : 'Koreksi dan perhitungan draft disimpan',
        before: { revision: before.revision, status: before.status, edits: before.edits, reviewHash: before.reviewHash, review: before.review },
        after: { revision: after.revision, status: after.status, edits: after.edits, reviewHash: hash, review },
        metadata: { period: before.period, semester: before.semester, slipChanges: slipWrites.map(slip => ({ slipId: slip.ref.id, changes: slip.changes })) } }));
      return { period: before.period, employeeIds, status: after.status, revision: after.revision };
    });
    return Response.json(result);
  } catch (e) { return errorResponse(e); }
}
