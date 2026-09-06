import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { adminDb } from '@/lib/firebase-admin';
import {
  isKoperasiAdminConfigured,
  koperasiAdminDb,
  KOPERASI_LOANS_COLLECTION,
  KOPERASI_USERS_COLLECTION,
} from '@/lib/koperasi-admin';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import type { AuthenticatedProfile } from '@/lib/server/auth';
import {
  canApplyForKoperasiLoan,
  canCancelKoperasiLoan,
  canRespondToKoperasiRevision,
  isKoperasiBank,
  koperasiAdminFee,
  koperasiOutstandingBalance,
  koperasiRemainingTenor,
  quoteKoperasiRestructuring,
  validateKoperasiLoanApplication,
  KOPERASI_MAX_NOTE_LENGTH,
} from '@/lib/payroll/koperasiLoanApplication';

export const dynamic = 'force-dynamic';

const SAFE_LOAN_ID = /^[A-Za-z0-9_-]{1,180}$/;
const LOYALIS_COLLECTION = 'Employees_Loyalis';
const BLUE_COLLAR_COLLECTION = 'Employees_BlueCollar';

type LoanDoc = Record<string, unknown> & { id: string };

/**
 * Simpan Pinjam is the members' own money, so this route is deliberately
 * narrow: it only ever reads and writes loans whose `userId` equals the
 * cooperative UID recorded on the caller's own employee profile. The
 * cooperative UID is never accepted from the request body.
 */
interface KoperasiIdentity {
  employeeId: string;
  koperasiAuthUid: string;
  member: Record<string, unknown> | null;
  memberApproved: boolean;
  displayName: string;
}

async function resolveKoperasiIdentity(
  actor: AuthenticatedProfile,
): Promise<KoperasiIdentity> {
  const isLoyalis = actor.role === 'loyalis';
  if (!isLoyalis && actor.role !== 'honorer' && actor.role !== 'ketua_shift_satpam') {
    throw new HttpError(403, 'Halaman Simpan Pinjam tidak tersedia untuk peran akun Anda.');
  }
  if (!actor.linkedEmployeeId) {
    throw new HttpError(409, 'Akun Anda belum terhubung ke data Pegawai. Hubungi Badan Administrasi Keuangan (BAK).');
  }

  const employeeSnapshot = await adminDb
    .collection(isLoyalis ? LOYALIS_COLLECTION : BLUE_COLLAR_COLLECTION)
    .doc(actor.linkedEmployeeId)
    .get();
  if (!employeeSnapshot.exists) {
    throw new HttpError(404, 'Data pegawai Anda tidak ditemukan.');
  }

  const employee = employeeSnapshot.data() || {};
  const koperasiAuthUid =
    typeof employee.koperasiAuthUid === 'string' ? employee.koperasiAuthUid.trim() : '';
  if (!koperasiAuthUid) {
    throw new HttpError(
      409,
      'Akun Anda belum tertaut ke keanggotaan Koperasi UNIPDU. Hubungi pengurus koperasi untuk menautkan akun.',
    );
  }

  const memberQuery = await koperasiAdminDb()
    .collection(KOPERASI_USERS_COLLECTION)
    .where('uid', '==', koperasiAuthUid)
    .limit(1)
    .get();
  const memberDoc = memberQuery.docs[0];
  const member: Record<string, unknown> | null = memberDoc
    ? { id: memberDoc.id, ...memberDoc.data() }
    : null;

  // The cooperative writes the approval flag to either field depending on how
  // the membership was created; both mean the same thing.
  const memberApproved =
    member?.status === 'approved' || member?.membershipStatus === 'approved';

  const personalName =
    (employee.personal_info as Record<string, unknown> | undefined)?.name;

  return {
    employeeId: actor.linkedEmployeeId,
    koperasiAuthUid,
    member,
    memberApproved,
    displayName: String(member?.nama || personalName || actor.displayName || ''),
  };
}

function millis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const candidate = value as { toMillis?: () => number; seconds?: number };
  if (typeof candidate.toMillis === 'function') return candidate.toMillis();
  if (typeof candidate.seconds === 'number') return candidate.seconds * 1000;
  return null;
}

/**
 * Firestore Timestamps are not JSON-serializable. Every date is emitted as
 * epoch milliseconds, which the shared `koperasiLoan.ts` helpers already accept
 * (`timestampMillis` parses a number), so the page can keep using
 * `resolveKoperasiLoanStatus` and `composeKoperasiLoanHistoryTrail` unchanged.
 */
function serializeLoan(id: string, data: Record<string, unknown>): LoanDoc {
  const history = Array.isArray(data.history) ? data.history : [];
  return {
    ...data,
    id,
    tanggalPengajuan: millis(data.tanggalPengajuan),
    tanggalDisetujui: millis(data.tanggalDisetujui),
    updatedAt: millis(data.updatedAt),
    history: history.map((entry) => {
      const record = (entry || {}) as Record<string, unknown>;
      return {
        status: String(record.status || ''),
        notes: typeof record.notes === 'string' ? record.notes : '',
        updatedBy: typeof record.updatedBy === 'string' ? record.updatedBy : '',
        timestamp: millis(record.timestamp),
      };
    }),
  };
}

async function loadOwnLoans(koperasiAuthUid: string): Promise<LoanDoc[]> {
  const snapshot = await koperasiAdminDb()
    .collection(KOPERASI_LOANS_COLLECTION)
    .where('userId', '==', koperasiAuthUid)
    .get();
  return snapshot.docs
    .map((document) => serializeLoan(document.id, document.data()))
    .sort(
      (left, right) =>
        Number(right.tanggalPengajuan || 0) - Number(left.tanggalPengajuan || 0),
    );
}

/** Snapshot of the member profile copied onto each loan, as the Koperasi app does. */
function borrowerSnapshot(identity: KoperasiIdentity): Record<string, string> {
  const member = identity.member || {};
  return {
    email: String(member.email || ''),
    namaLengkap: String(member.nama || identity.displayName || ''),
    nik: String(member.nik || ''),
    nomorWhatsapp: String(member.nomorWhatsapp || ''),
    kantor: String(member.kantor || ''),
    satuanKerja: String(member.satuanKerja || ''),
    nomorAnggota: String(member.nomorAnggota || ''),
  };
}

function historyEntry(status: string, uid: string, notes: string) {
  return {
    status,
    timestamp: admin.firestore.Timestamp.now(),
    updatedBy: uid,
    notes,
  };
}

function requireConfigured(): void {
  if (!isKoperasiAdminConfigured()) {
    throw new HttpError(
      503,
      'Integrasi Koperasi UNIPDU belum dikonfigurasi di server. Hubungi administrator sistem.',
    );
  }
}

function loanIdField(raw: unknown): string {
  const loanId = typeof raw === 'string' ? raw.trim() : '';
  if (!loanId || !SAFE_LOAN_ID.test(loanId)) {
    throw new HttpError(400, 'ID pinjaman tidak valid.');
  }
  return loanId;
}

export async function GET(request: NextRequest) {
  try {
    requireConfigured();
    const actor = await requireAuthenticatedProfile(request);
    const identity = await resolveKoperasiIdentity(actor);
    const loans = await loadOwnLoans(identity.koperasiAuthUid);

    return NextResponse.json({
      loans,
      membership: {
        approved: identity.memberApproved,
        nama: identity.displayName,
        nomorAnggota: String(identity.member?.nomorAnggota || ''),
        satuanKerja: String(identity.member?.satuanKerja || ''),
        paymentStatus: String(identity.member?.paymentStatus || ''),
        bank: String(
          (identity.member?.bankDetails as Record<string, unknown> | undefined)?.bank || '',
        ),
        nomorRekening: String(
          (identity.member?.bankDetails as Record<string, unknown> | undefined)?.nomorRekening || '',
        ),
      },
      canApply: identity.memberApproved && canApplyForKoperasiLoan(loans),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireConfigured();
    const actor = await requireAuthenticatedProfile(request);
    const identity = await resolveKoperasiIdentity(actor);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = typeof body?.action === 'string' ? body.action : '';

    if (!identity.memberApproved) {
      throw new HttpError(
        409,
        'Keanggotaan Koperasi UNIPDU Anda belum aktif. Aktifkan keanggotaan terlebih dahulu melalui pengurus koperasi.',
      );
    }

    const db = koperasiAdminDb();
    const loansCollection = db.collection(KOPERASI_LOANS_COLLECTION);

    if (action === 'apply') {
      const input = {
        amount: Math.floor(Number(body?.amount) || 0),
        tenor: Math.floor(Number(body?.tenor) || 0),
        purpose: String(body?.purpose || ''),
        bank: String(body?.bank || ''),
        accountNumber: String(body?.accountNumber || ''),
        note: typeof body?.note === 'string' ? body.note : '',
      };
      const validationError = validateKoperasiLoanApplication(input);
      if (validationError) throw new HttpError(400, validationError);

      // Re-check against live data rather than trusting the browser's view:
      // another tab (or the Koperasi app itself) may have opened an
      // application since this page loaded.
      const existing = await loadOwnLoans(identity.koperasiAuthUid);
      if (!canApplyForKoperasiLoan(existing)) {
        throw new HttpError(
          409,
          'Anda masih memiliki pengajuan atau pinjaman yang berjalan. Lunasi atau restrukturisasi pinjaman tersebut terlebih dahulu.',
        );
      }

      const created = await loansCollection.add({
        userId: identity.koperasiAuthUid,
        jumlahPinjaman: input.amount,
        tenor: input.tenor,
        tujuanPinjaman: input.purpose.trim(),
        catatanTambahan: input.note.trim() ? [input.note.trim().slice(0, KOPERASI_MAX_NOTE_LENGTH)] : [],
        status: 'Menunggu Persetujuan BAK',
        tanggalPengajuan: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        biayaAdmin: koperasiAdminFee(input.amount),
        sisaHutang: input.amount,
        jumlahMenyicil: 0,
        bankDetails: { bank: input.bank, nomorRekening: input.accountNumber.trim() },
        userData: borrowerSnapshot(identity),
        submittedVia: 'internal_bak_employee_portal',
        history: [
          historyEntry('Menunggu Persetujuan BAK', identity.koperasiAuthUid, 'Pengajuan pinjaman baru'),
        ],
      });

      return NextResponse.json({ loanId: created.id, status: 'Menunggu Persetujuan BAK' }, { status: 201 });
    }

    if (action === 'restructure') {
      const loanId = loanIdField(body?.loanId);
      const additionalAmount = Math.floor(Number(body?.additionalAmount) || 0);
      const additionalTenor = Math.floor(Number(body?.additionalTenor) || 0);
      const bank = String(body?.bank || '');
      if (!isKoperasiBank(bank)) {
        throw new HttpError(400, 'Silakan pilih bank untuk transfer.');
      }
      const accountNumber = String(body?.accountNumber || '').trim();
      if (!/^\d{6,25}$/.test(accountNumber)) {
        throw new HttpError(400, 'Nomor rekening harus berupa 6 - 25 digit angka.');
      }

      const oldLoanRef = loansCollection.doc(loanId);
      const newLoanRef = loansCollection.doc();

      const result = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(oldLoanRef);
        if (!snapshot.exists) throw new HttpError(404, 'Pinjaman tidak ditemukan.');
        const current = snapshot.data() || {};
        if (current.userId !== identity.koperasiAuthUid) {
          throw new HttpError(403, 'Pinjaman ini bukan milik Anda.');
        }

        // Quote against the loan as it stands inside the transaction — an
        // installment posted by payroll between page load and submit changes
        // both the carried balance and the carried tenor.
        const quote = quoteKoperasiRestructuring(
          { id: loanId, ...current },
          additionalAmount,
          additionalTenor,
        );
        if (quote.error) throw new HttpError(409, quote.error);

        const shortOldId = loanId.substring(0, 8);
        const note =
          `Restrukturisasi dari pinjaman #${shortOldId}. ` +
          `Sisa hutang saat pengajuan: Rp ${quote.carriedBalance.toLocaleString('id-ID')}, ` +
          `Pinjaman tambahan: Rp ${quote.additionalAmount.toLocaleString('id-ID')}`;

        transaction.create(newLoanRef, {
          userId: identity.koperasiAuthUid,
          jumlahPinjaman: quote.newTotal,
          tenor: quote.newTenor,
          additionalTenor: quote.additionalTenor,
          tujuanPinjaman: 'Restrukturisasi pinjaman',
          catatanTambahan: [note],
          status: 'Menunggu Persetujuan BAK',
          tanggalPengajuan: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          biayaAdmin: quote.adminFee,
          sisaHutang: quote.newTotal,
          jumlahMenyicil: 0,
          restructuredFromLoanId: loanId,
          sisaPinjamanSebelumnya: quote.carriedBalance,
          pinjamanBaru: quote.additionalAmount,
          bankDetails: { bank, nomorRekening: accountNumber },
          userData: borrowerSnapshot(identity),
          submittedVia: 'internal_bak_employee_portal',
          history: [
            historyEntry(
              'Menunggu Persetujuan BAK',
              identity.koperasiAuthUid,
              `Pengajuan restrukturisasi dari pinjaman #${shortOldId}`,
            ),
          ],
        });

        transaction.update(oldLoanRef, {
          status: 'Menunggu Persetujuan Restrukturisasi',
          restructuredToLoanId: newLoanRef.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          history: admin.firestore.FieldValue.arrayUnion(
            historyEntry(
              'Menunggu Persetujuan Restrukturisasi',
              identity.koperasiAuthUid,
              `Pengajuan restrukturisasi ke pinjaman baru #${newLoanRef.id.substring(0, 8)}. ` +
                `Sisa hutang saat pengajuan: Rp ${quote.carriedBalance.toLocaleString('id-ID')}`,
            ),
          ),
        });

        return {
          loanId: newLoanRef.id,
          newTotal: quote.newTotal,
          newTenor: quote.newTenor,
          monthlyInstallment: quote.monthlyInstallment,
        };
      });

      return NextResponse.json(result, { status: 201 });
    }

    if (action === 'cancel') {
      const loanId = loanIdField(body?.loanId);
      await db.runTransaction(async (transaction) => {
        const loanRef = loansCollection.doc(loanId);
        const snapshot = await transaction.get(loanRef);
        if (!snapshot.exists) throw new HttpError(404, 'Pinjaman tidak ditemukan.');
        const current = snapshot.data() || {};
        if (current.userId !== identity.koperasiAuthUid) {
          throw new HttpError(403, 'Pinjaman ini bukan milik Anda.');
        }
        if (!canCancelKoperasiLoan({ id: loanId, ...current })) {
          throw new HttpError(
            409,
            'Pengajuan ini sudah ditindaklanjuti BAK sehingga tidak dapat dibatalkan.',
          );
        }

        // A cancelled restructuring must hand the old loan back its active
        // status, otherwise the member is left with no payable loan at all.
        const parentId =
          typeof current.restructuredFromLoanId === 'string' ? current.restructuredFromLoanId : '';
        const parentRef = parentId ? loansCollection.doc(parentId) : null;
        const parentSnapshot = parentRef ? await transaction.get(parentRef) : null;

        transaction.update(loanRef, {
          status: 'Dibatalkan',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          history: admin.firestore.FieldValue.arrayUnion(
            historyEntry('Dibatalkan', identity.koperasiAuthUid, 'Pengajuan pinjaman dibatalkan oleh anggota'),
          ),
        });

        if (
          parentRef &&
          parentSnapshot?.exists &&
          parentSnapshot.data()?.status === 'Menunggu Persetujuan Restrukturisasi'
        ) {
          transaction.update(parentRef, {
            status: 'Disetujui dan Aktif',
            restructuredToLoanId: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            history: admin.firestore.FieldValue.arrayUnion(
              historyEntry(
                'Disetujui dan Aktif',
                identity.koperasiAuthUid,
                `Pengajuan restrukturisasi #${loanId.substring(0, 8)} dibatalkan oleh anggota. Pinjaman dikembalikan ke status aktif.`,
              ),
            ),
          });
        }
      });

      return NextResponse.json({ loanId, status: 'Dibatalkan' });
    }

    if (action === 'accept-revision' || action === 'reject-revision') {
      const loanId = loanIdField(body?.loanId);
      const accepting = action === 'accept-revision';

      const result = await db.runTransaction(async (transaction) => {
        const loanRef = loansCollection.doc(loanId);
        const snapshot = await transaction.get(loanRef);
        if (!snapshot.exists) throw new HttpError(404, 'Pinjaman tidak ditemukan.');
        const current = snapshot.data() || {};
        if (current.userId !== identity.koperasiAuthUid) {
          throw new HttpError(403, 'Pinjaman ini bukan milik Anda.');
        }
        if (!canRespondToKoperasiRevision({ id: loanId, ...current })) {
          throw new HttpError(409, 'Pengajuan ini tidak sedang menunggu tanggapan revisi.');
        }

        const parentId =
          typeof current.restructuredFromLoanId === 'string' ? current.restructuredFromLoanId : '';
        const parentRef = parentId ? loansCollection.doc(parentId) : null;
        const parentSnapshot = parentRef ? await transaction.get(parentRef) : null;

        if (!accepting) {
          transaction.update(loanRef, {
            status: 'Revisi Ditolak Anggota',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            history: admin.firestore.FieldValue.arrayUnion(
              historyEntry('Revisi Ditolak Anggota', identity.koperasiAuthUid, 'Anggota menolak revisi dari BAK'),
            ),
          });
          if (
            parentRef &&
            parentSnapshot?.exists &&
            parentSnapshot.data()?.status === 'Menunggu Persetujuan Restrukturisasi'
          ) {
            transaction.update(parentRef, {
              status: 'Disetujui dan Aktif',
              restructuredToLoanId: null,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              history: admin.firestore.FieldValue.arrayUnion(
                historyEntry(
                  'Disetujui dan Aktif',
                  identity.koperasiAuthUid,
                  `Pengajuan restrukturisasi #${loanId.substring(0, 8)} ditolak anggota. Pinjaman dikembalikan ke status aktif.`,
                ),
              ),
            });
          }
          return { loanId, status: 'Revisi Ditolak Anggota' };
        }

        const revisedAmount = Number(current.revisiJumlah);
        const acceptedAmount = Number.isFinite(revisedAmount) && revisedAmount > 0
          ? Math.round(revisedAmount)
          : Math.round(Number(current.jumlahPinjaman) || 0);

        const update: Record<string, unknown> = {
          status: 'Menunggu Persetujuan Wakil Rektor 2',
          jumlahPinjaman: acceptedAmount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const notes = ['Anggota menerima revisi dari BAK'];

        // Payroll may have posted installments on the parent loan while BAK was
        // revising this restructuring. Re-derive the carried balance and tenor
        // from the parent as it stands now, or the new loan would capitalise a
        // debt the member has already partly repaid.
        if (parentRef && parentSnapshot?.exists) {
          const parent = parentSnapshot.data() || {};
          const latestBalance = koperasiOutstandingBalance(parent);
          const previousBalance = Math.round(Number(current.sisaPinjamanSebelumnya) || 0);

          if (latestBalance !== previousBalance) {
            const topUp = Math.max(0, acceptedAmount - latestBalance);
            update.sisaPinjamanSebelumnya = latestBalance;
            update.pinjamanBaru = topUp;
            update.biayaAdmin = koperasiAdminFee(acceptedAmount);
            update.sisaHutang = acceptedAmount;
            update.catatanTambahan = [
              `Restrukturisasi dari pinjaman #${parentId.substring(0, 8)}. ` +
                `Sisa hutang saat pengajuan: Rp ${latestBalance.toLocaleString('id-ID')}, ` +
                `Pinjaman tambahan: Rp ${topUp.toLocaleString('id-ID')}`,
            ];

            const parentRemainingTenor = koperasiRemainingTenor(parent);
            const additionalTenor = Math.max(0, Math.floor(Number(current.additionalTenor) || 0));
            const previousRemainingTenor =
              Math.max(0, Math.floor(Number(current.tenor) || 0)) - additionalTenor;
            if (parentRemainingTenor !== previousRemainingTenor) {
              update.tenor = parentRemainingTenor + additionalTenor;
            }

            notes.push(
              `Sisa hutang lama diperbarui dari Rp ${previousBalance.toLocaleString('id-ID')} ` +
                `menjadi Rp ${latestBalance.toLocaleString('id-ID')} (ada cicilan terbayar selama proses revisi)`,
            );
          }
        }

        update.history = admin.firestore.FieldValue.arrayUnion(
          historyEntry(
            'Menunggu Persetujuan Wakil Rektor 2',
            identity.koperasiAuthUid,
            notes.join('. '),
          ),
        );
        transaction.update(loanRef, update);
        return { loanId, status: 'Menunggu Persetujuan Wakil Rektor 2' };
      });

      return NextResponse.json(result);
    }

    throw new HttpError(400, 'Aksi tidak dikenal.');
  } catch (error) {
    return errorResponse(error);
  }
}
