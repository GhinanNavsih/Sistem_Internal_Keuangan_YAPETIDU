import { auth } from '@/lib/firebase';

/**
 * Thrown by {@link authenticatedJson} when the server answers with a non-2xx.
 * `message` stays exactly what the API returned so existing `err.message`
 * callers are unaffected; `status` lets callers (bulk email retry) tell a
 * transient 5xx apart from a permanent 400/409.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function createFinancialRequestId(prefix: string): string {
  const normalizedPrefix = prefix.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24);
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${normalizedPrefix}_${crypto.randomUUID().replaceAll('-', '')}`;
  }
  return `${normalizedPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

export async function authenticatedJson<T>(
  input: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new Error('Sesi pengguna tidak tersedia. Silakan masuk kembali.');
  }

  let token = await user.getIdToken();
  let response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  // If 401, force token refresh and retry once
  if (response.status === 401) {
    try {
      token = await user.getIdToken(true);
      response = await fetch(input, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.headers || {}),
        },
      });
    } catch (refreshErr) {
      console.warn('Failed to force refresh Firebase Auth token on 401:', refreshErr);
    }
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
      throw new ApiError(
        payload.error || 'Sesi tidak valid atau sudah kadaluarsa. Silakan masuk kembali.',
        401,
      );
    }
    throw new ApiError(payload.error || `Permintaan gagal (${response.status}).`, response.status);
  }
  return payload as T;
}

export interface UraianPropagationSummary {
  updated?: number;
  unchanged?: number;
  no_slip?: number;
  period_closed?: number;
  blocked_status?: number;
  immutable?: number;
}

/**
 * Pushes a just-saved Uraian rekap (or Loyalis presence run) onto the draft
 * slips for that period and returns a sentence to append to the save toast.
 *
 * Never throws: a propagation failure must not make a successful save look
 * like a failed one. The Refresh Massal flow on the payroll page remains the
 * manual fallback, so the note points there when something goes wrong.
 */
export async function propagateUraianToSlips(command: {
  scope: 'pekarya' | 'loyalis';
  period: string;
  jobCategory?: string;
}): Promise<string> {
  try {
    const result = await authenticatedJson<{ summary: UraianPropagationSummary }>(
      '/api/payroll/uraian-propagation',
      {
        method: 'POST',
        body: JSON.stringify({
          scope: command.scope,
          period: command.period,
          jobCategory: command.jobCategory,
          requestId: createFinancialRequestId('uraian-sync'),
        }),
      },
    );
    const summary = result.summary || {};
    const updated = summary.updated || 0;
    const blocked = (summary.blocked_status || 0) + (summary.immutable || 0);

    const sentences: string[] = [];
    if (updated > 0) sentences.push(`${updated} slip draf ikut diperbarui.`);
    if (blocked > 0) {
      sentences.push(
        `${blocked} slip sudah diverifikasi/dikunci sehingga tidak diubah — perubahan ditandai untuk ditinjau Badan Keuangan.`,
      );
    }
    if (summary.period_closed) {
      sentences.push('Periode sudah ditutup, slip tidak diubah.');
    }
    return sentences.length > 0 ? ` ${sentences.join(' ')}` : '';
  } catch (err) {
    console.error('Gagal menerapkan rekap uraian ke slip gaji:', err);
    return ' Namun slip gaji belum diperbarui — buka Payroll › Refresh Massal.';
  }
}

/**
 * Pushes each employee's current approved VakasiTambahan total for one period
 * onto their draft payslip, and returns a sentence to append to the calling
 * toast. Call after any event mutation that can change what a worker is
 * owed — approval, un-approval, decline, or an edit to an already-approved
 * event — so a draft slip never depends on someone remembering to re-save it.
 *
 * Never throws, for the same reason as propagateUraianToSlips: a propagation
 * failure must not make a successful event save/review look like a failure.
 */
export async function propagateVakasiPay(command: {
  period: string;
  employeeIds: string[];
}): Promise<string> {
  if (command.employeeIds.length === 0) return '';
  try {
    const result = await authenticatedJson<{ summary: UraianPropagationSummary }>(
      '/api/payroll/vakasi-propagation',
      {
        method: 'POST',
        body: JSON.stringify({
          period: command.period,
          employeeIds: command.employeeIds,
          requestId: createFinancialRequestId('vakasi-sync'),
        }),
      },
    );
    const summary = result.summary || {};
    const updated = summary.updated || 0;
    const blocked = (summary.blocked_status || 0) + (summary.immutable || 0);

    const sentences: string[] = [];
    if (updated > 0) sentences.push(`${updated} slip draf ikut diperbarui.`);
    if (blocked > 0) {
      sentences.push(
        `${blocked} slip sudah diverifikasi/dikunci sehingga tidak diubah — perubahan ditandai untuk ditinjau Badan Keuangan.`,
      );
    }
    if (summary.period_closed) {
      sentences.push('Periode sudah ditutup, slip tidak diubah.');
    }
    return sentences.length > 0 ? ` ${sentences.join(' ')}` : '';
  } catch (err) {
    console.error('Gagal menerapkan Vakasi Tambahan ke slip gaji:', err);
    return ' Namun slip gaji belum diperbarui — buka Payroll › Refresh Massal.';
  }
}

export async function authenticatedFormData<T>(
  input: string,
  body: FormData,
): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new Error('Sesi pengguna tidak tersedia. Silakan masuk kembali.');
  }

  let token = await user.getIdToken();
  let response = await fetch(input, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (response.status === 401) {
    token = await user.getIdToken(true);
    response = await fetch(input, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error(payload.error || `Permintaan gagal (${response.status}).`);
  }
  return payload as T;
}

