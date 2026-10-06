import { NextRequest } from 'next/server';
import admin, { adminAuth, adminDb } from '@/lib/firebase-admin';
import { employeeCollectionForId, normalizeEmployeeId } from '@/lib/accountGroups';
import { EMPLOYEE_LINK_ROLES, isEmployeeLinkRole, isUserRole, UserRole } from '@/lib/payroll/roles';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import { linkedAccountUidsByUid } from '@/lib/server/linkedAccounts';
import { ownUnitId, UNIT_COLLECTION } from '@/lib/server/satkerFinance';

export const dynamic = 'force-dynamic';

interface UserInput {
  email?: string;
  password?: string;
  displayName?: string;
  satkerName?: string;
  role: UserRole;
  permittedCategories: string[];
  linkedEmployeeId?: string;
  /**
   * The employee this account belongs to, which links it to the person's other
   * accounts for role switching (see `@/lib/accountGroups`). Undefined when the
   * request did not send it (an edit keeps the stored value), null to clear it.
   * Ignored for employee-linked roles, which always use `linkedEmployeeId`.
   */
  personEmployeeId?: string | null;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function normalizedSatkerName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function effectiveSatkerName(
  uid: string,
  profile: Record<string, unknown>,
  unit: Record<string, unknown> | undefined,
): string {
  const savedName = typeof profile.satkerName === 'string' ? profile.satkerName.trim() : '';
  if (savedName) return savedName;
  const editors = Array.isArray(unit?.editorUids) ? unit.editorUids : [];
  const belongsToHead = unit?.autoProvisioned === true || editors.includes(uid);
  const unitName = belongsToHead && typeof unit?.name === 'string' ? unit.name.trim() : '';
  if (unitName) return unitName;
  return typeof profile.displayName === 'string' ? profile.displayName.trim() : '';
}

async function assertSatkerNameAvailable(uid: string, name: string): Promise<void> {
  const heads = await adminDb.collection('users').where('role', '==', 'satker_head_loyalis').get();
  const peers = heads.docs.filter((head) => head.id !== uid);
  const peerNames = await Promise.all(peers.map(async (head) => {
    const unit = await adminDb.collection(UNIT_COLLECTION).doc(ownUnitId(head.id)).get();
    return effectiveSatkerName(head.id, head.data(), unit.data());
  }));
  if (peerNames.some((peerName) => normalizedSatkerName(peerName) === normalizedSatkerName(name))) {
    throw new HttpError(409, 'Nama SatKer Loyalis sudah digunakan akun lain. Pilih nama yang unik.');
  }
}

function parseUserInput(raw: unknown, requirePassword: boolean): UserInput {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Payload pengguna tidak valid.');
  }
  const value = raw as Record<string, unknown>;
  if (!isUserRole(value.role)) {
    throw new HttpError(400, 'Peran pengguna tidak valid.');
  }
  if (
    !Array.isArray(value.permittedCategories) ||
    value.permittedCategories.some((item) => typeof item !== 'string')
  ) {
    throw new HttpError(400, 'Daftar kategori akses tidak valid.');
  }
  if (requirePassword && (typeof value.password !== 'string' || value.password.length < 6)) {
    throw new HttpError(400, 'Kata sandi minimal enam karakter.');
  }
  if (value.email !== undefined && typeof value.email !== 'string') {
    throw new HttpError(400, 'Alamat email tidak valid.');
  }
  if (value.satkerName !== undefined && typeof value.satkerName !== 'string') {
    throw new HttpError(400, 'Nama SatKer Loyalis tidak valid.');
  }
  const satkerName = typeof value.satkerName === 'string' ? value.satkerName.trim() : undefined;
  if (satkerName && satkerName.length > 150) {
    throw new HttpError(400, 'Nama SatKer Loyalis maksimal 150 karakter.');
  }
  if (!requirePassword && value.role === 'satker_head_loyalis' && !satkerName) {
    throw new HttpError(400, 'Nama SatKer Loyalis wajib diisi.');
  }
  let personEmployeeId: string | null | undefined;
  if (value.personEmployeeId === undefined) {
    personEmployeeId = undefined;
  } else if (
    value.personEmployeeId === null ||
    (typeof value.personEmployeeId === 'string' && !value.personEmployeeId.trim())
  ) {
    personEmployeeId = null;
  } else {
    personEmployeeId = normalizeEmployeeId(value.personEmployeeId);
    if (!personEmployeeId) {
      throw new HttpError(400, 'ID pegawai untuk ganti peran tidak valid.');
    }
  }
  if (
    EMPLOYEE_LINK_ROLES.includes(value.role) &&
    (typeof value.linkedEmployeeId !== 'string' || !value.linkedEmployeeId.trim())
  ) {
    throw new HttpError(400, 'Peran ini wajib dihubungkan ke pegawai.');
  }

  return {
    email: typeof value.email === 'string' ? value.email.trim().toLowerCase() : undefined,
    password: typeof value.password === 'string' ? value.password : undefined,
    displayName: typeof value.displayName === 'string' ? value.displayName.trim() : '',
    satkerName,
    role: value.role,
    permittedCategories: Array.from(
      new Set(value.permittedCategories.map((item) => item.trim()).filter(Boolean)),
    ),
    linkedEmployeeId:
      typeof value.linkedEmployeeId === 'string' ? value.linkedEmployeeId.trim() : undefined,
    personEmployeeId,
  };
}

/**
 * The `personEmployeeId` to store: none for Super Admin (never linked), the
 * linked employee for employee-linked roles, otherwise what was sent, or the
 * stored value when nothing was sent.
 */
function personEmployeeIdToSave(input: UserInput, stored: unknown): string | null {
  if (input.role === 'super_admin') return null;
  if (isEmployeeLinkRole(input.role)) return normalizeEmployeeId(input.linkedEmployeeId);
  if (input.personEmployeeId === undefined) return normalizeEmployeeId(stored);
  return input.personEmployeeId;
}

/**
 * A newly chosen employee must exist. Several accounts may name the same one.
 * Employee-linked roles are already checked by `assertEmployeeLink`.
 */
async function assertPersonEmployee(
  input: UserInput,
  id: string | null,
  stored: unknown,
): Promise<void> {
  if (!id || isEmployeeLinkRole(input.role) || id === normalizeEmployeeId(stored)) return;
  const collection = employeeCollectionForId(id);
  const snapshot = collection ? await adminDb.collection(collection).doc(id).get() : null;
  if (!snapshot?.exists) {
    throw new HttpError(409, 'Data pegawai untuk ganti peran tidak ditemukan.');
  }
}

async function assertEmployeeLink(
  input: UserInput,
  excludedUid?: string,
): Promise<void> {
  if (!EMPLOYEE_LINK_ROLES.includes(input.role) || !input.linkedEmployeeId) return;

  const collectionName = input.role === 'loyalis' ? 'Employees_Loyalis' : 'Employees_BlueCollar';
  const employeeSnapshot = await adminDb
    .collection(collectionName)
    .doc(input.linkedEmployeeId)
    .get();
  if (!employeeSnapshot.exists) {
    throw new HttpError(409, 'Data pegawai yang dihubungkan tidak ditemukan.');
  }
  if (
    input.role === 'ketua_shift_satpam' &&
    employeeSnapshot.data()?.employment?.jobCategory !== 'SATPAM'
  ) {
    throw new HttpError(409, 'Ketua Shift wajib terhubung ke pegawai SATPAM.');
  }

  const linkedProfiles = await adminDb
    .collection('users')
    .where('linkedEmployeeId', '==', input.linkedEmployeeId)
    .limit(2)
    .get();
  const conflict = linkedProfiles.docs.find(
    (snapshot) => snapshot.id !== excludedUid && snapshot.data().disabled !== true,
  );
  if (conflict) {
    throw new HttpError(409, 'Pegawai tersebut sudah terhubung ke akun aktif lain.');
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const snapshot = await adminDb.collection('users').get();
    const users = snapshot.docs.map((document) => ({
      uid: document.id,
      ...document.data(),
    }));
    // Which accounts each one can switch to, decided as a switch would, so the
    // page never re-implements the rules.
    const linkedUids = await linkedAccountUidsByUid(users);
    const satkerNames = new Map<string, string>();
    await Promise.all(users.filter((user) => user.role === 'satker_head_loyalis').map(async (user) => {
      const unit = await adminDb.collection(UNIT_COLLECTION).doc(ownUnitId(user.uid)).get();
      satkerNames.set(user.uid, effectiveSatkerName(user.uid, user, unit.data()));
    }));
    return Response.json(
      {
        users: users.map((user) => ({
          ...user,
          ...(user.role === 'satker_head_loyalis'
            ? { satkerName: satkerNames.get(user.uid) || '' }
            : typeof user.satkerName === 'string'
              ? { satkerName: user.satkerName }
              : {}),
          linkedAccountUids: linkedUids.get(user.uid) || [],
        })),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let createdUid: string | undefined;
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const input = parseUserInput(await request.json(), true);
    if (!input.email) {
      throw new HttpError(400, 'Alamat email wajib diisi.');
    }
    if (input.role === 'satker_head_loyalis' && input.satkerName) {
      await assertSatkerNameAvailable('', input.satkerName);
    }
    await assertEmployeeLink(input);
    const personEmployeeId = personEmployeeIdToSave(input, null);
    await assertPersonEmployee(input, personEmployeeId, null);

    const userRecord = await adminAuth.createUser({
      email: input.email,
      password: input.password,
      displayName: input.displayName || undefined,
      disabled: false,
    });
    createdUid = userRecord.uid;

    const profile = {
      email: input.email,
      displayName: input.displayName || '',
      ...(input.role === 'satker_head_loyalis' && input.satkerName
        ? { satkerName: input.satkerName }
        : {}),
      role: input.role,
      permittedCategories: input.permittedCategories,
      linkedEmployeeId: input.linkedEmployeeId || null,
      personEmployeeId,
      disabled: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: actor.uid,
      schemaVersion: 2,
    };
    const batch = adminDb.batch();
    batch.create(adminDb.collection('users').doc(userRecord.uid), profile);
    batch.create(
      newFinancialAuditRef(),
      buildFinancialAuditRecord(actor, {
        action: 'USER_CREATED',
        entityType: 'UserProfile',
        entityId: userRecord.uid,
        reason: 'Pembuatan akun oleh Super Administrator',
        after: {
          email: input.email,
          role: input.role,
          linkedEmployeeId: input.linkedEmployeeId || null,
          personEmployeeId,
          ...(input.role === 'satker_head_loyalis' && input.satkerName
            ? { satkerName: input.satkerName }
            : {}),
        },
      }),
    );
    await batch.commit();

    return Response.json(
      { message: 'User created successfully', user: { uid: userRecord.uid, ...profile } },
      { status: 201 },
    );
  } catch (error: unknown) {
    // Compensate only for the just-created Auth account if its profile could not
    // be committed. This never targets an existing or historical user.
    if (createdUid) {
      try {
        await adminAuth.deleteUser(createdUid);
      } catch (rollbackError) {
        console.error('Failed to roll back newly created Auth account:', rollbackError);
      }
    }
    if (errorCode(error) === 'auth/email-already-exists') {
      return Response.json(
        { error: 'Email tersebut sudah terdaftar di sistem.' },
        { status: 400 },
      );
    }
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const raw = await request.json();
    const uid = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).uid : null;
    if (typeof uid !== 'string' || !uid) {
      throw new HttpError(400, 'UID pengguna wajib diisi.');
    }
    const input = parseUserInput(raw, false);
    await assertEmployeeLink(input, uid);

    const userRef = adminDb.collection('users').doc(uid);
    const beforeSnapshot = await userRef.get();
    if (!beforeSnapshot.exists) {
      throw new HttpError(404, 'Profil pengguna tidak ditemukan.');
    }
    const before = beforeSnapshot.data()!;
    if (uid === actor.uid && input.role !== 'super_admin') {
      throw new HttpError(409, 'Super Administrator tidak dapat menurunkan perannya sendiri.');
    }
    const personEmployeeId = personEmployeeIdToSave(input, before.personEmployeeId);
    await assertPersonEmployee(input, personEmployeeId, before.personEmployeeId);
    if (input.role === 'satker_head_loyalis') {
      await assertSatkerNameAvailable(uid, input.satkerName!);
    }

    try {
      await adminAuth.updateUser(uid, {
        ...(input.email ? { email: input.email } : {}),
        displayName: input.displayName || undefined,
      });
    } catch (error: unknown) {
      if (errorCode(error) === 'auth/email-already-exists') {
        throw new HttpError(400, 'Email tersebut sudah terdaftar di sistem.');
      }
      if (errorCode(error) === 'auth/invalid-email') {
        throw new HttpError(400, 'Format email tidak valid.');
      }
      throw error;
    }

    const after = {
      email: input.email || before.email || '',
      displayName: input.displayName || '',
      ...(input.role === 'satker_head_loyalis' ? { satkerName: input.satkerName! } : {}),
      role: input.role,
      permittedCategories: input.permittedCategories,
      linkedEmployeeId: input.linkedEmployeeId || null,
      personEmployeeId,
      disabled: before.disabled === true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: actor.uid,
      schemaVersion: 2,
    };
    const unitRef = adminDb.collection(UNIT_COLLECTION).doc(ownUnitId(uid));
    const unitAuditRef = adminDb.collection('SatkerFinancialConfigAudit').doc();
    await adminDb.runTransaction(async (transaction) => {
      const [currentSnapshot, unitSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(unitRef),
      ]);
      if (!currentSnapshot.exists) {
        throw new HttpError(404, 'Profil pengguna tidak ditemukan.');
      }
      const unitData = unitSnapshot.data();
      if (input.role === 'satker_head_loyalis') {
        const headsSnapshot = await transaction.get(
          adminDb.collection('users').where('role', '==', 'satker_head_loyalis'),
        );
        const peers = headsSnapshot.docs.filter((head) => head.id !== uid);
        const peerUnits = await Promise.all(peers.map((head) =>
          transaction.get(adminDb.collection(UNIT_COLLECTION).doc(ownUnitId(head.id))),
        ));
        const peerNames = peers.map((head, index) =>
          effectiveSatkerName(head.id, head.data(), peerUnits[index].data()),
        );
        if (peerNames.some((peerName) => normalizedSatkerName(peerName) === normalizedSatkerName(input.satkerName))) {
          throw new HttpError(409, 'Nama SatKer Loyalis sudah digunakan akun lain. Pilih nama yang unik.');
        }
      }
      transaction.set(userRef, after, { merge: true });
      const unitEditors = Array.isArray(unitData?.editorUids) ? unitData.editorUids : [];
      const isHeadUnit = unitData?.autoProvisioned === true || unitEditors.includes(uid);
      if (
        input.role === 'satker_head_loyalis' &&
        isHeadUnit &&
        unitData?.name !== input.satkerName
      ) {
        const updatedUnit = {
          name: input.satkerName,
          revision: Number(unitData?.revision || 0) + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        };
        transaction.set(unitRef, updatedUnit, { merge: true });
        transaction.create(unitAuditRef, {
          action: 'UNIT_UPDATED',
          target: unitRef.id,
          before: unitData,
          after: { ...unitData, ...updatedUnit },
          reason: 'Perubahan nama SatKer Loyalis oleh Super Administrator',
          actorUid: actor.uid,
          actorRole: actor.role,
          at: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'USER_PROFILE_UPDATED',
          entityType: 'UserProfile',
          entityId: uid,
          reason: 'Perubahan akun oleh Super Administrator',
          before: {
            email: currentSnapshot.data()?.email || null,
            role: currentSnapshot.data()?.role || null,
            linkedEmployeeId: currentSnapshot.data()?.linkedEmployeeId || null,
            personEmployeeId: currentSnapshot.data()?.personEmployeeId || null,
            satkerName: currentSnapshot.data()?.satkerName || null,
          },
          after: {
            email: after.email,
            role: after.role,
            linkedEmployeeId: after.linkedEmployeeId,
            personEmployeeId: after.personEmployeeId,
            ...(input.role === 'satker_head_loyalis' ? { satkerName: after.satkerName } : {}),
          },
        }),
      );
    });

    return Response.json({
      message: 'User updated successfully',
      user: { uid, ...after },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// Historical profiles are never deleted. DELETE retains the existing endpoint
// contract for the UI but performs a revocable, audited deactivation.
export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin']);
    const uid = new URL(request.url).searchParams.get('uid');
    if (!uid) {
      throw new HttpError(400, 'UID pengguna wajib diisi.');
    }
    if (uid === actor.uid) {
      throw new HttpError(409, 'Super Administrator tidak dapat menonaktifkan akunnya sendiri.');
    }

    const userRef = adminDb.collection('users').doc(uid);
    const beforeSnapshot = await userRef.get();
    if (!beforeSnapshot.exists) {
      throw new HttpError(404, 'Profil pengguna tidak ditemukan.');
    }
    if (beforeSnapshot.data()?.disabled === true) {
      return Response.json({ message: 'User already disabled', uid, idempotent: true });
    }

    await adminAuth.updateUser(uid, { disabled: true });
    await adminAuth.revokeRefreshTokens(uid);
    await adminDb.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(userRef);
      if (!currentSnapshot.exists) {
        throw new HttpError(404, 'Profil pengguna tidak ditemukan.');
      }
      transaction.set(
        userRef,
        {
          disabled: true,
          disabledAt: admin.firestore.FieldValue.serverTimestamp(),
          disabledByUid: actor.uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          schemaVersion: 2,
        },
        { merge: true },
      );
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'USER_DISABLED',
          entityType: 'UserProfile',
          entityId: uid,
          reason: 'Penonaktifan akun tanpa menghapus riwayat',
          before: { disabled: currentSnapshot.data()?.disabled === true },
          after: { disabled: true },
        }),
      );
    });

    return Response.json({
      message: 'User disabled successfully; history retained',
      uid,
      idempotent: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
