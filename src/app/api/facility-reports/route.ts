import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  canTransitionFacilityReport,
  FACILITY_REPORTS_COLLECTION,
  isFacilityReportOpen,
  isFacilityReportStatus,
  MAX_FACILITY_DESCRIPTION_LENGTH,
  MAX_FACILITY_PHOTOS,
  MAX_FACILITY_PLACE_LENGTH,
  MAX_FACILITY_REVIEW_NOTE_LENGTH,
  MIN_FACILITY_DECLINE_REASON_LENGTH,
  MIN_FACILITY_DESCRIPTION_LENGTH,
  type FacilityReportStatus,
} from '@/lib/facilityReports';
import { normalizePhotoAuditMetadata } from '@/lib/photoEvidence';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import type { AuthenticatedProfile } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const SAFE_REPORT_ID = /^[A-Za-z0-9_-]{1,180}$/;
const STORAGE_PHOTO_PREFIX = 'https://firebasestorage.googleapis.com/';

function textField(raw: unknown, label: string, max: number, min = 1): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length < min) {
    throw new HttpError(400, `${label} wajib diisi minimal ${min} karakter.`);
  }
  if (value.length > max) {
    throw new HttpError(400, `${label} maksimal ${max} karakter.`);
  }
  return value;
}

/** Reviewers can view and process every facility report. */
function isFacilityReviewer(actor: AuthenticatedProfile): boolean {
  return actor.role === 'super_admin' || actor.role === 'satker_head';
}

/** Loyalis and blue-collar (Pekarya/Satpam/Sopir) employees can report and browse facility conditions. */
function canReportFacilityIssues(actor: AuthenticatedProfile): boolean {
  return actor.role === 'loyalis' || actor.role === 'honorer' || actor.role === 'ketua_shift_satpam';
}

function todayJakartaISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action === 'submit') {
      if (!canReportFacilityIssues(actor)) {
        throw new HttpError(403, 'Anda tidak memiliki akses untuk melaporkan kondisi fasilitas.');
      }
      if (!actor.linkedEmployeeId) {
        throw new HttpError(409, 'Akun Anda belum terhubung ke data Pegawai.');
      }

      const place = textField(body?.place, 'Lokasi fasilitas', MAX_FACILITY_PLACE_LENGTH);
      const description = textField(
        body?.description,
        'Deskripsi masalah atau kondisi',
        MAX_FACILITY_DESCRIPTION_LENGTH,
        MIN_FACILITY_DESCRIPTION_LENGTH,
      );

      const rawPhotos = Array.isArray(body?.photos) ? body.photos : [];
      if (rawPhotos.length > MAX_FACILITY_PHOTOS) {
        throw new HttpError(400, `Maksimal ${MAX_FACILITY_PHOTOS} foto per laporan.`);
      }
      const photos = rawPhotos.map((entry, index) => {
        const url = typeof (entry as Record<string, unknown>)?.url === 'string'
          ? (entry as Record<string, unknown>).url as string
          : '';
        if (!url.trim().startsWith(STORAGE_PHOTO_PREFIX)) {
          throw new HttpError(400, `URL foto ke-${index + 1} tidak valid.`);
        }
        return {
          url: url.trim(),
          auditMetadata: normalizePhotoAuditMetadata(
            (entry as Record<string, unknown>)?.auditMetadata as Record<string, unknown> | undefined,
          ),
        };
      });

      const reportId = `FAC-${todayJakartaISO().replaceAll('-', '')}-${randomUUID()
        .replaceAll('-', '')
        .slice(0, 12)
        .toUpperCase()}`;
      const now = admin.firestore.FieldValue.serverTimestamp();

      await adminDb.collection(FACILITY_REPORTS_COLLECTION).doc(reportId).create({
        id: reportId,
        employeeId: actor.linkedEmployeeId,
        employeeName: actor.displayName || '',
        reportedByUid: actor.uid,
        place,
        description,
        photos,
        status: 'pending' satisfies FacilityReportStatus,
        reportedDate: todayJakartaISO(),
        reportedAt: now,
        updatedAt: now,
      });

      return NextResponse.json({ reportId, status: 'pending' }, { status: 201 });
    }

    if (action === 'review') {
      if (!isFacilityReviewer(actor)) {
        throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk meninjau laporan fasilitas.');
      }
      const reportId = textField(body?.reportId, 'ID laporan', 180);
      if (!SAFE_REPORT_ID.test(reportId)) {
        throw new HttpError(400, 'ID laporan tidak valid.');
      }
      const nextStatus = body?.status;
      if (!isFacilityReportStatus(nextStatus)) {
        throw new HttpError(400, 'Status tinjauan tidak valid.');
      }
      // A rejection must always explain itself; other transitions may carry an
      // optional note (e.g. which technician was assigned).
      const rawNote = typeof body?.reviewNote === 'string' ? body.reviewNote.trim() : '';
      if (nextStatus === 'declined' && rawNote.length < MIN_FACILITY_DECLINE_REASON_LENGTH) {
        throw new HttpError(
          400,
          `Alasan penolakan wajib diisi minimal ${MIN_FACILITY_DECLINE_REASON_LENGTH} karakter.`,
        );
      }
      if (rawNote.length > MAX_FACILITY_REVIEW_NOTE_LENGTH) {
        throw new HttpError(400, `Catatan maksimal ${MAX_FACILITY_REVIEW_NOTE_LENGTH} karakter.`);
      }

      const reportRef = adminDb.collection(FACILITY_REPORTS_COLLECTION).doc(reportId);
      const result = await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reportRef);
        if (!snapshot.exists) throw new HttpError(404, 'Laporan fasilitas tidak ditemukan.');
        const current = snapshot.data()!;
        const currentStatus = isFacilityReportStatus(current.status) ? current.status : 'pending';
        if (!canTransitionFacilityReport(currentStatus, nextStatus)) {
          throw new HttpError(409, 'Perubahan status laporan tidak diizinkan.');
        }

        transaction.update(reportRef, {
          status: nextStatus,
          reviewNote: rawNote || null,
          reviewedByUid: actor.uid,
          reviewedByName: actor.displayName || '',
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { reportId, status: nextStatus };
      });

      return NextResponse.json(result);
    }

    if (action === 'withdraw') {
      const reportId = textField(body?.reportId, 'ID laporan', 180);
      if (!SAFE_REPORT_ID.test(reportId)) {
        throw new HttpError(400, 'ID laporan tidak valid.');
      }
      const reportRef = adminDb.collection(FACILITY_REPORTS_COLLECTION).doc(reportId);
      await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reportRef);
        if (!snapshot.exists) throw new HttpError(404, 'Laporan fasilitas tidak ditemukan.');
        const current = snapshot.data()!;
        const isOwner =
          Boolean(actor.linkedEmployeeId) && current.employeeId === actor.linkedEmployeeId;
        if (!isOwner && actor.role !== 'super_admin') {
          throw new HttpError(403, 'Laporan ini bukan milik Anda.');
        }
        // Once the Kepala SatKer has acted on a report it stays on the record.
        if (actor.role !== 'super_admin' && current.status !== 'pending') {
          throw new HttpError(
            409,
            'Laporan yang sudah diproses tidak dapat ditarik kembali.',
          );
        }
        transaction.delete(reportRef);
      });

      return NextResponse.json({ reportId, deleted: true });
    }

    throw new HttpError(400, 'Aksi tidak dikenal.');
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const searchParams = new URL(request.url).searchParams;
    const statusFilter = searchParams.get('status');

    let query: FirebaseFirestore.Query = adminDb.collection(FACILITY_REPORTS_COLLECTION);
    if (!isFacilityReviewer(actor) && !canReportFacilityIssues(actor)) {
      throw new HttpError(403, 'Anda tidak memiliki akses ke riwayat laporan fasilitas.');
    }
    if (statusFilter && isFacilityReportStatus(statusFilter)) {
      query = query.where('status', '==', statusFilter);
    }

    const snapshot = await query.get();
    const reports: Record<string, unknown>[] = snapshot.docs
      .map((document) => {
        const { reportedAt, reviewedAt, updatedAt, ...rest } = document.data();
        return {
          ...rest,
          id: document.id,
          // Firestore Timestamps are not JSON-serializable; the pages only
          // need them for ordering and display.
          reportedAtMillis: reportedAt?.toMillis?.() ?? null,
          reviewedAtMillis: reviewedAt?.toMillis?.() ?? null,
          updatedAtMillis: updatedAt?.toMillis?.() ?? null,
        };
      })
      .sort(
        (a, b) => {
          const timestampA = Number(a.reportedAtMillis || 0);
          const timestampB = Number(b.reportedAtMillis || 0);
          if (timestampA !== timestampB) return timestampB - timestampA;
          return String((b as Record<string, unknown>).reportedDate || '').localeCompare(
            String((a as Record<string, unknown>).reportedDate || ''),
          );
        },
      );

    return NextResponse.json({
      reports,
      openCount: reports.filter((report) => isFacilityReportOpen(report.status)).length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
