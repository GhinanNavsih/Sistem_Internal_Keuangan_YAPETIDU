import { calculateEditableDriverJourneyTimeline } from './driverJourney';
import { pekaryaPayrollPeriodForDate } from './pekaryaSpj';

/**
 * One sopir cannot drive two journeys at once. Reports are compared on their
 * wall-clock span (Asia/Jakarta); a trip that ends exactly when the next one
 * starts is fine, any shared minute is not.
 */

const JAKARTA_OFFSET = '+07:00';
const MINUTE_MS = 60_000;

export interface DriverJourneySpanSource {
  dateStart?: unknown;
  activityDate?: unknown;
  dateEnd?: unknown;
  timeStart?: unknown;
  timeEnd?: unknown;
  isMultiDay?: unknown;
}

export interface DriverJourneySpan {
  startMs: number;
  endMs: number;
}

export interface PeerDriverReport extends DriverJourneySpanSource {
  id: string;
  status?: unknown;
  jobCategory?: unknown;
  activityName?: unknown;
}

export interface DriverJourneyOverlap {
  reportId: string;
  activityName: string;
  overlapMinutes: number;
  peerStartLabel: string;
  peerEndLabel: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Departure and arrival as epoch milliseconds, using the same timeline rule as
 * the pay calculation (arrival earlier than departure rolls to the next day).
 * Null when the dates or times cannot form a positive-length trip.
 */
export function driverJourneySpan(source: DriverJourneySpanSource): DriverJourneySpan | null {
  const dateStart = text(source.dateStart) || text(source.activityDate);
  const timeStart = text(source.timeStart);
  const timeEnd = text(source.timeEnd);
  if (!dateStart || !timeStart || !timeEnd) return null;

  const timeline = calculateEditableDriverJourneyTimeline({
    dateStart,
    dateEnd: text(source.dateEnd) || undefined,
    timeStart,
    timeEnd,
    isMultiDay: source.isMultiDay === true,
  });
  const startMs = Date.parse(`${timeline.dateStart}T${timeStart}:00${JAKARTA_OFFSET}`);
  const endMs = Date.parse(`${timeline.dateEnd}T${timeEnd}:00${JAKARTA_OFFSET}`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

function jakartaLabel(ms: number): string {
  const [date, time] = new Date(ms + 7 * 60 * MINUTE_MS).toISOString().slice(0, 16).split('T');
  const [, month, day] = date.split('-');
  return `${day}/${month} ${time}`;
}

/** A declined report is not payable and may be resubmitted, so it blocks nothing. */
function blocksOtherJourneys(peer: PeerDriverReport): boolean {
  return peer.jobCategory === 'SOPIR' && peer.status !== 'declined';
}

export function findOverlappingDriverReport(
  candidate: DriverJourneySpan,
  peers: readonly PeerDriverReport[],
  options: { excludeReportId?: string } = {},
): DriverJourneyOverlap | null {
  let worst: DriverJourneyOverlap | null = null;
  for (const peer of peers) {
    if (peer.id === options.excludeReportId || !blocksOtherJourneys(peer)) continue;
    const span = driverJourneySpan(peer);
    if (!span) continue;
    const sharedMs = Math.min(candidate.endMs, span.endMs) - Math.max(candidate.startMs, span.startMs);
    if (sharedMs <= 0) continue;
    const overlapMinutes = Math.round(sharedMs / MINUTE_MS);
    if (worst && worst.overlapMinutes >= overlapMinutes) continue;
    worst = {
      reportId: peer.id,
      activityName: text(peer.activityName).replace(/\s*\(.*$/, '').trim() || 'tanpa nama',
      overlapMinutes,
      peerStartLabel: jakartaLabel(span.startMs),
      peerEndLabel: jakartaLabel(span.endMs),
    };
  }
  return worst;
}

export function describeDriverJourneyOverlap(overlap: DriverJourneyOverlap): string {
  const hours = Math.floor(overlap.overlapMinutes / 60);
  const minutes = overlap.overlapMinutes % 60;
  const shared = hours > 0 ? `${hours} jam ${minutes} menit` : `${minutes} menit`;
  return (
    `Waktu perjalanan bertumpuk ${shared} dengan laporan "${overlap.activityName}" ` +
    `(${overlap.peerStartLabel} – ${overlap.peerEndLabel}). ` +
    'Satu sopir tidak dapat menjalani dua perjalanan pada waktu yang sama: ' +
    'perbaiki tanggal/jam, atau tolak laporan yang salah.'
  );
}

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Payroll periods whose reports could share time with a trip running from
 * `dateStart` to `dateEnd`: the day before (a trip that ran past midnight),
 * the days it covers, and the day after the start (an arrival that wraps).
 */
export function driverOverlapSearchPeriods(dateStart: string, dateEnd: string): string[] {
  const end = dateEnd >= dateStart ? dateEnd : dateStart;
  const days = [shiftDate(dateStart, -1), dateStart, shiftDate(dateStart, 1), end];
  return [...new Set(days.map((day) => pekaryaPayrollPeriodForDate(day)))];
}
