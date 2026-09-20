import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  canSubmitFacilityReport,
  canTransitionFacilityReport,
  FACILITY_REPORTS_COLLECTION,
  isBlueCollarFacilityDashboardUser,
  isFacilityReportOpen,
  isFacilityReportStatus,
  MAX_FACILITY_DESCRIPTION_LENGTH,
  MAX_FACILITY_PHOTOS,
  MAX_FACILITY_PLACE_LENGTH,
  MAX_FACILITY_REVIEW_NOTE_LENGTH,
  MIN_FACILITY_DECLINE_REASON_LENGTH,
  type FacilityReportStatus,
} from '@/lib/facilityReports';
import { normalizePhotoAuditMetadata, type PhotoEvidence } from '@/lib/photoEvidence';
import { errorResponse, HttpError, requireAuthenticatedProfile } from '@/lib/server/auth';
import type { AuthenticatedProfile } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const SAFE_REPORT_ID = /^[A-Za-z0-9_-]{1,180}$/;
const STORAGE_PHOTO_PREFIX = 'https://firebasestorage.googleapis.com/';
const REPAIR_PROOF_STORAGE_PREFIX = 'facility_report_proofs/';

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

/** Reviewers, reporters, and assigned repairers can view facility reports. */
function canViewFacilityReports(actor: AuthenticatedProfile): boolean {
  return (
    isFacilityReviewer(actor) ||
    canSubmitFacilityReport(actor) ||
    isBlueCollarFacilityDashboardUser(actor)
  );
}

function todayJakartaISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function storageUrlHasPath(url: string, expectedPathPrefix: string): boolean {
  try {
    const objectPath = new URL(url).pathname.split('/o/')[1] || '';
    return decodeURIComponent(objectPath).startsWith(expectedPathPrefix);
  } catch {
    return false;
  }
}

function parsePhotoEvidence(
  raw: unknown,
  label: string,
  expectedPathPrefix?: string,
  existingUrls?: Set<string>,
): PhotoEvidence[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new HttpError(400, `${label} tidak valid.`);
  }
  if (raw.length > MAX_FACILITY_PHOTOS) {
    throw new HttpError(400, `Maksimal ${MAX_FACILITY_PHOTOS} foto per laporan.`);
  }

  return raw.map((entry, index) => {
    const photo = entry && typeof entry === 'object'
      ? entry as Record<string, unknown>
      : {};
    const url = typeof photo.url === 'string' ? photo.url.trim() : '';
    if (!url.startsWith(STORAGE_PHOTO_PREFIX)) {
      throw new HttpError(400, `URL ${label.toLowerCase()} ke-${index + 1} tidak valid.`);
    }
    const isExisting = existingUrls && existingUrls.has(url);
    if (!isExisting && expectedPathPrefix && !storageUrlHasPath(url, expectedPathPrefix)) {
      throw new HttpError(400, `Foto ${label.toLowerCase()} ke-${index + 1} bukan unggahan Anda.`);
    }
    return {
      url,
      auditMetadata: normalizePhotoAuditMetadata(
        photo.auditMetadata as Record<string, unknown> | undefined,
      ),
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action === 'submit') {
      if (!canSubmitFacilityReport(actor)) {
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
      );

      const photos = parsePhotoEvidence(body?.photos, 'foto');

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

    if (action === 'repair') {
      const isReviewer = isFacilityReviewer(actor);
      if (!isBlueCollarFacilityDashboardUser(actor) && !isReviewer) {
        throw new HttpError(
          403,
          'Hanya Teknisi, Kebersihan, dan Kepala SatKer yang dapat memperbarui bukti perbaikan.',
        );
      }
      const uploaderId = actor.linkedEmployeeId || actor.uid;

      const reportId = textField(body?.reportId, 'ID laporan', 180);
      if (!SAFE_REPORT_ID.test(reportId)) {
        throw new HttpError(400, 'ID laporan tidak valid.');
      }

      const reportRef = adminDb.collection(FACILITY_REPORTS_COLLECTION).doc(reportId);
      const result = await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reportRef);
        if (!snapshot.exists) throw new HttpError(404, 'Laporan fasilitas tidak ditemukan.');
        const current = snapshot.data()!;
        const currentStatus = isFacilityReportStatus(current.status) ? current.status : 'pending';
        if (currentStatus !== 'resolved' && !canTransitionFacilityReport(currentStatus, 'resolved')) {
          throw new HttpError(409, 'Laporan ini sudah ditolak atau tidak dapat ditandai selesai.');
        }

        const existingUrls = new Set(
          (Array.isArray(current.resolutionPhotos) ? current.resolutionPhotos : []).map(
            (p: any) => String(p?.url || ''),
          ),
        );
        const resolutionPhotos = parsePhotoEvidence(
          body?.resolutionPhotos,
          'bukti perbaikan',
          `${REPAIR_PROOF_STORAGE_PREFIX}${uploaderId}/`,
          existingUrls,
        );

        const updateData: Record<string, unknown> = {
          resolutionPhotos,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (currentStatus === 'pending') {
          updateData.status = 'resolved';
          updateData.resolvedByUid = actor.uid;
          updateData.resolvedByName = actor.displayName || '';
          updateData.resolvedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        transaction.update(reportRef, updateData);
        return {
          reportId,
          status: 'resolved' satisfies FacilityReportStatus,
          resolutionPhotoCount: resolutionPhotos.length,
        };
      });

      return NextResponse.json(result);
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

      const uploaderId = actor.linkedEmployeeId || actor.uid;
      const reportRef = adminDb.collection(FACILITY_REPORTS_COLLECTION).doc(reportId);
      const result = await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reportRef);
        if (!snapshot.exists) throw new HttpError(404, 'Laporan fasilitas tidak ditemukan.');
        const current = snapshot.data()!;
        const currentStatus = isFacilityReportStatus(current.status) ? current.status : 'pending';
        if (!canTransitionFacilityReport(currentStatus, nextStatus)) {
          throw new HttpError(409, 'Perubahan status laporan tidak diizinkan.');
        }

        const existingUrls = new Set(
          (Array.isArray(current.resolutionPhotos) ? current.resolutionPhotos : []).map(
            (p: any) => String(p?.url || ''),
          ),
        );
        const resolutionPhotos =
          nextStatus === 'resolved' && body?.resolutionPhotos !== undefined
            ? parsePhotoEvidence(
                body.resolutionPhotos,
                'bukti perbaikan',
                `${REPAIR_PROOF_STORAGE_PREFIX}${uploaderId}/`,
                existingUrls,
              )
            : undefined;

        const updateData: Record<string, unknown> = {
          status: nextStatus,
          reviewNote: rawNote || null,
          reviewedByUid: actor.uid,
          reviewedByName: actor.displayName || '',
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (nextStatus === 'resolved') {
          updateData.resolvedByUid = actor.uid;
          updateData.resolvedByName = actor.displayName || '';
          updateData.resolvedAt = admin.firestore.FieldValue.serverTimestamp();
          if (resolutionPhotos !== undefined) {
            updateData.resolutionPhotos = resolutionPhotos;
          }
        }

        transaction.update(reportRef, updateData);
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
    if (!canViewFacilityReports(actor)) {
      throw new HttpError(403, 'Anda tidak memiliki akses ke riwayat laporan fasilitas.');
    }
    if (statusFilter && isFacilityReportStatus(statusFilter)) {
      query = query.where('status', '==', statusFilter);
    }

    const snapshot = await query.get();
    const reports: Record<string, unknown>[] = snapshot.docs
      .map((document) => {
        const { reportedAt, reviewedAt, resolvedAt, updatedAt, ...rest } = document.data();
        return {
          ...rest,
          id: document.id,
          // Firestore Timestamps are not JSON-serializable; the pages only
          // need them for ordering and display.
          reportedAtMillis: reportedAt?.toMillis?.() ?? null,
          reviewedAtMillis: reviewedAt?.toMillis?.() ?? null,
          resolvedAtMillis: resolvedAt?.toMillis?.() ?? null,
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
