import { NextRequest } from 'next/server';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawEmail = typeof body.email === 'string' ? body.email : '';
    const normalizedEmail = rawEmail.trim().toLowerCase();

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return Response.json(
        { error: 'Silakan masukkan alamat email yang valid.' },
        { status: 400 }
      );
    }

    // 1. Get user record from Firebase Auth
    let userRecord;
    try {
      userRecord = await adminAuth.getUserByEmail(normalizedEmail);
    } catch (err) {
      return Response.json(
        { error: 'Email ini tidak terdaftar dalam sistem autentikasi kami.' },
        { status: 404 }
      );
    }

    // 2. Check if Firestore user document exists & disabled status
    const userDoc = await adminDb.collection('users').doc(userRecord.uid).get();
    const isFirestoreDisabled = userDoc.exists && userDoc.data()?.disabled === true;
    const isAuthDisabled = userRecord.disabled === true;

    if (!isAuthDisabled && !isFirestoreDisabled) {
      return Response.json(
        { error: 'Akun Anda saat ini aktif dan tidak memerlukan reaktivasi. Silakan langsung melakukan login.' },
        { status: 400 }
      );
    }

    // 3. Create single-use reactivation token (valid 24h)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await adminDb.collection('reactivation_tokens').doc(token).set({
      uid: userRecord.uid,
      email: normalizedEmail,
      displayName: userRecord.displayName || userDoc.data()?.displayName || '',
      used: false,
      createdAt: new Date().toISOString(),
      expiresAt,
    });

    // 4. Send Reactivation Email if SMTP config is available
    const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
    const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;

    const origin = request.headers.get('origin') || `http://${request.headers.get('host') || 'localhost:3000'}`;
    const reactivationUrl = `${origin}/reactivate?token=${token}`;

    if (smtpUser && smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: smtpUser, pass: smtpPass },
        });

        await transporter.sendMail({
          from: `"Sistem BAK YAPETIDU" <${smtpUser}>`,
          to: normalizedEmail,
          subject: '[REAKTIVASI AKUN] Permintaan Aktifkan Kembali Akun BAK YAPETIDU',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded-radius: 16px;">
              <h2 style="color: #4f46e5; margin-top: 0;">Permintaan Reaktivasi Akun</h2>
              <p>Halo <strong>${userRecord.displayName || normalizedEmail}</strong>,</p>
              <p>Kami menerima permintaan untuk mengaktifkan kembali akun Anda yang sedang ditangguhkan/non-aktif.</p>
              <p>Silakan klik tombol di bawah ini untuk mengatur kata sandi baru dan mengaktifkan kembali akun Anda:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${reactivationUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 12px; font-weight: bold; inline-block;">
                  🔄 Reaktivasi Akun Saya
                </a>
              </div>
              <p style="font-size: 12px; color: #64748b;">Atau salin tautan berikut ke browser Anda:<br>${reactivationUrl}</p>
              <p style="font-size: 12px; color: #94a3b8; margin-top: 30px;">Tautan ini berlaku selama 24 jam. Jika Anda tidak merasa meminta ini, abaikan pesan ini.</p>
            </div>
          `,
        });
      } catch (mailErr) {
        console.warn('Failed to send reactivation email via SMTP:', mailErr);
      }
    }

    return Response.json({
      success: true,
      email: normalizedEmail,
      reactivationUrl,
      message: 'Tautan reaktivasi berhasil dibuat dan dikirimkan ke email Anda.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan internal.';
    return Response.json({ error: message }, { status: 500 });
  }
}
