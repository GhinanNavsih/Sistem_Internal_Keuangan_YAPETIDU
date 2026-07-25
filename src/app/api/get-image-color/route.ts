import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    const parsedUrl = new URL(imageUrl);
    const bucket =
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
      'internal-bak.firebasestorage.app';

    const allowedHostnames = [
      'firebasestorage.googleapis.com',
      'storage.googleapis.com',
      'maps.googleapis.com',
      'lh3.googleusercontent.com',
      'maps.gstatic.com',
      bucket,
    ];

    const allowed =
      parsedUrl.protocol === 'https:' &&
      (
        allowedHostnames.includes(parsedUrl.hostname) ||
        parsedUrl.hostname.endsWith('.googleusercontent.com') ||
        parsedUrl.hostname.endsWith('.gstatic.com')
      );

    if (!allowed) {
      return NextResponse.json({ error: 'Image host is not allowed' }, { status: 400 });
    }

    const res = await fetch(parsedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch image', fallback: true }, { status: 200 });
    }

    const contentType = res.headers.get('content-type') || '';
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (!contentType.startsWith('image/') || contentLength > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Invalid or oversized image' }, { status: 400 });
    }
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image exceeds 5 MB' }, { status: 400 });
    }
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;

    return NextResponse.json({ success: true, dataUrl });
  } catch (error: any) {
    console.error('Error fetching image for color extraction:', error);
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
