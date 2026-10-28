import { adminDb } from '@/lib/firebase-admin';
import { HttpError, type AuthenticatedProfile } from './auth';
import { bridgeHeaders, type LoyalisSnapshot } from '@/lib/loyalis-referral-contract';

export async function loyalisReferralOwner(actor: AuthenticatedProfile, issuing = false): Promise<LoyalisSnapshot> {
  if (actor.role !== 'loyalis' || !actor.linkedEmployeeId) throw new HttpError(403, 'Halaman ini khusus akun Loyalis yang terhubung ke data pegawai.');
  const employee = (await adminDb.collection('Employees_Loyalis').doc(actor.linkedEmployeeId).get()).data();
  if (!employee) throw new HttpError(404, 'Data Loyalis tidak ditemukan.');
  if (issuing && employee.personal_info?.status !== 'AKTIF') throw new HttpError(403, 'Hanya Loyalis aktif yang dapat menerbitkan rekomendasi.');
  return { employeeId: actor.linkedEmployeeId, name: employee.personal_info?.name || actor.displayName,
    nipy: String(employee.nipy || employee.personal_info?.employee_id_niy || actor.linkedEmployeeId),
    job: employee.employment_profile?.job_role || 'Loyalis UNIPDU', unit: employee.employment_profile?.department_unit || 'UNIPDU' };
}
export async function callReferralPmb<T>(body: Record<string, unknown>): Promise<T> {
  if (body.action !== 'health' && process.env.LOYALIS_REFERRALS_ENABLED !== 'true') throw new HttpError(503, 'Integrasi rekomendasi belum diaktifkan.');
  const url = new URL('/api/internal/loyalis-referrals', process.env.PMB_REFERRAL_ORIGIN);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  const preview = process.env.NODE_ENV === 'development' && process.env.LOYALIS_REFERRAL_LOCAL_PREVIEW === 'true';
  if (preview && !local) throw new HttpError(503, 'Mode uji lokal harus menggunakan PMB pada localhost.');
  if (url.protocol !== 'https:' && !((process.env.FIRESTORE_EMULATOR_HOST || preview) && local)) throw new HttpError(503, 'Alamat PMB harus HTTPS.');
  if (process.env.FIRESTORE_EMULATOR_HOST && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new HttpError(503, 'Emulator tidak boleh memanggil PMB produksi.');
  const send = async (input: Record<string, unknown>) => {
    const raw = JSON.stringify(input);
    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', headers: bridgeHeaders(process.env.LOYALIS_REFERRAL_SECRET || '', 'POST', url.pathname, raw), body: raw, signal: AbortSignal.timeout(20000), redirect: 'error' });
    } catch (networkError) {
      console.error(`Gagal menghubungkan ke PMB (${url.origin}):`, networkError);
      throw new HttpError(503, `Layanan rekomendasi PMB tidak dapat dihubungi (${url.origin}). ${preview ? 'Pastikan server PMB sedang aktif di port 3001.' : 'Silakan coba beberapa saat lagi.'}`);
    }
    let result: Record<string, unknown>;
    try {
      result = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new HttpError(response.status || 502, `Format respon tidak valid dari layanan PMB (${response.status}).`);
    }
    if (!response.ok) throw new HttpError(response.status, (typeof result?.error === 'string' && result.error) || 'Layanan rekomendasi PMB tidak tersedia.');
    return result;
  };
  if (preview && body.action !== 'health') {
    const peer = await send({ action: 'health', protocolVersion: 1 });
    if (peer.application !== 'pmb' || peer.testMode !== true) throw new HttpError(503, 'Mode uji lokal memerlukan database PMB emulator.');
  }
  return send(body) as Promise<T>;
}
