import { z } from 'zod';
import { verifyBridge, referralDeliverySchema, localReferralPayrollTestEnabled } from '@/lib/loyalis-referral-contract';
import { applyReferralDelivery } from '@/lib/server/loyalisReferralPayroll';
import { referralPayrollReceipt } from '@/lib/server/loyalisReferralReceipt';
import { errorResponse, HttpError } from '@/lib/server/auth';
import { callReferralPmb } from '@/lib/server/loyalisReferralBridge';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get('content-length') || 0) > 64000) throw new HttpError(413, 'Permintaan terlalu besar.');
    const body = await request.text();
    if (Buffer.byteLength(body) > 64000) throw new HttpError(413, 'Permintaan terlalu besar.');
    if (!verifyBridge(process.env.LOYALIS_REFERRAL_SECRET || '', 'POST', new URL(request.url).pathname, body, request.headers)) throw new HttpError(401, 'Tanda tangan integrasi tidak valid.');
    const raw = JSON.parse(body);
    if (raw.action === 'health') {
      z.object({ action: z.literal('health'), protocolVersion: z.literal(1) }).parse(raw);
      const peer = await callReferralPmb<{ application: string; protocolVersion: number; enabled: boolean; productionReady: boolean }>({ action: 'health', protocolVersion: 1 });
      if (peer.application !== 'pmb' || peer.protocolVersion !== 1) throw new HttpError(503, 'Identitas API PMB tidak sesuai.');
      return Response.json({ application: 'internal-bak', protocolVersion: 1, enabled: process.env.LOYALIS_REFERRALS_ENABLED === 'true', payrollTestEnabled: localReferralPayrollTestEnabled(), peer }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (process.env.LOYALIS_REFERRALS_ENABLED !== 'true') throw new HttpError(503, 'Integrasi belum diaktifkan.');
    const input = z.union([referralDeliverySchema, z.object({ action: z.literal('reconcile'), protocolVersion: z.literal(1), records: z.array(referralDeliverySchema).min(1).max(10) })]).parse(raw);
    const records = 'action' in input ? input.records : [input];
    const payrollTest = localReferralPayrollTestEnabled();
    if (records.some(record => record.payrollTest)) {
      if (!payrollTest || !['localhost', '127.0.0.1'].includes(new URL(request.url).hostname)) throw new HttpError(403, 'Pengujian bonus riil belum diaktifkan untuk koneksi lokal ini.');
      const peer = await callReferralPmb<{ application: string; testMode: boolean; payrollTestEnabled: boolean }>({ action: 'health', protocolVersion: 1 });
      if (peer.application !== 'pmb' || !peer.testMode || !peer.payrollTestEnabled) throw new HttpError(403, 'PMB tidak mengizinkan pengujian bonus riil.');
    }
    if (process.env.NODE_ENV === 'development' && process.env.LOYALIS_REFERRAL_LOCAL_PREVIEW === 'true' && records.some(record => record.payable && !(payrollTest && record.payrollTest))) throw new HttpError(403, 'Mode uji lokal tidak dapat membuat pembayaran bonus tanpa izin pengujian bonus riil.');
    if ('action' in input) {
      const results = [];
      const started = Date.now();
      for (const record of input.records) {
        try {
          if (Date.now() - started > 40000) throw new HttpError(503, 'Pemeriksaan dilanjutkan pada putaran berikutnya.');
          await applyReferralDelivery(record);
          results.push({ claimId: record.claimId, receipt: await referralPayrollReceipt(record.claimId) });
        } catch (error) {
          results.push({ claimId: record.claimId, error: error instanceof HttpError ? error.message : 'Rekonsiliasi klaim belum berhasil.' });
        }
      }
      return Response.json({ protocolVersion: 1, results }, { headers: { 'Cache-Control': 'no-store' } });
    }
    await applyReferralDelivery(input);
    return Response.json(await referralPayrollReceipt(input.claimId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
