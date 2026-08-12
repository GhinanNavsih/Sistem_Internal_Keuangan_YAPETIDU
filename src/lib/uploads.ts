import { authenticatedFormData } from '@/lib/payroll/client';

/**
 * Uploads a proof/receipt file through a server-side API route instead of
 * writing directly to Firebase Storage. Direct client writes to these paths
 * are rejected by storage.rules — role/ownership checks now happen
 * server-side via the Admin SDK. See src/lib/server/storageUpload.ts.
 */
export async function uploadProofFile(
  endpoint: string,
  file: File,
  fields: Record<string, string>,
): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  const result = await authenticatedFormData<{ url: string }>(endpoint, form);
  return result.url;
}
