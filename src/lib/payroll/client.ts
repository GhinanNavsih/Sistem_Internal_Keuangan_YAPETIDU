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
    throw new Error('Sesi pengguna tidak tersedia. Silakan masuk kembali.');
  }
  const token = await user.getIdToken();
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Permintaan gagal (${response.status}).`);
  }
  return payload as T;
}

