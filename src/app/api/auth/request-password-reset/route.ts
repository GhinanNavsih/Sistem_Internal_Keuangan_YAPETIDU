import { NextRequest } from 'next/server';
import nodemailer from 'nodemailer';
import { adminAuth } from '@/lib/firebase-admin';
import { buildPasswordResetEmail, PASSWORD_RESET_REPLY_TO } from '@/lib/server/passwordResetEmail';

export const dynamic = 'force-dynamic';

const GENERIC_MESSAGE =
  'Jika email ini terdaftar, tautan pengaturan ulang kata sandi telah dikirim. Silakan periksa kotak masuk (atau folder spam) Anda.';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!email || !email.includes('@')) {
    return Response.json({ error: 'Format email tidak valid.' }, { status: 400 });
  }

  try {
    const link = await adminAuth.generatePasswordResetLink(email);

    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpUser || !smtpPass) {
      throw new Error('SMTP_USER or SMTP_PASS is not set');
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: smtpUser, pass: smtpPass },
    });

    const { subject, html, text } = buildPasswordResetEmail({ email, link });
    await transporter.sendMail({
      from: `"BAK UNIPDU" <${smtpUser}>`,
      replyTo: PASSWORD_RESET_REPLY_TO,
      to: email,
      subject,
      html,
      text,
    });
  } catch (err) {
    // Same reply for unknown emails, so this form can't be used to check which emails have accounts.
    if ((err as { code?: string })?.code !== 'auth/user-not-found') {
      console.error('Password reset email failed:', err);
      return Response.json(
        { error: 'Gagal mengirim email pemulihan. Silakan coba lagi nanti.' },
        { status: 500 }
      );
    }
  }

  return Response.json({ success: true, message: GENERIC_MESSAGE });
}
