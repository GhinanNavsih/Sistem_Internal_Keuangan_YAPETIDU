import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, employeeName, period, pdfBase64, textBreakdown } = body;

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

    if (!email) {
      return NextResponse.json({ error: 'Email tujuan wajib diisi.' }, { status: 400 });
    }

    const smtpUser = process.env.SMTP_USER || '';
    const smtpPass = process.env.SMTP_PASS || '';

    if (!smtpUser || !smtpPass) {
      return NextResponse.json(
        {
          error: 'Konfigurasi SMTP Google (SMTP_USER dan SMTP_PASS) belum disetting di file .env.local.'
        },
        { status: 500 }
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

    const formattedPeriod = period ? period.toUpperCase() : '';
    const filename = `Slip_Gaji_YAPETIDU_${employeeName.replace(/\s+/g, '_')}_${formattedPeriod.replace(/\s+/g, '_')}.pdf`;

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
              <strong>Bapak/Ibu ${employeeName}</strong>
            </div>
            <div class="message" style="margin-top: 15px; font-size: 14px; line-height: 1.6; color: #475569;">
              Assalamualaikum wr. wb.<br><br>
              Dengan hormat,<br>
              Bersama dengan email ini, kami sampaikan dokumen resmi Slip Gaji Anda untuk periode <strong>${formattedPeriod}</strong>. Dokumen PDF resmi telah kami lampirkan langsung pada email ini dan dapat Anda unduh serta cetak sebagai bukti pembayaran yang sah.
            </div>
            
            ${textBreakdown ? `
              <div style="font-size: 14px; font-weight: 600; color: #1e293b; margin-bottom: 10px;">Rincian Slip Gaji:</div>
              <div class="breakdown-box">${textBreakdown}</div>
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
    const mailOptions: any = {
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
    await transporter.sendMail(mailOptions);

    return NextResponse.json({ success: true, message: 'Email berhasil terkirim.' });
  } catch (error: any) {
    console.error('SMTP Mail error:', error);
    return NextResponse.json({ error: error?.message || 'Gagal mengirim email.' }, { status: 500 });
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
