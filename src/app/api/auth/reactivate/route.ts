import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminAuth, adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

function tokenFromRequest(request: NextRequest): string {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
    throw new Error('Tautan reaktivasi tidak valid.');
  }
  return token;
}

function isExpired(value: unknown): boolean {
  const timestamp =
    value instanceof admin.firestore.Timestamp
      ? value.toMillis()
      : new Date(String(value || '')).getTime();
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const token = tokenFromRequest(request);
    const snapshot = await adminDb.collection('reactivation_tokens').doc(token).get();
    const data = snapshot.data();
    if (
      !snapshot.exists ||
      !data ||
      data.used === true ||
      data.processing === true ||
      isExpired(data.expiresAt)
    ) {
      return Response.json(
        { error: 'Tautan reaktivasi tidak valid, sedang diproses, atau kedaluwarsa.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json(
      {
        valid: true,
        email: data.email,
        displayName: data.displayName,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Tautan reaktivasi tidak valid.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(request: NextRequest) {
  const claimId = randomUUID();
  let tokenRef: FirebaseFirestore.DocumentReference | undefined;
  try {
    const body = await request.json();
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
      return Response.json({ error: 'Tautan reaktivasi tidak valid.' }, { status: 400 });
    }
    if (password.length < 10 || password.length > 128) {
      return Response.json(
        { error: 'Kata sandi baru wajib berisi 10–128 karakter.' },
        { status: 400 },
      );
    }

    tokenRef = adminDb.collection('reactivation_tokens').doc(token);
    const claim = await adminDb.runTransaction(async (transaction) => {
      const tokenSnapshot = await transaction.get(tokenRef!);
      const tokenData = tokenSnapshot.data();
      if (
        !tokenSnapshot.exists ||
        !tokenData ||
        tokenData.used === true ||
        tokenData.processing === true ||
        isExpired(tokenData.expiresAt) ||
        typeof tokenData.uid !== 'string'
      ) {
        throw new Error('Tautan reaktivasi tidak valid, sudah digunakan, atau kedaluwarsa.');
      }
      const userRef = adminDb.collection('users').doc(tokenData.uid);
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists) {
        throw new Error('Profil pengguna tidak ditemukan di sistem.');
      }
      transaction.set(
        tokenRef!,
        {
          processing: true,
          processingClaimId: claimId,
          processingAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { uid: tokenData.uid as string, userRef };
    });

    try {
      await adminAuth.updateUser(claim.uid, {
        disabled: false,
        password,
      });
      await adminAuth.revokeRefreshTokens(claim.uid);
    } catch (error) {
      await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(tokenRef!);
        if (snapshot.data()?.processingClaimId === claimId && snapshot.data()?.used !== true) {
          transaction.set(
            tokenRef!,
            {
              processing: false,
              processingClaimId: null,
              processingFailedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
      });
      throw error;
    }

    await adminDb.runTransaction(async (transaction) => {
      const [tokenSnapshot, userSnapshot] = await Promise.all([
        transaction.get(tokenRef!),
        transaction.get(claim.userRef),
      ]);
      if (
        tokenSnapshot.data()?.processingClaimId !== claimId ||
        tokenSnapshot.data()?.used === true ||
        !userSnapshot.exists
      ) {
        throw new Error('Klaim reaktivasi berubah sebelum diselesaikan.');
      }
      const now = admin.firestore.FieldValue.serverTimestamp();
      transaction.set(
        claim.userRef,
        {
          disabled: false,
          status: 'active',
          reactivatedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
      transaction.set(
        tokenRef!,
        {
          used: true,
          usedAt: now,
          processing: false,
          processingClaimId: null,
        },
        { merge: true },
      );
      transaction.create(adminDb.collection('FinancialAuditLogs').doc(), {
        action: 'USER_REACTIVATED',
        entityType: 'UserProfile',
        entityId: claim.uid,
        reason: 'Reaktivasi mandiri menggunakan token satu-kali',
        actorUid: claim.uid,
        actorRole: 'self_service_reactivation',
        actorEmail: userSnapshot.data()?.email || null,
        before: { disabled: userSnapshot.data()?.disabled === true },
        after: { disabled: false },
        metadata: { tokenDocumentId: tokenRef!.id },
        occurredAt: now,
        schemaVersion: 1,
      });
    });

    return Response.json({
      success: true,
      message: 'Kata sandi diperbarui dan akun aktif kembali. Silakan masuk.',
    });
  } catch (error: unknown) {
    console.error('Reactivation API error:', error);
    const message =
      errorCode(error) === 'auth/user-not-found'
        ? 'Akun autentikasi tidak ditemukan.'
        : error instanceof Error
          ? error.message
          : 'Terjadi kesalahan internal server.';
    return Response.json({ error: message }, { status: 400 });
  }
}
