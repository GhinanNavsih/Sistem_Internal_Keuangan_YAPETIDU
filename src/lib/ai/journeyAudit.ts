import { GoogleGenerativeAI, Schema, SchemaType } from '@google/generative-ai';

export interface JourneyAuditPayload {
  reportId?: string;
  employeeName: string;
  activityName: string;
  dateStart: string;
  timeStart: string;
  dateEnd: string;
  timeEnd: string;
  isMultiDay: boolean;
  nightCount: number;
  elapsedDurationHours: number;
  drivingDurationHours: number;
  totalDistanceKm: number;
  points: string[];
  pointLocations?: Array<{ address: string; latitude: number; longitude: number } | null>;
  legDetails?: Array<{
    legIndex: number;
    from: string;
    to: string;
    distanceKm: number;
    durationHours: number;
  }>;
  vehicleType?: string;
  fuelProcurementMode?: string;
}

export type JourneyAuditVerdict = 'AMAN' | 'PERLU_DITINJAU' | 'ANOMALI_KRITIS';

export type JourneyAnomalyType =
  | 'GEO_OUTLIER'
  | 'TIMELINE_IMPOSSIBLE'
  | 'PURPOSE_MISMATCH'
  | 'SUSPICIOUS_DETOUR'
  | 'VAGUE_LOCATION'
  | 'DUPLICATE_OR_ERRATIC';

export interface JourneyAnomalyItem {
  type: JourneyAnomalyType;
  stopIndex?: number | null;
  locationName?: string | null;
  finding: string;
  recommendedFix: string;
}

export interface JourneyAuditResult {
  verdict: JourneyAuditVerdict;
  riskScore: number;
  summary: string;
  anomalies: JourneyAnomalyItem[];
}

const auditResponseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    verdict: {
      type: SchemaType.STRING,
      format: 'enum',
      enum: ['AMAN', 'PERLU_DITINJAU', 'ANOMALI_KRITIS'],
      description: 'Overall audit verdict: AMAN (clean/safe), PERLU_DITINJAU (needs review/minor issue), ANOMALI_KRITIS (critical anomaly/geocoding error/impossible timeline)',
    },
    riskScore: {
      type: SchemaType.INTEGER,
      description: 'Risk score from 0 (completely safe) to 100 (high probability of user error or inflated claim)',
    },
    summary: {
      type: SchemaType.STRING,
      description: 'Concise, clear explanation in Indonesian for the Satker Head / Finance Auditor summarizing findings',
    },
    anomalies: {
      type: SchemaType.ARRAY,
      description: 'List of specific detected anomalies or user errors in the journey',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          type: {
            type: SchemaType.STRING,
            format: 'enum',
            enum: [
              'GEO_OUTLIER',
              'TIMELINE_IMPOSSIBLE',
              'PURPOSE_MISMATCH',
              'SUSPICIOUS_DETOUR',
              'VAGUE_LOCATION',
              'DUPLICATE_OR_ERRATIC',
            ],
            description: 'Category of anomaly',
          },
          stopIndex: {
            type: SchemaType.INTEGER,
            nullable: true,
            description: '0-based index of the problematic stop in the route points list, or null if general',
          },
          locationName: {
            type: SchemaType.STRING,
            nullable: true,
            description: 'Name or address of the affected stop, or null if general',
          },
          finding: {
            type: SchemaType.STRING,
            description: 'Clear description in Indonesian of what is anomalous (e.g. wrong city geocoding, impossible speed)',
          },
          recommendedFix: {
            type: SchemaType.STRING,
            description: 'Actionable instruction in Indonesian on how the auditor can correct the issue',
          },
        },
        required: ['type', 'finding', 'recommendedFix'],
      },
    },
  },
  required: ['verdict', 'riskScore', 'summary', 'anomalies'],
};

const SYSTEM_PROMPT = `Anda adalah Auditor AI Ahli untuk klaim perjalanan dinas dan SPJ Sopir internal Universitas/Yayasan (UNIPDU Jombang, Jawa Timur).
Tugas Anda adalah meneliti data klaim perjalanan sopir dan mendeteksi kesalahan input pengguna (human error), anomali rute, atau klaim yang tidak wajar.

Aturan Utama Verifikasi:
1. Kesalahan Geocoding (GEO_OUTLIER / SUSPICIOUS_DETOUR):
   - Sopir berbasis di UNIPDU Jombang, Jawa Timur.
   - Sering terjadi sopir mengetik nama tempat lokal (misal "Masjid Tembelang", "Mojowarno", "Peterongan") tetapi Google Maps geocoder salah memilih lokasi dengan nama serupa di provinsi lain (misal Jawa Tengah, Jawa Barat).
   - Waspadai rute yang tiba-tiba melompat ratusan kilometer ke kota/provinsi lain dan langsung kembali ke Jombang pada leg berikutnya, padahal tujuan perjalanan lokal atau luar kota berbeda arah.
2. Kelayakan Fisik & Timeline (TIMELINE_IMPOSSIBLE):
   - Bandingkan waktu tempuh kemudi (driving duration) dengan rentang total jam bertugas (elapsed wall-clock time).
   - Jika jam kemudi murni mendekati atau melebihi total rentang waktu berangkat-tiba, perjalanan tersebut secara fisik tidak mungkin (sopir butuh waktu singgah, parkir, kegiatan, istirahat).
   - Periksa apakah tanggal mulai dan selesai sinkron dengan rute jarak jauh (misal perjalanan > 500 km dalam waktu < 7 jam).
3. Kesesuaian Keperluan vs Rute (PURPOSE_MISMATCH):
   - Jika keperluan adalah "piket" (standby lokal), namun rutenya perjalanan luar kota ratusan kilometer antar-provinsi tanpa catatan penugasan khusus.
4. Format Alamat (VAGUE_LOCATION):
   - Identifikasi titik yang hanya berupa Google Plus Code mentah (seperti "F7GJ+6XR") tanpa nama gedung atau keterangan yang jelas.
5. Rute Memutar / Bolak-balik Tak Wajar (DUPLICATE_OR_ERRATIC):
   - Kunjungan berulang ke tempat yang sama secara tidak logis di sela-sela rute jarak jauh.

Berikan analisis dalam Bahasa Indonesia yang profesional, ringkas, dan langsung dapat ditindaklanjuti oleh Auditor/Kepala Satker.`;

export async function auditJourneyWithGemini(
  payload: JourneyAuditPayload,
  apiKeyOverride?: string,
): Promise<JourneyAuditResult> {
  const apiKey = apiKeyOverride || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error(
      'GEMINI_API_KEY belum dikonfigurasi. Harap masukkan API key dari Google AI Studio pada file .env.local',
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const modelCandidates = [
    'gemini-flash-lite-latest',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
  ];

  let result: any = null;
  let lastError: unknown = null;

  for (const candidate of modelCandidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: candidate,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: auditResponseSchema,
          temperature: 0.1,
        },
        systemInstruction: SYSTEM_PROMPT,
      });

      const prompt = `Silakan audit klaim perjalanan sopir berikut:
${JSON.stringify(payload, null, 2)}

Identifikasi semua anomali rute, kesalahan geocoding, ketidakwajaran durasi/timeline, dan format nama lokasi. Berikan rekomendasi koreksi yang konkret.`;

      result = await model.generateContent(prompt);
      if (result) break;
    } catch (err) {
      lastError = err;
      console.warn(`[AI Audit] Failed with model ${candidate}:`, err instanceof Error ? err.message : String(err));
    }
  }

  if (!result) {
    throw lastError || new Error('Gagal menghubungi model Gemini.');
  }

  const responseText = result.response.text();

  try {
    const parsed = JSON.parse(responseText) as JourneyAuditResult;
    return {
      verdict: parsed.verdict || 'PERLU_DITINJAU',
      riskScore: typeof parsed.riskScore === 'number' ? Math.min(100, Math.max(0, parsed.riskScore)) : 50,
      summary: parsed.summary || 'Audit selesai dengan catatan.',
      anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies : [],
    };
  } catch (parseError) {
    throw new Error(`Gagal memproses respon terstruktur dari Gemini: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }
}
