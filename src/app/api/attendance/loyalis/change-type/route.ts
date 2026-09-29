import { NextRequest } from 'next/server';
import { POST as reviewPost } from '../review/route';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const forwardRequest = new NextRequest(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({
      ...body,
      action: 'change_type',
    }),
  });
  return reviewPost(forwardRequest);
}
