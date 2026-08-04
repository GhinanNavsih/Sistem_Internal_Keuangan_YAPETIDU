import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const PERIOD_RE = /^(\d{4})-(\d{2})$/;

type PresenceEntry = Record<string, unknown>;

function normalizeIdentity(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function normalizeDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function asRecord(value: unknown): PresenceEntry | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as PresenceEntry)
    : null;
}

function hasDailyLogs(entry: PresenceEntry | null): entry is PresenceEntry & { dailyLogs: unknown[] } {
  return Boolean(entry && Array.isArray(entry.dailyLogs) && entry.dailyLogs.length > 0);
}

function presenceEntries(data: PresenceEntry): PresenceEntry[] {
  if (Array.isArray(data.records)) {
    return data.records.map(asRecord).filter((entry): entry is PresenceEntry => Boolean(entry));
  }
  if (Array.isArray(data.entries)) {
    return data.entries.map(asRecord).filter((entry): entry is PresenceEntry => Boolean(entry));
  }
  const entries = asRecord(data.entries);
  return entries ? Object.values(entries).map(asRecord).filter((entry): entry is PresenceEntry => Boolean(entry)) : [];
}

function findEmployeeEntry(
  data: PresenceEntry,
  identity: {
    employeeId: string;
    nipys: string[];
    name: string;
  },
): PresenceEntry | null {
  const entriesObject = asRecord(data.entries);
  const directKeys = Array.from(new Set([
    identity.employeeId,
    ...identity.nipys,
  ].filter(Boolean)));

  for (const key of directKeys) {
    const directEntry = asRecord(entriesObject?.[key]);
    if (hasDailyLogs(directEntry)) return directEntry;
  }

  const candidateEntries = presenceEntries(data).filter(hasDailyLogs);
  const identityDigits = identity.nipys.map(normalizeDigits).filter(Boolean);

  const match = candidateEntries.find((entry) => {
    if (entry.employeeId === identity.employeeId) return true;

    const entryNipy = normalizeIdentity(entry.nipy || entry.niy || entry.id);
    if (entryNipy && identity.nipys.includes(entryNipy)) return true;

    const entryDigits = normalizeDigits(entry.nipy || entry.niy || entry.id);
    if (entryDigits && identityDigits.includes(entryDigits)) return true;

    const entryName = normalizeName(
      entry.employeeName || entry.excelName || entry.name,
    );
    return Boolean(
      identity.name &&
      entryName &&
      (entryName === identity.name ||
        entryName.includes(identity.name) ||
        identity.name.includes(entryName)),
    );
  });

  return match || null;
}

function serializableDailyLogs(logs: unknown[]): unknown[] {
  return logs.flatMap((log) => {
    const record = asRecord(log);
    if (!record) return [];
    const safeRecord = Object.fromEntries(
      Object.entries(record).filter(([, value]) =>
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean',
      ),
    );
    return [safeRecord];
  });
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['loyalis']);

    if (!actor.linkedEmployeeId) {
      throw new HttpError(409, 'Akun Loyalis belum terhubung ke data pegawai.');
    }

    const period = request.nextUrl.searchParams.get('period') || '';
    const periodMatch = PERIOD_RE.exec(period);
    if (!periodMatch || Number(periodMatch[2]) < 1 || Number(periodMatch[2]) > 12) {
      throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
    }

    const employeeSnapshot = await adminDb
      .collection('Employees_Loyalis')
      .doc(actor.linkedEmployeeId)
      .get();
    if (!employeeSnapshot.exists) {
      return Response.json({ period, dailyLogs: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const employee = employeeSnapshot.data() || {};
    const personalInfo = asRecord(employee.personal_info) || {};
    const academicAndTier = asRecord(employee.academic_and_tier) || {};
    const nipys = Array.from(new Set([
      employee.nipy,
      personalInfo.employee_id_niy,
      academicAndTier.nipy,
    ].map(normalizeIdentity).filter(Boolean)));
    const name = normalizeName(
      personalInfo.name || employee.displayName || employee.name || actor.displayName,
    );

    const documentIds = Array.from(new Set([
      period.replace('-', '_'),
      period,
    ]));
    const presenceSnapshots = await Promise.all(
      documentIds.map((documentId) => adminDb.collection('LoyalisPresence').doc(documentId).get()),
    );

    for (const snapshot of presenceSnapshots) {
      if (!snapshot.exists) continue;
      const entry = findEmployeeEntry(snapshot.data() as PresenceEntry, {
        employeeId: actor.linkedEmployeeId,
        nipys,
        name,
      });
      if (hasDailyLogs(entry)) {
        return Response.json(
          { period, dailyLogs: serializableDailyLogs(entry.dailyLogs) },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
    }

    return Response.json(
      { period, dailyLogs: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
