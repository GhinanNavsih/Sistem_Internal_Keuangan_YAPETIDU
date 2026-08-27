import { NextRequest } from 'next/server';
import { requireAuthenticatedProfile, errorResponse, HttpError } from '@/lib/server/auth';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    // 1. Verify caller is a valid authenticated profile
    const callerProfile = await requireAuthenticatedProfile(request);

    // 2. Ensure caller is strictly super_admin
    if (callerProfile.role !== 'super_admin') {
      throw new HttpError(403, 'Hanya Super Admin yang diizinkan menggunakan fitur impersonasi.');
    }

    const body = await request.json();
    const { targetUid } = body;

    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpError(400, 'Target UID wajib diisi.');
    }

    if (targetUid === callerProfile.uid) {
      throw new HttpError(400, 'Anda sudah login sebagai akun ini.');
    }

    // 3. Check target user exists in Firestore & Firebase Auth
    const targetDoc = await adminDb.collection('users').doc(targetUid).get();
    if (!targetDoc.exists) {
      throw new HttpError(404, 'Pengguna target tidak ditemukan.');
    }

    const targetData = targetDoc.data();
    if (targetData?.disabled === true) {
      throw new HttpError(400, 'Tidak dapat meng-impersonasi akun yang sedang dinonaktifkan.');
    }

    try {
      const userRecord = await adminAuth.getUser(targetUid);
      if (userRecord.disabled) {
        throw new HttpError(400, 'Akun ini telah dinonaktifkan (Disabled) di Firebase Authentication.');
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      console.warn('Could not verify Firebase Auth record status:', err);
    }

    // 4. Create single-use restore session in admin_impersonation_sessions
    const sessionId = crypto.randomUUID();
    const restoreSecret = crypto.randomBytes(32).toString('hex');

    await adminDb.collection('admin_impersonation_sessions').doc(sessionId).set({
      superAdminUid: callerProfile.uid,
      superAdminEmail: callerProfile.email,
      targetUid,
      targetEmail: targetData?.email || '',
      restoreSecret,
      createdAt: new Date().toISOString(),
    });

    // 5. Audit log
    await adminDb.collection('audit_logs').add({
      action: 'ADMIN_IMPERSONATION_STARTED',
      actorUid: callerProfile.uid,
      actorEmail: callerProfile.email,
      targetUid,
      targetEmail: targetData?.email || '',
      timestamp: new Date().toISOString(),
    });

    // 6. Generate Firebase custom token for target user
    const customToken = await adminAuth.createCustomToken(targetUid, {
      impersonatedBy: callerProfile.uid,
    });

    return Response.json({
      success: true,
      customToken,
      sessionId,
      restoreSecret,
      targetProfile: {
        uid: targetUid,
        email: targetData?.email || '',
        displayName: targetData?.displayName || '',
        role: targetData?.role || 'user',
        permittedCategories: Array.isArray(targetData?.permittedCategories)
          ? targetData.permittedCategories.filter(
              (category: unknown): category is string => typeof category === 'string',
            )
          : [],
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
