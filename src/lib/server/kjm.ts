import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { normalizeKjmNipy, type KjmEmployee, type KjmRate, type KjmEdits } from '@/lib/payroll/kjm';
import { HttpError } from './auth';

export const kjmHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function dateText(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate() as Date;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
  return typeof value === 'string' ? value.slice(0, 10) : '';
}
export async function loadKjmMaster(transaction?: FirebaseFirestore.Transaction) {
  const employeeQuery = adminDb.collection('Employees_Loyalis');
  const configRef = adminDb.doc('SalaryMatrix_ExcessAttendance/_config');
  const employeeSnap = transaction ? await transaction.get(employeeQuery) : await employeeQuery.get();
  const config = transaction ? await transaction.get(configRef) : await configRef.get();
  const version = String(config.data()?.activeVersion || '2026_v1');
  if (!/^[A-Za-z0-9_-]+$/.test(version)) throw new HttpError(409, 'Versi matrix KJM tidak valid.');
  const rateQuery = adminDb.collection(`SalaryMatrix_ExcessAttendance/${version}/rows`);
  const rateSnap = transaction ? await transaction.get(rateQuery) : await rateQuery.get();
  const employees: KjmEmployee[] = employeeSnap.docs.map(d => {
    const e = d.data();
    const type = String(e.loyalisType || '');
    const jobRole = String(e.employment_profile?.job_role || '');
    return { id: d.id, name: String(e.personal_info?.name || d.id), nipy: normalizeKjmNipy(e.personal_info?.employee_id_niy),
      active: String(e.personal_info?.status || '').trim().toUpperCase() === 'AKTIF', type,
      isDosen: typeof e.isDosen === 'boolean' ? e.isDosen : null, education: String(e.academic_and_tier?.education_level || ''),
      // Jabatan is read-only, auto-derived from structural positions; no structural post means it's blank with no way to type "Dosen" manually.
      role: jobRole || (type === 'Dosen' ? 'Dosen' : ''), recognizedDate: dateText(e.employment_profile?.date_recognized) };
  });
  const rates: KjmRate[] = rateSnap.docs.flatMap(d => {
    const row = d.data();
    if (row.isActive === false) return [];
    return Object.entries(row.rates || {}).flatMap(([group, value]) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? [{ degree: String(row.education_level || d.id), group, amount: value }] : []);
  });
  return { employees, rates, version };
}

export function parseKjmEdits(value: unknown): KjmEdits {
  if (!value || typeof value !== 'object') throw new HttpError(400, 'Koreksi wajib dikirim.');
  const v = value as Record<string, unknown>;
  const parseMap = (input: unknown, fields: string[]) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 2000) throw new HttpError(400, 'Format koreksi tidak valid.');
    return Object.fromEntries(Object.entries(input).map(([key, raw]) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || key.length > 250) throw new HttpError(400, 'Baris koreksi tidak valid.');
      const clean: Record<string, string | number | boolean> = {};
      for (const [field, val] of Object.entries(raw)) {
        if (!fields.includes(field)) throw new HttpError(400, 'Kolom koreksi tidak dikenal.');
        if (['consortium', 'exclude'].includes(field)) {
          if (typeof val !== 'boolean') throw new HttpError(400, 'Penanda koreksi tidak valid.');
        } else if (field === 'attendance') {
          if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > 100) throw new HttpError(400, 'Hadir koreksi tidak valid.');
        } else if (typeof val !== 'string' || val.length > 500) throw new HttpError(400, 'Teks koreksi tidak valid.');
        clean[field] = val as string | number | boolean;
      }
      return [key, clean];
    }));
  };
  return { courses: parseMap(v.courses, ['attendance', 'consortium', 'exclude', 'reason']),
    lecturers: parseMap(v.lecturers, ['employeeId', 'exclude', 'reason', 'rateKey']), consortiumReviewed: v.consortiumReviewed === true };
}
