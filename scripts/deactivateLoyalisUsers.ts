import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Initialize Firebase Admin
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Using local service-account.json for authentication...');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  } else {
    console.log('No local service-account.json found. Falling back to default credentials...');
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  }
}

const db = admin.firestore();
const auth = admin.auth();

// Configure SMTP Transporter for Google Workspace
const smtpUser = process.env.SMTP_USER || '';
const smtpPass = process.env.SMTP_PASS || '';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

function getReactivationEmailHtml(name: string, reactivateLink: string): string {
  return `
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
        .btn-container {
          text-align: center;
          margin: 30px 0;
        }
        .btn {
          display: inline-block;
          background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
          color: #ffffff !important;
          text-decoration: none;
          padding: 12px 30px;
          border-radius: 10px;
          font-weight: 600;
          font-size: 14px;
          box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2), 0 2px 4px -1px rgba(79, 70, 229, 0.1);
          transition: transform 0.2s ease;
        }
        .link-text {
          word-break: break-all;
          font-size: 12px;
          color: #64748b;
          background-color: #f1f5f9;
          padding: 10px;
          border-radius: 8px;
          margin-top: 20px;
        }
        .footer {
          background-color: #f8fafc;
          padding: 24px;
          text-align: center;
          font-size: 12px;
          color: #64748b;
          border-top: 1px solid #f1f5f9;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>REAKTIVASI AKUN LOYALIS</h1>
          <p>Yayasan Pendidikan Tinggi Darul 'Ulum (YAPETIDU)</p>
        </div>
        <div class="content">
          <div class="greeting">
            Kepada Yth. Bapak/Ibu ${name},
          </div>
          <div class="message">
            Assalamualaikum wr. wb.<br><br>
            Untuk meningkatkan keamanan sistem, kami telah menonaktifkan sementara seluruh akun pengguna dengan peran <strong>Loyalis</strong>. Anda diharuskan untuk melakukan aktivasi ulang sebelum dapat masuk kembali ke portal internal keuangan YAPETIDU.<br><br>
            Silakan klik tombol di bawah ini untuk mengaktifkan kembali akun Anda:
          </div>
          
          <div class="btn-container">
            <a href="${reactivateLink}" class="btn" target="_blank">Reaktivasi Akun Sekarang</a>
          </div>
          
          <div class="message" style="font-size: 13px; color: #64748b;">
            Tautan reaktivasi ini berlaku selama <strong>7 hari</strong>. Jika tombol di atas tidak berfungsi, Anda juga dapat menyalin dan menempelkan tautan berikut ke peramban (browser) Anda:
          </div>
          <div class="link-text">
            ${reactivateLink}
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
}

async function main() {
  const isCommit = process.argv.includes('--commit');
  console.log('======================================================');
  console.log('UNIPDU INTERNAL KEUANGAN - DEACTIVATE & SEND LOYALIS RESET');
  console.log(`MODE: ${isCommit ? '🔥 COMMIT (WRITE)' : '👀 DRY-RUN (READ-ONLY)'}`);
  console.log('======================================================\n');

  if (!smtpUser || !smtpPass) {
    console.error('❌ Error: SMTP_USER and SMTP_PASS must be configured in .env.local.');
    process.exit(1);
  }

  // 1. Fetch all users from Firestore
  console.log('🔍 Fetching all users from Firestore...');
  const usersSnapshot = await db.collection('users').get();
  
  const loyalisUsers: { uid: string; email: string; name: string }[] = [];

  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.role === 'loyalis') {
      loyalisUsers.push({
        uid: doc.id,
        email: (data.email || '').toLowerCase().trim(),
        name: data.displayName || 'Karyawan Loyalis',
      });
    }
  });

  console.log(`Found ${loyalisUsers.length} users with 'loyalis' role.`);

  if (loyalisUsers.length === 0) {
    console.log('No loyalis users found. Exiting.');
    return;
  }

  console.log('\nList of Loyalis users to be deactivated:');
  loyalisUsers.forEach((u, i) => {
    console.log(`  ${i + 1}. [UID: ${u.uid}] ${u.name} (${u.email})`);
  });
  console.log('');

  if (!isCommit) {
    console.log('✨ Dry run complete! No database updates were performed.');
    console.log('👉 Run with "--commit" to deactivate accounts and send emails:');
    console.log('   npx tsx scripts/deactivateLoyalisUsers.ts --commit\n');
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  console.log(`Using base App URL: ${appUrl}\n`);

  console.log('🔥 Committing deactivations and sending emails...');

  let successCount = 0;
  let errorCount = 0;

  for (const user of loyalisUsers) {
    try {
      if (!user.email) {
        console.warn(`⚠️ Skipped [UID: ${user.uid}] ${user.name}: Email is empty.`);
        errorCount++;
        continue;
      }

      // 1. Generate token
      const token = crypto.randomBytes(32).toString('hex');
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 7); // 7 days validity

      // 2. Save token to reactivation_tokens collection
      await db.collection('reactivation_tokens').doc(token).set({
        uid: user.uid,
        email: user.email,
        displayName: user.name,
        expiresAt: expiry.toISOString(),
        used: false,
        createdAt: new Date().toISOString(),
      });

      // 3. Disable user in Firebase Auth
      await auth.updateUser(user.uid, { disabled: true });

      // 4. Send reactivation email
      const reactivationLink = `${appUrl}/reactivate?token=${token}`;
      const emailHtml = getReactivationEmailHtml(user.name, reactivationLink);

      await transporter.sendMail({
        from: `"YAPETIDU Finance" <${smtpUser}>`,
        to: user.email,
        subject: `[YAPETIDU] Aktivasi Ulang Akun Karyawan Loyalis - ${user.name}`,
        html: emailHtml,
        text: `Kepada Yth. Bapak/Ibu ${user.name},\n\n` +
              `Assalamualaikum wr. wb.\n\n` +
              `Untuk meningkatkan keamanan sistem, kami telah menonaktifkan sementara seluruh akun pengguna dengan peran Loyalis. Anda diharuskan untuk melakukan aktivasi ulang sebelum dapat masuk kembali ke portal internal keuangan YAPETIDU.\n\n` +
              `Silakan kunjungi tautan berikut untuk mengaktifkan kembali akun Anda:\n` +
              `${reactivationLink}\n\n` +
              `Tautan reaktivasi ini hanya berlaku selama 7 hari.\n\n` +
              `YAPETIDU Finance\n` +
              `Jl. Raya Rejoso, Peterongan, Jombang, Jawa Timur.`,
      });

      successCount++;
      console.log(`✅ Processed successfully: ${user.name} (${user.email})`);
    } catch (err) {
      console.error(`❌ Failed to process [UID: ${user.uid}] ${user.name}:`, err);
      errorCount++;
    }
  }

  console.log('\n======================================================');
  console.log('MIGRATION COMPLETED');
  console.log(`  - Successfully processed : ${successCount}`);
  console.log(`  - Errors / Skipped       : ${errorCount}`);
  console.log('======================================================');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error during execution:', err);
  process.exit(1);
});
