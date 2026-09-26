import { NextRequest, NextResponse } from 'next/server';

export function GET(request: NextRequest) {
  const destination = request.nextUrl.clone();
  destination.pathname = '/dashboard/payroll/koperasi';
  destination.searchParams.set('view', 'simpan-pinjam');
  return NextResponse.redirect(destination, 308);
}
