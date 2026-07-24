import { NextRequest } from 'next/server';
import admin, { adminAuth, adminDb } from '@/lib/firebase-admin';
import { isUserRole, UserRole } from '@/lib/payroll/roles';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';

export const dynamic = 'force-dynamic';

const EMPLOYEE_LINK_ROLES: readonly UserRole[] = [
  'honorer',
  'loyalis',
  'ketua_shift_satpam',
];

interface UserInput {
  email?: string;
  password?: string;
  displayName?: string;
  role: UserRole;
  permittedCategories: string[];
  linkedEmployeeId?: string;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
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
    role: value.role,
    permittedCategories: Array.from(
      new Set(value.permittedCategories.map((item) => item.trim()).filter(Boolean)),
    ),
    linkedEmployeeId:
      typeof value.linkedEmployeeId === 'string' ? value.linkedEmployeeId.trim() : undefined,
  };
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
    return Response.json(
      {
        users: snapshot.docs.map((document) => ({
          uid: document.id,
          ...document.data(),
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
    await assertEmployeeLink(input);

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
      role: input.role,
      permittedCategories: input.permittedCategories,
      linkedEmployeeId: input.linkedEmployeeId || null,
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
      role: input.role,
      permittedCategories: input.permittedCategories,
      linkedEmployeeId: input.linkedEmployeeId || null,
      disabled: before.disabled === true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: actor.uid,
      schemaVersion: 2,
    };
    await adminDb.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(userRef);
      if (!currentSnapshot.exists) {
        throw new HttpError(404, 'Profil pengguna tidak ditemukan.');
      }
      transaction.set(userRef, after, { merge: true });
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
          },
          after: {
            email: after.email,
            role: after.role,
            linkedEmployeeId: after.linkedEmployeeId,
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
