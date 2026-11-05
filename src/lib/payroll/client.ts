import { auth } from '@/lib/firebase';

/**
 * Thrown by {@link authenticatedJson} when the server answers with a non-2xx.
 * `message` stays exactly what the API returned so existing `err.message`
 * callers are unaffected; `status` lets callers (bulk email retry) tell a
 * transient 5xx apart from a permanent 400/409.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    options: { code?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = options.code;
    this.details = options.details;
  }
}

export function createFinancialRequestId(prefix: string): string {
  const normalizedPrefix = prefix.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24);
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${normalizedPrefix}_${crypto.randomUUID().replaceAll('-', '')}`;
  }
  return `${normalizedPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

async function authorizedFetch(
  input: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<Response> {
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
  return response;
}

export async function authenticatedJson<T>(
  input: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
): Promise<T> {
  const response = await authorizedFetch(input, init);

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
      throw new ApiError(
        payload.error || 'Sesi tidak valid atau sudah kadaluarsa. Silakan masuk kembali.',
        401,
        { code: typeof payload.code === 'string' ? payload.code : undefined },
      );
    }
    throw new ApiError(
      payload.error || `Permintaan gagal (${response.status}).`,
      response.status,
      {
        code: typeof payload.code === 'string' ? payload.code : undefined,
        details: payload.details ?? payload.warnings,
      },
    );
  }
  return payload as T;
}

/** One step report from a route that streams its progress. */
export interface StreamedProgress {
  /** Steps the server has finished. */
  completed: number;
  /** Steps it will take in all. */
  total: number;
  /** The step now running. */
  label: string;
}

/**
 * Calls a route that streams newline-delimited JSON events (`x-progress-stream`)
 * and reports each step as the server finishes it. Resolves with the route's
 * final result, or throws the same {@link ApiError} a plain call would.
 */
export async function authenticatedProgressJson<T>(
  input: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
  onProgress: (progress: StreamedProgress) => void,
): Promise<T> {
  const response = await authorizedFetch(input, {
    ...init,
    headers: { ...(init.headers || {}), 'x-progress-stream': '1' },
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('application/x-ndjson') || !response.body) {
    // Refused before the stream began, or a server that does not stream.
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(payload.error || `Permintaan gagal (${response.status}).`, response.status);
    }
    return payload as T;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { value: T } | null = null;
  let failure: ApiError | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === 'progress') {
      onProgress({
        completed: Number(event.completed) || 0,
        total: Number(event.total) || 0,
        label: String(event.label || ''),
      });
    } else if (event.type === 'done') {
      result = { value: event.result as T };
    } else if (event.type === 'error') {
      failure = new ApiError(
        String(event.message || 'Permintaan gagal.'),
        Number(event.status) || 500,
      );
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handleLine);
    if (done) break;
  }
  handleLine(buffer);

  if (failure) throw failure;
  if (!result) throw new ApiError('Koneksi terputus sebelum proses selesai. Muat ulang halaman untuk memeriksa status periode.', 502);
  return (result as { value: T }).value;
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
  return (await pushUraianToSlips(command)).note;
}

/**
 * propagateUraianToSlips with the outcome spelled out, for a caller (the
 * Loyalis autosave) that reports success and failure differently. Never throws.
 */
export async function pushUraianToSlips(command: {
  scope: 'pekarya' | 'loyalis';
  period: string;
  jobCategory?: string;
}): Promise<{ ok: boolean; note: string }> {
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
    return { ok: true, note: sentences.length > 0 ? ` ${sentences.join(' ')}` : '' };
  } catch (err) {
    console.error('Gagal menerapkan rekap uraian ke slip gaji:', err);
    return { ok: false, note: ' Namun slip gaji belum diperbarui — buka Payroll › Refresh Massal.' };
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
