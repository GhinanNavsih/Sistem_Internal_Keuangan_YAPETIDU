import { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const email = new URL(request.url).searchParams.get('email');
    if (!email || !email.includes('@')) {
      return Response.json({ exists: false, disabled: false });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check Firebase Auth
    let userRecord;
    try {
      userRecord = await adminAuth.getUserByEmail(normalizedEmail);
    } catch (err) {
      return Response.json({ exists: false, disabled: false });
    }

    // Check Firestore user doc
    const userDoc = await adminDb.collection('users').doc(userRecord.uid).get();
    const isFirestoreDisabled = userDoc.exists && userDoc.data()?.disabled === true;
    const isAuthDisabled = userRecord.disabled === true;

    const isDisabled = isAuthDisabled || isFirestoreDisabled;

    return Response.json({
      exists: true,
      disabled: isDisabled,
      displayName: userRecord.displayName || userDoc.data()?.displayName || '',
      email: normalizedEmail,
    });
  } catch (error) {
    return Response.json({ exists: false, disabled: false });
  }
}
