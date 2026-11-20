import type { NextRequest } from 'next/server';

export function GET(request: NextRequest) {
  const params = new URLSearchParams(request.nextUrl.searchParams);
  params.set('view', 'simpan-pinjam');

  // Keep the browser on the public origin when App Hosting forwards an internal host.
  return new Response(null, {
    status: 308,
    headers: { Location: `/dashboard/payroll/koperasi?${params}` },
  });
}
