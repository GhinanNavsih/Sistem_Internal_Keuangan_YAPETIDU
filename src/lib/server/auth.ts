import { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { isUserRole, UserRole } from '@/lib/payroll/roles';

export interface AuthenticatedProfile {
  uid: string;
  email: string | null;
  role: UserRole;
  displayName: string;
  linkedEmployeeId?: string;
  permittedCategories: string[];
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function requireAuthenticatedProfile(
  request: NextRequest,
): Promise<AuthenticatedProfile> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Sesi tidak ditemukan.');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new HttpError(401, 'Token autentikasi tidak valid.');
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch (err) {
    console.error('verifyIdToken failed:', err);
    throw new HttpError(401, 'Sesi tidak valid atau sudah dicabut.');
  }

  const profileSnapshot = await adminDb.collection('users').doc(decoded.uid).get();
  const profile = profileSnapshot.data();
  if (!profileSnapshot.exists || !profile || !isUserRole(profile.role)) {
    throw new HttpError(403, 'Profil atau peran pengguna tidak valid.');
  }
  if (profile.disabled === true) {
    throw new HttpError(403, 'Akun ini telah dinonaktifkan.');
  }

  return {
    uid: decoded.uid,
    email: decoded.email || null,
    role: profile.role,
    displayName: String(profile.displayName || decoded.name || ''),
    linkedEmployeeId:
      typeof profile.linkedEmployeeId === 'string' ? profile.linkedEmployeeId : undefined,
    permittedCategories: Array.isArray(profile.permittedCategories)
      ? profile.permittedCategories.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

export function requireRole(
  profile: AuthenticatedProfile,
  allowedRoles: readonly UserRole[],
): void {
  if (!allowedRoles.includes(profile.role)) {
    throw new HttpError(403, 'Anda tidak memiliki kewenangan untuk tindakan ini.');
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : 'Terjadi kesalahan internal.';
  console.error('Protected API error:', error);
  return Response.json({ error: message }, { status: 500 });
}
