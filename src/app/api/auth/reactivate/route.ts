import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// GET: Verify token validity before showing the password form
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Token reaktivasi wajib disertakan.' }, { status: 400 });
    }

    const tokenDocRef = adminDb.collection('reactivation_tokens').doc(token);
    const tokenSnap = await tokenDocRef.get();

    if (!tokenSnap.exists) {
      return NextResponse.json({ error: 'Tautan reaktivasi tidak valid.' }, { status: 400 });
    }

    const tokenData = tokenSnap.data();
    if (!tokenData) {
      return NextResponse.json({ error: 'Tautan reaktivasi kosong.' }, { status: 400 });
    }

    const { email, displayName, expiresAt, used } = tokenData;

    // Check if used
    if (used) {
      return NextResponse.json({ error: 'Tautan reaktivasi ini sudah digunakan sebelumnya.' }, { status: 400 });
    }

    // Check if expired
    if (new Date(expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Tautan reaktivasi ini telah kedaluwarsa (berlaku maksimal 7 hari).' }, { status: 400 });
    }

    return NextResponse.json({
      valid: true,
      email,
      displayName,
    });
  } catch (error: any) {
    console.error('Reactivation Verification API error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan internal server.' }, { status: 500 });
  }
}

// POST: Restores access and sets the new password
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, password } = body;

    if (!token) {
      return NextResponse.json({ error: 'Token reaktivasi wajib disertakan.' }, { status: 400 });
    }

    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Kata sandi baru wajib diisi dan minimal terdiri dari 6 karakter.' }, { status: 400 });
    }

    const tokenDocRef = adminDb.collection('reactivation_tokens').doc(token);
    const tokenSnap = await tokenDocRef.get();

    if (!tokenSnap.exists) {
      return NextResponse.json({ error: 'Tautan reaktivasi tidak valid.' }, { status: 400 });
    }

    const tokenData = tokenSnap.data();
    if (!tokenData) {
      return NextResponse.json({ error: 'Tautan reaktivasi kosong.' }, { status: 400 });
    }

    const { uid, expiresAt, used } = tokenData;

    // Check if used
    if (used) {
      return NextResponse.json({ error: 'Tautan reaktivasi ini sudah digunakan sebelumnya.' }, { status: 400 });
    }

    // Check if expired
    if (new Date(expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Tautan reaktivasi ini telah kedaluwarsa (berlaku maksimal 7 hari).' }, { status: 400 });
    }

    // Check if user exists in Firestore
    const userDocRef = adminDb.collection('users').doc(uid);
    const userSnap = await userDocRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Profil pengguna tidak ditemukan di sistem.' }, { status: 400 });
    }

    // 1. Re-enable user in Firebase Auth and set their new password
    try {
      await adminAuth.updateUser(uid, {
        disabled: false,
        password: password,
      });
    } catch (authErr: any) {
      console.error(`Firebase Auth update failed for user ${uid}:`, authErr);
      if (authErr.code === 'auth/user-not-found') {
        return NextResponse.json({ error: 'Akun autentikasi tidak ditemukan.' }, { status: 404 });
      }
      throw authErr;
    }

    // 2. Update status in Firestore user doc
    await userDocRef.update({
      status: 'active',
      updatedAt: new Date().toISOString(),
    });

    // 3. Mark the token as used
    await tokenDocRef.update({
      used: true,
      usedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: 'Kata sandi Anda berhasil diperbarui dan akun Anda telah aktif kembali. Silakan masuk menggunakan kata sandi baru Anda.',
    });
  } catch (error: any) {
    console.error('Reactivation API error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan internal server.' }, { status: 500 });
  }
}
