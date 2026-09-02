import { generatePaySlipPdf, PaySlipField, PaySlipData } from '@/utils/generatePaySlipPdf';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';

/**
 * Generates the payslip PDF in memory and uploads it to Firebase Storage,
 * returning the public download URL.
 */
export async function uploadPaySlipPdf(
  data: PaySlipData,
  employeeId: string,
  dbPeriod: string,
): Promise<string> {
  // Generate the PDF in-memory (saveToFile = false)
  const doc = generatePaySlipPdf(data, false);
  const pdfBlob = doc.output('blob');
  
  // Convert PDF blob to base64 to send to our server API
  const reader = new FileReader();
  const base64Promise = new Promise<string>((resolve, reject) => {
    reader.onloadend = () => {
      const base64data = (reader.result as string).split(',')[1];
      resolve(base64data);
    };
    reader.onerror = reject;
  });
  reader.readAsDataURL(pdfBlob);
  const pdfBase64 = await base64Promise;

  // Call our secure server-side upload API to bypass browser CORS preflight rules
  const result = await authenticatedJson<{ success: boolean; pdfUrl?: string; error?: string }>(
    '/api/payroll/upload-pdf',
    {
    method: 'POST',
    body: JSON.stringify({
      pdfBase64,
      employeeId,
      dbPeriod,
      requestId: createFinancialRequestId('pdf'),
    }),
  });

  if (!result.success || !result.pdfUrl) {
    throw new Error(result.error || 'Server tidak mengembalikan URL PDF.');
  }

  return result.pdfUrl;
}


/**
 * Sanitizes a phone number to only contain digits and ensures it starts with
 * the appropriate country code (defaults to 62 for Indonesia).
 */
export function sanitizePhoneNumber(phone: string): string {
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // If it starts with 0, replace with 62
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  }
  // If it doesn't start with 62 but starts with 8 (local Indonesian mobile format), prepend 62
  else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  }
  
  return cleaned;
}

/**
 * Formats a clean, structured, and professional payslip text message
 * and generates the prefilled WhatsApp URL.
 */
export function generateWhatsAppPaySlipUrl(
  phone: string,
  employeeName: string,
  period: string,
  earnings: PaySlipField[],
  deductions: PaySlipField[],
  netSalary: number,
  pdfUrl?: string,
  /** Income tax rows — listed as their own block, never inside Potongan. */
  taxes: PaySlipField[] = [],
): string {
  const cleanPhone = sanitizePhoneNumber(phone);
  
  const formatIDR = (amount: number): string => {
    const formattedNum = new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
    return `Rp${formattedNum}`;
  };

  const totalEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);
  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
  const totalTax = taxes.reduce((sum, t) => sum + t.amount, 0);

  // Format the WhatsApp message with markdown styling
  let text = `*SLIP GAJI YAPETIDU - ${period.toUpperCase()}*\n\n`;
  text += `Kepada Yth. Sdr/Sdri. *${employeeName}*,\n\nBerikut adalah rincian slip gaji resmi Anda untuk periode *${period}*:\n\n`;
  
  text += `*PENDAPATAN:*\n`;
  earnings.forEach(e => {
    text += `• ${e.label}: ${formatIDR(e.amount)}\n`;
  });
  text += `*Total Pendapatan: ${formatIDR(totalEarnings)}*\n\n`;

  text += `*POTONGAN:*\n`;
  if (deductions.length > 0) {
    deductions.forEach(d => {
      text += `• ${d.label}: ${formatIDR(d.amount)}\n`;
    });
    text += `*Total Potongan: ${formatIDR(totalDeductions)}*\n\n`;
  } else {
    text += `• Tidak ada potongan\n\n`;
  }

  if (totalTax > 0) {
    text += `*PAJAK:*\n`;
    taxes.forEach(t => {
      text += `• ${t.label}: ${formatIDR(t.amount)}\n`;
    });
    text += `*Total Pajak: ${formatIDR(totalTax)}*\n\n`;
  }

  text += `----------------------------------------\n`;
  text += `*GAJI BERSIH (Diterima): ${formatIDR(netSalary)}*\n`;
  text += `----------------------------------------\n\n`;

  if (pdfUrl) {
    text += `*Link Download PDF:* ${pdfUrl}\n\n`;
  }
  
  text += `_Catatan: Slip ini adalah bukti pembayaran resmi dari YAPETIDU._`;

  const encodedText = encodeURIComponent(text);
  return `https://wa.me/${cleanPhone}?text=${encodedText}`;
}
