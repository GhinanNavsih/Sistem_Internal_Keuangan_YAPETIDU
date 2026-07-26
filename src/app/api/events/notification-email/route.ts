import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { requireAuthenticatedProfile } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const body = await request.json();

    const { recipientEmail, recipientName, eventName, status, reviewNote } = body;

    if (!recipientEmail || typeof recipientEmail !== 'string') {
      return NextResponse.json({ error: 'Email penerima wajib diisi' }, { status: 400 });
    }

    const smtpUser = process.env.SMTP_USER || '';
    const smtpPass = process.env.SMTP_PASS || '';

    if (!smtpUser || !smtpPass) {
      console.warn('SMTP Google belum dikonfigurasi. Notifikasi email dilewati.');
      return NextResponse.json({ success: false, message: 'SMTP credentials not configured.' });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    let statusTitle = '';
    let statusBadgeColor = '#4f46e5';
    let statusDescription = '';

    switch (status) {
      case 'proposal_approved':
        statusTitle = 'Proposal Anggaran Event Disetujui';
        statusBadgeColor = '#10b981';
        statusDescription = 'Proposal anggaran kegiatan Anda telah disetujui oleh Super Admin / Keuangan. Kegiatan siap dilaksanakan.';
        break;
      case 'proposal_revision':
        statusTitle = 'Proposal Anggaran Perlu Revisi';
        statusBadgeColor = '#f97316';
        statusDescription = 'Proposal anggaran kegiatan Anda memerlukan perbaikan/revisi. Silakan periksa catatan review berikut.';
        break;
      case 'approved':
        statusTitle = 'Laporan Pertanggungjawaban (LPJ) Disetujui';
        statusBadgeColor = '#10b981';
        statusDescription = 'Laporan kegiatan & pencairan vakasi Anda telah disetujui dan disinkronisasikan ke sistem payroll.';
        break;
      case 'revision_needed':
        statusTitle = 'Laporan (LPJ) Perlu Revisi';
        statusBadgeColor = '#f97316';
        statusDescription = 'Laporan kegiatan Anda membutuhkan revisi sebelum pencairan vakasi disetujui.';
        break;
      case 'declined':
        statusTitle = 'Pengajuan Event Ditolak';
        statusBadgeColor = '#ef4444';
        statusDescription = 'Pengajuan kegiatan Anda ditolak oleh Super Admin.';
        break;
      default:
        statusTitle = 'Update Status Event Vakasi';
    }

    const safeEventName = escapeHtml(eventName || 'Vakasi Event');
    const safeRecipientName = escapeHtml(recipientName || 'Kepala SatKer');
    const safeReviewNote = reviewNote ? escapeHtml(reviewNote) : '';

    const htmlBody = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }
          .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          .header { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
          .badge { display: inline-block; padding: 6px 14px; border-radius: 20px; color: #ffffff; background-color: ${statusBadgeColor}; font-weight: 700; font-size: 13px; margin-bottom: 16px; }
          .content { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
          .note-box { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 16px; margin-top: 16px; font-size: 13px; color: #9a3412; }
          .footer { font-size: 12px; color: #94a3b8; border-t: 1px solid #f1f5f9; padding-top: 16px; margin-top: 24px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">Sistem Keuangan Internal UNIPDU / YAPETIDU</div>
          <div class="badge">${statusTitle}</div>
          <div class="content">
            <p>Yth. <strong>${safeRecipientName}</strong>,</p>
            <p>Pemberitahuan status terkini mengenai kegiatan <strong>"${safeEventName}"</strong>:</p>
            <p style="background: #f1f5f9; padding: 12px 16px; border-radius: 8px; font-weight: 600; color: #334155;">
              ${statusDescription}
            </p>
            ${
              safeReviewNote
                ? `<div class="note-box">
                    <strong>Catatan Review dari Admin:</strong><br/>
                    "${safeReviewNote}"
                   </div>`
                : ''
            }
            <p style="margin-top: 20px;">Silakan login ke portal Keuangan Internal untuk melihat detail selengkapnya.</p>
          </div>
          <div class="footer">
            Email ini dikirim secara otomatis oleh Sistem Keuangan YAPETIDU / UNIPDU. Harap tidak membalas email ini.
          </div>
        </div>
      </body>
    </html>
    `;

    await transporter.sendMail({
      from: `"Keuangan UNIPDU" <${smtpUser}>`,
      to: recipientEmail,
      subject: `[BAK Keuangan] ${statusTitle}: ${eventName}`,
      html: htmlBody,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Error sending notification email:', err);
    return NextResponse.json({ error: err.message || 'Gagal mengirim email' }, { status: 500 });
  }
}
