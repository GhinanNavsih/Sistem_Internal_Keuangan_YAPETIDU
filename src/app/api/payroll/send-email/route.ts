import { NextRequest, NextResponse } from 'next/server';
import nodemailer, { SendMailOptions } from 'nodemailer';
import admin, { adminDb } from '@/lib/firebase-admin';
import { isTransferEligibleStatus } from '@/lib/payroll/domain';
import { FINANCE_ROLES } from '@/lib/payroll/roles';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function getPayrollEmployee(employeeId: string) {
  for (const collectionName of ['Employees_BlueCollar', 'Employees_Loyalis']) {
    const snapshot = await adminDb.collection(collectionName).doc(employeeId).get();
    if (snapshot.exists) {
      const data = snapshot.data()!;
      return {
        name: String(data.name || data.personal_info?.name || ''),
        email: String(data.email || data.personal_info?.email || ''),
      };
    }
  }
  throw new HttpError(404, 'Data karyawan tidak ditemukan.');
}

function assertPdfBase64(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 14_000_000) {
    throw new HttpError(413, 'Lampiran PDF terlalu besar atau tidak valid.');
  }
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length > 10_000_000 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new HttpError(400, 'Lampiran wajib berupa PDF valid maksimal 10 MB.');
  }
  return value;
}

export async function POST(request: NextRequest) {
  let deliveryRef: FirebaseFirestore.DocumentReference | null = null;
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, FINANCE_ROLES);
    const body = await request.json();
    const employeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
    const dbPeriod = typeof body.dbPeriod === 'string' ? body.dbPeriod : '';
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(employeeId) ||
      !/^\d{4}_\d{2}$/.test(dbPeriod) ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)
    ) {
      throw new HttpError(400, 'employeeId, dbPeriod, atau requestId tidak valid.');
    }

    const slipId = `${dbPeriod}_${employeeId}`;
    const slipSnapshot = await adminDb.collection('PayrollSlipStates').doc(slipId).get();
    if (!slipSnapshot.exists || !isTransferEligibleStatus(slipSnapshot.data()?.status)) {
      throw new HttpError(409, 'Email hanya dapat dikirim untuk slip terkunci.');
    }
    const slip = slipSnapshot.data()!;
    const employee = await getPayrollEmployee(employeeId);
    if (!employee.email || !employee.name) {
      throw new HttpError(409, 'Nama atau email resmi karyawan belum lengkap.');
    }

    const email = employee.email;
    const employeeName = employee.name;
    const period = dbPeriod.replace('_', '-');
    const pdfBase64 = assertPdfBase64(body.pdfBase64);
    if (!pdfBase64) {
      throw new HttpError(400, 'Lampiran PDF slip final wajib disertakan.');
    }
    const totalEarnings = Number(slip.totalEarnings) || (slip.earnings || []).reduce(
      (sum: number, item: { amount?: number }) => sum + Number(item.amount || 0),
      0,
    );
    const totalDeductions = Number(slip.totalDeductions) || (slip.deductions || []).reduce(
      (sum: number, item: { amount?: number }) => sum + Number(item.amount || 0),
      0,
    );
    const netSalary = totalEarnings - totalDeductions;
    const formatIDR = (amount: number) => `Rp${amount.toLocaleString('id-ID')}`;
    const earningsText = (slip.earnings || [])
      .map((item: { label?: string; amount?: number }) =>
        `• ${String(item.label || '')}: ${formatIDR(Number(item.amount || 0))}`)
      .join('\n');
    const deductionsText = (slip.deductions || []).length
      ? (slip.deductions || [])
          .map((item: { label?: string; amount?: number }) =>
            `• ${String(item.label || '')}: ${formatIDR(Number(item.amount || 0))}`)
          .join('\n')
      : '• Tidak ada potongan';
    const textBreakdown =
      `PENDAPATAN:\n${earningsText}\nTotal Pendapatan: ${formatIDR(totalEarnings)}\n\n` +
      `POTONGAN:\n${deductionsText}\nTotal Potongan: ${formatIDR(totalDeductions)}\n\n` +
      `GAJI BERSIH (Diterima): ${formatIDR(netSalary)}`;

    deliveryRef = adminDb
      .collection('PayrollDeliveryEvents')
      .doc(`${slipId}__email__${requestId}`);
    const claimed = await adminDb.runTransaction(async (transaction) => {
      const deliverySnapshot = await transaction.get(deliveryRef!);
      if (deliverySnapshot.data()?.status === 'sent') return false;
      if (deliverySnapshot.data()?.status === 'sending') {
        throw new HttpError(409, 'Permintaan pengiriman yang sama sedang diproses.');
      }
      transaction.set(deliveryRef!, {
        slipId,
        employeeId,
        dbPeriod,
        channel: 'email',
        recipient: email,
        status: 'sending',
        requestedBy: actor.uid,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!claimed) {
      return NextResponse.json({ success: true, idempotent: true });
    }

    // Try to extract net salary from textBreakdown and spell it out
    let terbilangText = '';
    if (textBreakdown) {
      const match = textBreakdown.match(/GAJI BERSIH\s*\(Diterima\):\s*(?:Rp)?\s*([0-9.,]+)/i);
      if (match) {
        const cleanAmount = parseInt(match[1].replace(/\./g, '').replace(/,/g, ''), 10);
        if (!isNaN(cleanAmount)) {
          terbilangText = `Terbilang: "${terbilang(cleanAmount)} Rupiah"`;
        }
      }
    }

    const smtpUser = process.env.SMTP_USER || '';
    const smtpPass = process.env.SMTP_PASS || '';

    if (!smtpUser || !smtpPass) {
      throw new HttpError(
        500,
        'Konfigurasi SMTP Google belum tersedia di lingkungan server.',
      );
    }

    // Configure SMTP Transporter for Google Workspace
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const formattedPeriod = period.toUpperCase();
    const safeEmployeeName = escapeHtml(employeeName);
    const safeBreakdown = escapeHtml(textBreakdown);
    const filename = `Slip_Gaji_YAPETIDU_${employeeId}_${dbPeriod}.pdf`;

    // Modern HTML template matching the premium theme
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #f8fafc;
            color: #334155;
            margin: 0;
            padding: 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -4px rgba(0, 0, 0, 0.05);
            border: 1px solid #f1f5f9;
          }
          .header {
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            padding: 40px 30px;
            text-align: center;
            color: #ffffff;
          }
          .header h1 {
            margin: 0 0 10px 0;
            font-size: 24px;
            font-weight: 700;
            letter-spacing: -0.025em;
          }
          .header p {
            margin: 0;
            font-size: 14px;
            opacity: 0.9;
            font-weight: 500;
          }
          .content {
            padding: 40px 30px;
          }
          .greeting {
            font-size: 16px;
            font-weight: 600;
            color: #1e293b;
            margin-bottom: 20px;
          }
          .message {
            font-size: 14px;
            line-height: 1.6;
            color: #475569;
            margin-bottom: 30px;
          }
          .breakdown-box {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 30px;
            font-family: 'Courier New', Courier, monospace;
            white-space: pre-wrap;
            font-size: 13px;
            color: #334155;
            line-height: 1.4;
          }
          .footer {
            background-color: #f8fafc;
            padding: 24px;
            text-align: center;
            font-size: 12px;
            color: #64748b;
            border-top: 1px solid #f1f5f9;
          }
          .footer a {
            color: #4f46e5;
            text-decoration: none;
            font-weight: 500;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>SLIP GAJI RESMI</h1>
            <p>Yayasan Pendidikan Tinggi Darul 'Ulum (YAPETIDU)</p>
          </div>
          <div class="content">
            <div class="greeting" style="font-size: 15px; color: #1e293b; line-height: 1.5;">
              Kepada Yth.<br>
              <strong>Bapak/Ibu ${safeEmployeeName}</strong>
            </div>
            <div class="message" style="margin-top: 15px; font-size: 14px; line-height: 1.6; color: #475569;">
              Assalamualaikum wr. wb.<br><br>
              Dengan hormat,<br>
              Bersama dengan email ini, kami sampaikan dokumen resmi Slip Gaji Anda untuk periode <strong>${formattedPeriod}</strong>. Dokumen PDF resmi telah kami lampirkan langsung pada email ini dan dapat Anda unduh serta cetak sebagai bukti pembayaran yang sah.
            </div>
            
            ${textBreakdown ? `
              <div style="font-size: 14px; font-weight: 600; color: #1e293b; margin-bottom: 10px;">Rincian Slip Gaji:</div>
              <div class="breakdown-box">${safeBreakdown}</div>
              ${terbilangText ? `
                <div style="font-size: 13px; font-weight: bold; color: #4f46e5; margin-top: -20px; margin-bottom: 25px; font-style: italic;">
                  ${terbilangText}
                </div>
              ` : ''}
            ` : ''}
            
            <div class="message" style="margin-top: 20px; font-size: 13px; font-style: italic;">
              Catatan: Jangan memberikan lampiran slip gaji ini kepada pihak lain untuk menjaga kerahasiaan data pribadi Anda.
            </div>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} YAPETIDU. All rights reserved.<br>
            Jl. Raya Rejoso, Peterongan, Jombang, Jawa Timur.
          </div>
        </div>
      </body>
      </html>
    `;

    // Define Mail options
    const mailOptions: SendMailOptions = {
      from: `"YAPETIDU Finance" <${smtpUser}>`,
      to: email,
      subject: `[SLIP GAJI] YAPETIDU - ${formattedPeriod} - ${employeeName}`,
      html: htmlContent,
      text: `Kepada Yth. Bapak/Ibu ${employeeName}\n\n` +
            `Assalamualaikum wr. wb.\n\n` +
            `Bersama dengan email ini, kami sampaikan dokumen resmi Slip Gaji Anda untuk periode ${formattedPeriod}.\n` +
            `Dokumen PDF resmi telah kami lampirkan langsung pada email ini.\n\n` +
            (textBreakdown ? `Rincian Slip Gaji:\n${textBreakdown}\n\n` : '') +
            (terbilangText ? `${terbilangText}\n\n` : '') +
            `Catatan: Jangan memberikan lampiran slip gaji ini kepada pihak lain untuk menjaga kerahasiaan data pribadi Anda.\n\n` +
            `YAPETIDU Finance\n` +
            `Jl. Raya Rejoso, Peterongan, Jombang, Jawa Timur.`
    };

    // Attach PDF if provided
    if (pdfBase64) {
      mailOptions.attachments = [
        {
          filename: filename,
          content: pdfBase64,
          encoding: 'base64',
          contentType: 'application/pdf',
        },
      ];
    }

    // Send Mail
    const sendResult = await transporter.sendMail(mailOptions);

    const batch = adminDb.batch();
    batch.update(deliveryRef, {
      status: 'sent',
      providerMessageId: sendResult.messageId || null,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(
      adminDb.collection('PayrollSlipStates').doc(slipId),
      {
        emailSent: true,
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailSentBy: actor.uid,
      },
      { merge: true },
    );
    batch.create(
      newFinancialAuditRef(),
      buildFinancialAuditRecord(actor, {
        action: 'PAYSLIP_EMAIL_SENT',
        entityType: 'PayrollSlipState',
        entityId: slipId,
        reason: 'Pengiriman slip final ke email resmi karyawan',
        requestId,
        metadata: { recipient: email, providerMessageId: sendResult.messageId || null },
      }),
    );
    await batch.commit();

    return NextResponse.json({ success: true, message: 'Email berhasil terkirim.' });
  } catch (error: unknown) {
    console.error('SMTP Mail error:', error);
    if (deliveryRef) {
      await deliveryRef.set(
        {
          status: 'failed',
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
        },
        { merge: true },
      ).catch(() => undefined);
    }
    return errorResponse(error);
  }
}

function spell(n: number): string {
  const angka = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  let hasil = "";

  if (n < 12) {
    hasil = angka[n];
  } else if (n < 20) {
    hasil = spell(n - 10) + " belas";
  } else if (n < 100) {
    hasil = spell(Math.floor(n / 10)) + " puluh " + spell(n % 10);
  } else if (n < 200) {
    hasil = "seratus " + spell(n - 100);
  } else if (n < 1000) {
    hasil = spell(Math.floor(n / 100)) + " ratus " + spell(n % 100);
  } else if (n < 2000) {
    hasil = "seribu " + spell(n - 1000);
  } else if (n < 1000000) {
    hasil = spell(Math.floor(n / 1000)) + " ribu " + spell(n % 1000);
  } else if (n < 1000000000) {
    hasil = spell(Math.floor(n / 1000000)) + " juta " + spell(n % 1000000);
  } else if (n < 1000000000000) {
    hasil = spell(Math.floor(n / 1000000000)) + " milyar " + spell(n % 1000000000);
  }

  return hasil.replace(/\s+/g, " ").trim();
}

function terbilang(n: number): string {
  const cleaned = spell(n);
  if (!cleaned) return "Nol";
  return cleaned.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
