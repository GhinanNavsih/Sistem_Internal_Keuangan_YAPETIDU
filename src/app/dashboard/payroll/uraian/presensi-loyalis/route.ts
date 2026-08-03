import { NextRequest, NextResponse } from 'next/server';

/**
 * Preserve old bookmarks after the legacy Loyalis calculator was replaced by
 * the raw attendance-import workflow. The redirect does not read or mutate
 * any payroll data.
 */
export function GET(request: NextRequest) {
  const destination = request.nextUrl.clone();
  destination.pathname = '/dashboard/payroll/uraian/presensi-loyalis-raw';
  return NextResponse.redirect(destination, 308);
}
