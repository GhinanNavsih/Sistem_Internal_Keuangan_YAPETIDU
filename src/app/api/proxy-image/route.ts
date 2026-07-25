import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const urlParam = request.nextUrl.searchParams.get('url');
    if (!urlParam) {
      return NextResponse.json({ error: 'Parameter URL wajib diisi.' }, { status: 400 });
    }

    const parsed = new URL(urlParam);
    const isAllowedHost =
      parsed.hostname.endsWith('firebasestorage.googleapis.com') ||
      parsed.hostname.endsWith('firebasestorage.app') ||
      parsed.hostname.endsWith('googleusercontent.com');

    if (!isAllowedHost) {
      return NextResponse.json({ error: 'Domain gambar tidak diizinkan.' }, { status: 403 });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(urlParam, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return NextResponse.json({ error: 'Gagal mengambil gambar.' }, { status: response.status });
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Terjadi kesalahan saat memproses gambar.' },
      { status: 500 }
    );
  }
}
