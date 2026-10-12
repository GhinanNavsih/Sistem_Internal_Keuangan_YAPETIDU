/**
 * One-time load of the paper Bonus Triwulan records for August and September
 * 2026, so SAKU can work October out on its own. October reads both months: how
 * many Senam Pagi sessions each person missed (the miss limit counts every
 * session of the three months together), and who was already paid, since a
 * payout starts a fresh three-month count. The rules are in
 * src/lib/payroll/bonusTriwulanSeed.ts.
 *
 * A. Senam Pagi, from a month's attendance recap (NAMA + one dd/mm column per
 *    session, a 1 for each session attended): matched to the roster by name, as
 *    well as hand typed names can be. Writes only SenamPagi/{month}, with how
 *    many sessions each Loyalis missed. Nothing is written while a person who
 *    could still qualify (at most one miss in this month alone) cannot be
 *    matched; settle those in a JSON file of
 *    { "<name in the sheet>": "<employee id>" | null } passed as --map.
 *      npm run seed:bonus-triwulan -- --senam-sheet recap.xlsx --month 2026-09 [--map map.json]
 *      npm run seed:bonus-triwulan -- --senam-sheet recap.xlsx --month 2026-09 [--map map.json] --apply
 *
 * B. Who received the bonus, from a Y/T sheet:
 * 1. Make the sheet: one row per Loyalis on the payroll in August or
 *    September, with a hidden ID column so no name has to be matched.
 *      npm run seed:bonus-triwulan -- --template bonus-triwulan-arsip.xlsx
 * 2. Fill every Bonus cell with Y or T from the paper records.
 * 3. Check it (dry run: validates the sheet and previews October):
 *      npm run seed:bonus-triwulan -- --file bonus-triwulan-arsip.xlsx
 * 4. Write it:
 *      npm run seed:bonus-triwulan -- --file bonus-triwulan-arsip.xlsx --apply
 *
 * A writes SenamPagi/{month} and B writes BonusTriwulan/{2026-08,2026-09}, all
 * with `source: 'paper'` and a FinancialAuditLogs entry. A month already
 * holding exactly this content is left alone; one SAKU recorded itself is
 * never overwritten.
 */
import './initEnv';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as XLSX from 'xlsx';
import admin, { adminDb } from '../src/lib/firebase-admin';
import {
  BONUS_TRIWULAN_AMOUNT,
  BONUS_TRIWULAN_COLLECTION,
  BONUS_TRIWULAN_SEED_PERIODS,
  BONUS_TRIWULAN_START_PERIOD,
  isBonusTriwulanSeedPeriod,
  parseSenamPagiDoc,
  periodLabel,
  SENAM_PAGI_COLLECTION,
  SENAM_PAGI_MAX_MISSES,
  senamPagiStanding,
  type StratumEntryLike,
} from '../src/lib/payroll/bonusTriwulan';
import {
  buildSeedTemplateRows,
  matchRekapNames,
  parseRekapSheet,
  parseSeedRows,
  planSeed,
  previewOctoberCandidates,
  rekapMinAttended,
  seedTemplateHeaders,
  type SeedRosterEntry,
} from '../src/lib/payroll/bonusTriwulanSeed';
import { loadLoyalisRoster } from '../src/lib/server/bonusTriwulan';
import { loadEffectiveLoyalisPresence } from '../src/lib/server/loyalisPresence';

const ACTOR_UID = 'script:seedBonusTriwulan';

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

/** Loyalis on the payroll in either seed month, once each, sorted by name. */
async function loadSeedRoster(): Promise<SeedRosterEntry[]> {
  const rosters = await Promise.all(BONUS_TRIWULAN_SEED_PERIODS.map((period) => loadLoyalisRoster(period)));
  const byId = new Map<string, SeedRosterEntry>();
  for (const entry of rosters.flat()) byId.set(entry.employeeId, entry);
  return [...byId.values()].sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'id-ID'));
}

function writeTemplate(path: string, roster: readonly SeedRosterEntry[]) {
  const headers = seedTemplateHeaders();
  const sheet = XLSX.utils.json_to_sheet(buildSeedTemplateRows(roster), { header: headers });
  sheet['!cols'] = headers.map((header, index) => (index === 0 ? { hidden: true, wch: 16 } : { wch: Math.max(12, header.length + 2) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Arsip Bonus Triwulan');
  XLSX.writeFile(workbook, path);
  process.stdout.write(`Lembar untuk ${roster.length} Loyalis ditulis ke ${path}. Isi setiap kolom Bonus dengan Y atau T.\n`);
}

function readSheet(path: string): Record<string, unknown>[] {
  const workbook = XLSX.readFile(path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index]);
}

function sameCounts(left: Record<string, number>, right: Record<string, number>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

/** Loads one month's Senam Pagi from an attendance recap sheet. */
async function seedFromRecap(path: string, period: string | null, mapPath: string | null, apply: boolean) {
  if (!period || !isBonusTriwulanSeedPeriod(period)) {
    throw new Error(`--month wajib salah satu dari: ${BONUS_TRIWULAN_SEED_PERIODS.join(', ')}.`);
  }
  const workbook = XLSX.readFile(path);
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1, defval: '', raw: false,
  });
  const parsed = parseRekapSheet(grid, period);
  if ('error' in parsed) throw new Error(parsed.error);
  const { sheet } = parsed;
  const sessionCount = sheet.sessionDates.length;
  const overrides: Record<string, string | null> = mapPath ? JSON.parse(readFileSync(mapPath, 'utf8')) : {};
  const roster = await loadLoyalisRoster(period);
  const matches = matchRekapNames(sheet.rows, roster, overrides);
  const minAttended = rekapMinAttended(sessionCount);

  const matched = matches.filter((match) => match.employeeId);
  const unmatched = matches.filter((match) => !match.employeeId);
  // Someone who missed more than the limit in this month alone cannot qualify
  // in any window, so only the others have to be matched.
  const needsReview = unmatched.filter((match) => match.row.attended >= minAttended);
  const matchedIds = new Set(matched.map((match) => match.employeeId));
  // Everyone on the roster gets a count; whoever the sheet does not list missed every session.
  const paperMisses: Record<string, number> = Object.fromEntries(roster.map((entry) => [entry.employeeId, sessionCount]));
  for (const match of matched) paperMisses[match.employeeId!] = Math.max(0, sessionCount - match.row.attended);
  const missesBreakdown: Record<string, number> = {};
  for (const misses of Object.values(paperMisses)) {
    const key = misses > SENAM_PAGI_MAX_MISSES ? `${SENAM_PAGI_MAX_MISSES + 1}+ (tidak bisa memenuhi)` : String(misses);
    missesBreakdown[key] = (missesBreakdown[key] || 0) + 1;
  }
  const methodCounts: Record<string, number> = {};
  for (const match of matched) methodCounts[match.method!] = (methodCounts[match.method!] || 0) + 1;

  process.stdout.write(`${JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN',
    project: admin.app().options.projectId || null,
    month: periodLabel(period),
    sessions: sheet.sessionDates,
    rule: `batas ${SENAM_PAGI_MAX_MISSES} tidak hadir dari semua sesi dalam 3 bulan; bulan ini ${sessionCount} sesi`,
    sheetRows: sheet.rows.length,
    rosterCount: roster.length,
    matched: methodCounts,
    roster_by_misses_this_month: missesBreakdown,
    warnings: sheet.warnings,
    reviewMatches: matched
      .filter((match) => match.method !== 'exact')
      .map((match) => ({ sheet: match.row.name, attended: match.row.attended, as: match.employeeName, id: match.employeeId, how: match.method })),
    needsReview: needsReview.map((match) => ({
      sheet: match.row.name, line: match.row.line, attended: match.row.attended, note: match.note, nearest: match.suggestions,
    })),
    unmatchedCannotQualify: unmatched.filter((match) => match.row.attended < minAttended).map((match) => match.row.name),
    rosterNotInSheet: roster.filter((entry) => !matchedIds.has(entry.employeeId)).map((entry) => `${entry.employeeId} ${entry.employeeName}`),
  }, null, 2)}\n`);

  if (needsReview.length > 0) {
    process.exitCode = 1;
    process.stdout.write('Ada nama yang masih bisa memenuhi batas tetapi belum cocok dengan Loyalis; tidak ada yang ditulis. Tetapkan lewat --map.\n');
    return;
  }
  if (!apply) return;

  const ref = adminDb.collection(SENAM_PAGI_COLLECTION).doc(period);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const written = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const before = snapshot.data();
    if (snapshot.exists && before?.source !== 'paper') {
      throw new Error(`${ref.path} sudah dicatat di SAKU; tidak ditimpa.`);
    }
    const beforeMonth = snapshot.exists ? parseSenamPagiDoc(period, before) : null;
    if (beforeMonth && beforeMonth.paperSessionCount === sessionCount && sameCounts(beforeMonth.paperMisses, paperMisses)) {
      return false;
    }
    transaction.set(ref, {
      period,
      source: 'paper',
      noSessions: false,
      sessions: {},
      paperSessionCount: sessionCount,
      paperMisses,
      paperDetail: {
        file: basename(path),
        sessionDates: sheet.sessionDates,
        attended: Object.fromEntries(matched.map((match) => [match.employeeId!, match.row.attended])),
      },
      revision: Number(before?.revision || 0) + 1,
      createdAt: before?.createdAt || now,
      updatedAt: now,
      updatedBy: ACTOR_UID,
      schemaVersion: 2,
    });
    transaction.create(adminDb.collection('FinancialAuditLogs').doc(), {
      action: 'SENAM_PAGI_PAPER_SEEDED',
      entityType: 'SenamPagi',
      entityId: period,
      reason: `Senam Pagi ${periodLabel(period)} dimuat dari rekap absen.`,
      requestId: null,
      actorUid: ACTOR_UID,
      actorRole: null,
      actorEmail: null,
      before: beforeMonth ? { paperSessionCount: beforeMonth.paperSessionCount, paperMisses: beforeMonth.paperMisses } : null,
      after: { paperSessionCount: sessionCount, paperMisses },
      metadata: { file: basename(path), unmatchedRows: unmatched.length, overrides: Object.keys(overrides).length },
      occurredAt: now,
      schemaVersion: 1,
    });
    return true;
  });
  process.stdout.write(written
    ? `Senam Pagi ${periodLabel(period)} ditulis: ${sessionCount} sesi, jumlah tidak hadir untuk ${roster.length} Loyalis.\n`
    : 'Arsip sudah sama dengan rekap ini; tidak ada yang ditulis.\n');
}

/** Each seed month's misses per person, from the Senam Pagi already loaded; null for a month not loaded. */
async function loadPaperMisses(roster: readonly SeedRosterEntry[]): Promise<Record<string, Record<string, number> | null>> {
  const snapshots = await adminDb.getAll(
    ...BONUS_TRIWULAN_SEED_PERIODS.map((period) => adminDb.collection(SENAM_PAGI_COLLECTION).doc(period)),
  );
  return Object.fromEntries(snapshots.map((snapshot, index) => {
    const period = BONUS_TRIWULAN_SEED_PERIODS[index];
    const month = snapshot.exists ? parseSenamPagiDoc(period, snapshot.data()) : null;
    if (!month || month.source !== 'paper') return [period, null];
    return [period, Object.fromEntries(roster.map((entry) => [entry.employeeId, senamPagiStanding(month, entry.employeeId).misses]))];
  }).map(([period, misses]) => [period, misses && Object.keys(misses).length > 0 ? misses : null]));
}

async function main() {
  const templatePath = argValue('--template');
  const filePath = argValue('--file');
  const recapPath = argValue('--senam-sheet');
  const apply = process.argv.includes('--apply');

  if (recapPath) {
    await seedFromRecap(recapPath, argValue('--month'), argValue('--map'), apply);
    return;
  }
  const roster = await loadSeedRoster();

  if (templatePath) {
    writeTemplate(templatePath, roster);
    return;
  }
  if (!filePath) {
    throw new Error(
      'Pakai --senam-sheet <rekap.xlsx> --month YYYY-MM [--map map.json] [--apply] untuk memuat rekap absen, ' +
      '--template <file.xlsx> untuk membuat lembar Y/T penerima bonus, atau --file <file.xlsx> [--apply] untuk memuatnya.',
    );
  }

  const parsed = parseSeedRows(readSheet(filePath), roster);
  const presenceDocs = await Promise.all(
    BONUS_TRIWULAN_SEED_PERIODS.map((period) => loadEffectiveLoyalisPresence(period)),
  );
  const presence = Object.fromEntries(BONUS_TRIWULAN_SEED_PERIODS.map((period, index) => [
    period,
    (presenceDocs[index]?.entries || null) as Record<string, StratumEntryLike | undefined> | null,
  ]));
  const paperMisses = await loadPaperMisses(roster);
  const plan = planSeed(parsed.entries);
  const missingPresence = BONUS_TRIWULAN_SEED_PERIODS.filter((period) => !presence[period]);
  const missingSenam = BONUS_TRIWULAN_SEED_PERIODS.filter((period) => !paperMisses[period]);
  const octoberKey = `canStillEarnIn${periodLabel(BONUS_TRIWULAN_START_PERIOD).replace(' ', '')}`;

  process.stdout.write(`${JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN',
    project: admin.app().options.projectId || null,
    rosterCount: roster.length,
    rowCount: parsed.entries.length,
    errors: parsed.errors,
    months: Object.fromEntries(BONUS_TRIWULAN_SEED_PERIODS.map((period) => [periodLabel(period), {
      bonusRecipients: plan.recipients[period].map((recipient) => recipient.employeeName),
    }])),
    presenceNotSaved: missingPresence.map(periodLabel),
    senamPagiNotLoaded: missingSenam.map(periodLabel),
    [octoberKey]: missingSenam.length > 0
      ? `belum bisa dihitung: muat Senam Pagi ${missingSenam.map(periodLabel).join(', ')} dulu (--senam-sheet)`
      : previewOctoberCandidates(
          parsed.entries,
          presence,
          paperMisses as Record<string, Record<string, number>>,
        ),
  }, null, 2)}\n`);

  if (parsed.errors.length > 0) {
    process.exitCode = 1;
    process.stdout.write('Lembar belum benar; tidak ada yang ditulis.\n');
    return;
  }
  if (!apply) return;

  const now = admin.firestore.FieldValue.serverTimestamp();
  let written = 0;
  await adminDb.runTransaction(async (transaction) => {
    const refs = BONUS_TRIWULAN_SEED_PERIODS.map((period) => adminDb.collection(BONUS_TRIWULAN_COLLECTION).doc(period));
    const snapshots = await transaction.getAll(...refs);
    for (const snapshot of snapshots) {
      if (snapshot.exists && snapshot.data()?.source !== 'paper') {
        throw new Error(`${snapshot.ref.path} sudah dicatat di SAKU; tidak ditimpa.`);
      }
    }
    written = 0;
    BONUS_TRIWULAN_SEED_PERIODS.forEach((period, index) => {
      const bonusSnapshot = snapshots[index];
      const recipients = plan.recipients[period];
      const bonusBefore = bonusSnapshot.data();
      const bonusBeforeIds = bonusBefore?.recipients && typeof bonusBefore.recipients === 'object'
        ? Object.keys(bonusBefore.recipients)
        : null;
      const recipientIds = recipients.map((recipient) => recipient.employeeId);
      if (!bonusBeforeIds || !sameIds(bonusBeforeIds, recipientIds)) {
        transaction.set(bonusSnapshot.ref, {
          period,
          source: 'paper',
          recipients: Object.fromEntries(recipients.map((recipient) => [
            recipient.employeeId,
            { employeeName: recipient.employeeName },
          ])),
          missing: [],
          amount: BONUS_TRIWULAN_AMOUNT,
          revision: Number(bonusBefore?.revision || 0) + 1,
          evaluatedAt: now,
          evaluatedBy: ACTOR_UID,
          evaluatedByName: 'Arsip kertas',
          schemaVersion: 1,
        });
        transaction.create(adminDb.collection('FinancialAuditLogs').doc(), {
          action: 'BONUS_TRIWULAN_PAPER_SEEDED',
          entityType: 'BonusTriwulan',
          entityId: period,
          reason: `Penerima Bonus Triwulan ${periodLabel(period)} dimuat dari arsip kertas.`,
          requestId: null,
          actorUid: ACTOR_UID,
          actorRole: null,
          actorEmail: null,
          before: bonusBeforeIds ? { recipients: bonusBeforeIds } : null,
          after: { recipients: recipientIds },
          metadata: { file: filePath },
          occurredAt: now,
          schemaVersion: 1,
        });
        written += 1;
      }
    });
  });

  process.stdout.write(written > 0
    ? `${written} dokumen arsip ditulis. Bila Senam Pagi ${periodLabel(BONUS_TRIWULAN_START_PERIOD)} sudah dicatat, buka tab Bonus Triwulan lalu tekan "Hitung ulang".\n`
    : 'Arsip sudah sama dengan lembar ini; tidak ada yang ditulis.\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
