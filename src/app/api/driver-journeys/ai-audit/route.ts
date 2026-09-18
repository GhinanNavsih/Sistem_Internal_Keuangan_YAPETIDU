import { NextRequest, NextResponse } from 'next/server';
import {
  errorResponse,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';
import {
  auditJourneyWithGemini,
  JourneyAuditPayload,
} from '@/lib/ai/journeyAudit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(req);
    requireRole(actor, ['super_admin', 'finance_verifier', 'satker_head']);

    const body = (await req.json()) as JourneyAuditPayload;

    if (!body || !Array.isArray(body.points) || body.points.length < 2) {
      return NextResponse.json(
        { error: 'Data rute perjalanan tidak lengkap untuk diaudit.' },
        { status: 400 },
      );
    }

    const auditResult = await auditJourneyWithGemini(body);

    return NextResponse.json({
      success: true,
      data: auditResult,
    });
  } catch (error) {
    console.error('Error in POST /api/driver-journeys/ai-audit:', error);
    const message =
      error instanceof Error
        ? error.message
        : 'Terjadi kesalahan saat memproses audit AI.';

    // If it's an API key error, provide a clearer hint
    if (message.includes('API key not valid') || message.includes('API_KEY_INVALID')) {
      return NextResponse.json(
        {
          error:
            'GEMINI_API_KEY tidak valid atau belum diaktifkan untuk Generative Language API. Harap periksa API Key Google AI Studio Anda di .env.local',
        },
        { status: 400 },
      );
    }

    if (message.includes('GEMINI_API_KEY belum dikonfigurasi')) {
      return NextResponse.json(
        {
          error: message,
        },
        { status: 400 },
      );
    }

    return errorResponse(error);
  }
}
