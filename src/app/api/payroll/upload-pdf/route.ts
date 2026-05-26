import { NextResponse } from 'next/server';
import { adminStorage } from '@/lib/firebase-admin';
import { getDownloadURL } from 'firebase-admin/storage';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { pdfBase64, employeeName, period } = body;

    if (!pdfBase64 || !employeeName || !period) {
      return NextResponse.json(
        { error: 'pdfBase64, employeeName, dan period wajib diisi.' },
        { status: 400 }
      );
    }

    const cleanName = employeeName.replace(/[^a-zA-Z0-9]/g, '_');
    const cleanPeriod = period.replace(/[^a-zA-Z0-9]/g, '_');
    const filePath = `payslips/${cleanPeriod}/${cleanName}_${Date.now()}.pdf`;

    const bucket = adminStorage.bucket();
    const file = bucket.file(filePath);
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    await file.save(pdfBuffer, {
      metadata: {
        contentType: 'application/pdf',
      },
    });

    // Retrieve a secure public download URL via the admin storage helper
    const downloadUrl = await getDownloadURL(file);

    return NextResponse.json({ success: true, pdfUrl: downloadUrl });
  } catch (error: any) {
    console.error('Server-side Firebase Storage upload error:', error);
    let errorMsg = error?.message || 'Gagal mengunggah PDF ke Firebase Storage via server.';
    
    if (errorMsg.includes('The specified bucket does not exist') || errorMsg.includes('bucket does not exist')) {
      errorMsg = 'Firebase Storage belum diaktifkan atau diinisialisasi di Firebase Console Anda. Silakan buka menu "Storage" di Firebase Console (https://console.firebase.google.com/project/internal-bak/storage) lalu klik tombol "Get Started" (Mulai) untuk mengaktifkannya agar link PDF dapat disertakan.';
    }

    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}
