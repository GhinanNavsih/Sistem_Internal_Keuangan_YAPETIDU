import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';

export const dynamic = 'force-dynamic';

interface TeamInput {
  teamId: string;
  ketuaShiftId: string;
  memberEmployeeIds: string[];
  reason: string;
}

function parseInput(raw: unknown): TeamInput {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Payload regu tidak valid.');
  }
  const value = raw as Record<string, unknown>;
  if (!['team_1', 'team_2', 'team_3'].includes(String(value.teamId))) {
    throw new HttpError(400, 'Nomor regu tidak valid.');
  }
  if (typeof value.ketuaShiftId !== 'string' || !value.ketuaShiftId.trim()) {
    throw new HttpError(400, 'Ketua Shift wajib dipilih.');
  }
  if (
    !Array.isArray(value.memberEmployeeIds) ||
    value.memberEmployeeIds.length !== 9 ||
    value.memberEmployeeIds.some((id) => typeof id !== 'string' || !id.trim())
  ) {
    throw new HttpError(400, 'Regu wajib memiliki tepat sembilan anggota selain Ketua Shift.');
  }
  const memberEmployeeIds = value.memberEmployeeIds.map((id) => String(id).trim());
  if (new Set(memberEmployeeIds).size !== 9) {
    throw new HttpError(400, 'Anggota regu tidak boleh duplikat.');
  }
  const ketuaShiftId = value.ketuaShiftId.trim();
  if (memberEmployeeIds.includes(ketuaShiftId)) {
    throw new HttpError(400, 'Ketua Shift tidak boleh didaftarkan ulang sebagai anggota.');
  }
  if (typeof value.reason !== 'string' || value.reason.trim().length < 8) {
    throw new HttpError(400, 'Alasan perubahan regu minimal delapan karakter.');
  }
  return {
    teamId: String(value.teamId),
    ketuaShiftId,
    memberEmployeeIds,
    reason: value.reason.trim(),
  };
}

function isActiveSatpam(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return Boolean(
    data &&
      data.employment?.jobCategory === 'SATPAM' &&
      (data.employment?.status === 'active' || data.flags?.isActive === true),
  );
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const input = parseInput(await request.json());
    const teamRef = adminDb.collection('SatpamShiftTeams').doc(input.teamId);
    const allGuardIds = [input.ketuaShiftId, ...input.memberEmployeeIds];

    const result = await adminDb.runTransaction(async (transaction) => {
      const teamsQuery = adminDb.collection('SatpamShiftTeams');
      const employeeRefs = allGuardIds.map((employeeId) =>
        adminDb.collection('Employees_BlueCollar').doc(employeeId),
      );
      const ketuaProfilesQuery = adminDb
        .collection('users')
        .where('linkedEmployeeId', '==', input.ketuaShiftId)
        .limit(2);
      const [teamsSnapshot, ketuaProfilesSnapshot, ...employeeSnapshots] =
        await Promise.all([
          transaction.get(teamsQuery),
          transaction.get(ketuaProfilesQuery),
          ...employeeRefs.map((reference) => transaction.get(reference)),
        ]);

      const invalidEmployee = employeeSnapshots.find(
        (snapshot) => !snapshot.exists || !isActiveSatpam(snapshot.data()),
      );
      if (invalidEmployee) {
        throw new HttpError(
          409,
          `Satpam ${invalidEmployee.id} tidak aktif atau tidak valid.`,
        );
      }
      const ketuaProfile = ketuaProfilesSnapshot.docs.find(
        (snapshot) =>
          snapshot.data().role === 'ketua_shift_satpam' &&
          snapshot.data().disabled !== true,
      );
      if (!ketuaProfile) {
        throw new HttpError(
          409,
          'Ketua Shift wajib memiliki akun aktif dengan peran ketua_shift_satpam.',
        );
      }

      for (const otherTeam of teamsSnapshot.docs) {
        if (otherTeam.id === input.teamId) continue;
        const other = otherTeam.data();
        const occupiedIds = new Set<string>([
          String(other.ketuaShiftId || ''),
          ...(Array.isArray(other.memberEmployeeIds)
            ? other.memberEmployeeIds.filter(
                (id: unknown): id is string => typeof id === 'string',
              )
            : []),
        ]);
        const overlap = allGuardIds.find((employeeId) => occupiedIds.has(employeeId));
        if (overlap) {
          throw new HttpError(
            409,
            `Satpam ${overlap} masih terdaftar pada ${otherTeam.id}. Selesaikan konfigurasi regu tersebut terlebih dahulu.`,
          );
        }
      }

      const beforeSnapshot = teamsSnapshot.docs.find(
        (snapshot) => snapshot.id === input.teamId,
      );
      const before = beforeSnapshot?.data() || null;
      const ketuaEmployee = employeeSnapshots[0].data()!;
      const after = {
        ketuaShiftId: input.ketuaShiftId,
        ketuaShiftName: String(ketuaEmployee.name || input.ketuaShiftId),
        memberEmployeeIds: input.memberEmployeeIds,
        rosterSize: 10,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: actor.uid,
        schemaVersion: 2,
      };
      transaction.set(teamRef, after, { merge: true });
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'SATPAM_TEAM_CONFIGURED',
          entityType: 'SatpamShiftTeam',
          entityId: input.teamId,
          reason: input.reason,
          before: before
            ? {
                ketuaShiftId: before.ketuaShiftId || null,
                memberEmployeeIds: before.memberEmployeeIds || [],
              }
            : null,
          after: {
            ketuaShiftId: after.ketuaShiftId,
            memberEmployeeIds: after.memberEmployeeIds,
          },
        }),
      );
      return after;
    });

    return Response.json(
      { message: 'Konfigurasi regu berhasil disimpan.', team: result },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
