import { auth } from '@/lib/firebase';

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
      throw new Error(payload.error || 'Sesi tidak valid atau sudah kadaluarsa. Silakan masuk kembali.');
    }
    throw new Error(payload.error || `Permintaan gagal (${response.status}).`);
  }
  return payload as T;
}


