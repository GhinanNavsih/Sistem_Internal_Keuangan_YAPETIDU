import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { ReferralLetter } from '@/lib/loyalis-referral-contract';

export async function generateLoyalisReferralPdf(letter: ReferralLetter, origin: string) {
  const url = new URL(`/rekomendasi/${letter.token}`, origin).toString();
  const [qr, letterhead] = await Promise.all([
    QRCode.toDataURL(url, { errorCorrectionLevel: 'M', width: 360, margin: 2 }),
    readFile(path.join(process.cwd(), 'public/templates/unipdu-letterhead.jpg')),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const left = 23, width = 164;
  const drawLetterhead = () => {
    // Original artwork extracted unchanged from the PMB scholarship DOCX.
    doc.addImage(new Uint8Array(letterhead), 'JPEG', 0, 0, 210, 297, 'unipdu-letterhead');
    doc.setTextColor(25, 35, 45); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('SURAT REKOMENDASI CALON MAHASISWA', 105, 44, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`ID: ${letter.id}`, 105, 52, { align: 'center' });
  };
  drawLetterhead();
  const date = new Date(letter.issuedAt).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long' });
  let y = 66;
  const pageSpace = (height: number) => {
    if (y + height <= 268) return;
    doc.addPage(); drawLetterhead(); y = 66;
  };
  const paragraph = (text: string, size = 11) => { doc.setFontSize(size); const lines = doc.splitTextToSize(text, width); pageSpace(lines.length * 5.7 + 5); doc.setFontSize(size); doc.text(lines, left, y); y += lines.length * 5.7 + 5; };
  const field = (label: string, value: string) => {
    doc.setFontSize(10); const lines = doc.splitTextToSize(value, 112); pageSpace(Math.max(7, lines.length * 4.5 + 2));
    doc.setFontSize(10); doc.setTextColor(90, 100, 110); doc.text(label, left, y);
    doc.setTextColor(25, 35, 45); doc.setFont('helvetica', 'bold');
    doc.text(lines, 75, y); y += Math.max(7, lines.length * 4.5 + 2); doc.setFont('helvetica', 'normal');
  };
  paragraph('Kepada Yth. Tim Penerimaan Mahasiswa Baru UNIPDU\ndi Jombang');
  paragraph('Saya yang tercantum di bawah ini:');
  field('Nama Loyalis', letter.owner.name); field('NIPY', letter.owner.nipy); field('Jabatan', letter.owner.job); field('Unit kerja', letter.owner.unit);
  y += 3; paragraph('Dengan ini merekomendasikan calon mahasiswa berikut:');
  if (letter.testOnly) paragraph('SURAT UJI - TIDAK BERLAKU UNTUK PENGAJUAN RESMI', 11);
  field('Nama calon mahasiswa', letter.prospectName); field('Tahun akademik', letter.cycleLabel);
  y += 3; paragraph('Untuk dipertimbangkan sebagai penerima Beasiswa Khusus Rekom Loyalis UNIPDU. Persetujuan dan besaran potongan ditetapkan oleh PMB setelah pemeriksaan dokumen sesuai ketentuan yang berlaku.');
  paragraph('Surat ini hanya berlaku bagi nama dan tahun akademik di atas. Keaslian, kepemilikan, serta status terkini dapat diperiksa melalui kode QR berikut.', 10);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  const signatureName = doc.splitTextToSize(letter.owner.name, width);
  pageSpace(55 + signatureName.length * 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10); doc.text(`Jombang, ${date}`, left, y + 3); doc.text('Loyalis perekomendasi,', left, y + 10);
  doc.addImage(qr, 'PNG', left - 1, y + 14, 30, 30);
  doc.setFont('helvetica', 'bold'); doc.text(signatureName, left, y + 50);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('Tanda tangan QR - verifikasi pada laman resmi PMB UNIPDU', left, y + 53 + signatureName.length * 4);
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    if (letter.status === 'revoked') { doc.setTextColor(180, 30, 30); doc.setFontSize(28); doc.text('DICABUT / TIDAK BERLAKU', 105, 151, { align: 'center', angle: 27 }); }
    doc.setTextColor(90, 100, 110); doc.setFontSize(8); doc.text(`${page}/${doc.getNumberOfPages()}`, 187, 272, { align: 'right' });
  }
  return Buffer.from(doc.output('arraybuffer'));
}
