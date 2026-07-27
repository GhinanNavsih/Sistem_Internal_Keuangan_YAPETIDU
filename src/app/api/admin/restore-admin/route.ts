import { NextRequest } from 'next/server';
import { errorResponse, HttpError } from '@/lib/server/auth';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, restoreSecret } = body;

    if (!sessionId || !restoreSecret || typeof sessionId !== 'string' || typeof restoreSecret !== 'string') {
      throw new HttpError(400, 'Sesi impersonasi atau token pemulihan tidak valid.');
    }

    const sessionRef = adminDb.collection('admin_impersonation_sessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      throw new HttpError(404, 'Sesi pemulihan tidak ditemukan atau sudah kadaluwarsa.');
    }

    const sessionData = sessionDoc.data();
    if (sessionData?.restoreSecret !== restoreSecret) {
      throw new HttpError(403, 'Kunci pemulihan tidak sesuai.');
    }

    const superAdminUid = sessionData.superAdminUid;

    // Verify Super Admin profile still exists and is super_admin
    const adminUserDoc = await adminDb.collection('users').doc(superAdminUid).get();
    if (!adminUserDoc.exists || adminUserDoc.data()?.role !== 'super_admin') {
      throw new HttpError(403, 'Akun Super Admin asal tidak lagi valid.');
    }

    // Clean up session document
    await sessionRef.delete();

    // Audit log
    await adminDb.collection('audit_logs').add({
      action: 'ADMIN_IMPERSONATION_ENDED',
      actorUid: superAdminUid,
      actorEmail: sessionData.superAdminEmail,
      impersonatedUid: sessionData.targetUid,
      timestamp: new Date().toISOString(),
    });

    // Create Custom Token for Super Admin
    const customToken = await adminAuth.createCustomToken(superAdminUid);

    return Response.json({
      success: true,
      customToken,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
