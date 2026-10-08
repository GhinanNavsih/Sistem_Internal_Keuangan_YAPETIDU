/**
 * One-time load of the paper Bonus Triwulan records for August and September
 * 2026, so SAKU can work October out on its own (October reads both months:
 * their Senam Pagi, and who was already paid, since a payout starts a fresh
 * three-month count). The rules are in src/lib/payroll/bonusTriwulanSeed.ts.
 *
 * 1. Make the sheet: one row per Loyalis on the payroll in August or
 *    September, with a hidden ID column so no name has to be matched.
 *      npm run seed:bonus-triwulan -- --template bonus-triwulan-arsip.xlsx
 * 2. Fill every Senam/Bonus cell with Y or T from the paper records.
 * 3. Check it (dry run: validates the sheet and previews October):
 *      npm run seed:bonus-triwulan -- --file bonus-triwulan-arsip.xlsx
 * 4. Write it:
 *      npm run seed:bonus-triwulan -- --file bonus-triwulan-arsip.xlsx --apply
 *
 * Writes SenamPagi/{2026-08,2026-09} and BonusTriwulan/{2026-08,2026-09} with
 * `source: 'paper'`, each with a FinancialAuditLogs entry. A month already
 * holding exactly this content is left alone; one SAKU recorded itself is
 * never overwritten.
 */
import './initEnv';
import * as XLSX from 'xlsx';
import admin, { adminDb } from '../src/lib/firebase-admin';
import {
  BONUS_TRIWULAN_AMOUNT,
  BONUS_TRIWULAN_COLLECTION,
  BONUS_TRIWULAN_SEED_PERIODS,
  BONUS_TRIWULAN_START_PERIOD,
  periodLabel,
  SENAM_PAGI_COLLECTION,
  type StratumEntryLike,
} from '../src/lib/payroll/bonusTriwulan';
import {
  buildSeedTemplateRows,
  parseSeedRows,
  planSeed,
  previewOctoberCandidates,
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
  process.stdout.write(`Lembar untuk ${roster.length} Loyalis ditulis ke ${path}. Isi setiap kolom Senam/Bonus dengan Y atau T.\n`);
}

function readSheet(path: string): Record<string, unknown>[] {
  const workbook = XLSX.readFile(path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index]);
}

async function main() {
  const templatePath = argValue('--template');
  const filePath = argValue('--file');
  const apply = process.argv.includes('--apply');
  const roster = await loadSeedRoster();

  if (templatePath) {
    writeTemplate(templatePath, roster);
    return;
  }
  if (!filePath) {
    throw new Error('Pakai --template <file.xlsx> untuk membuat lembar, atau --file <file.xlsx> [--apply] untuk memuatnya.');
  }

  const parsed = parseSeedRows(readSheet(filePath), roster);
  const presenceDocs = await Promise.all(
    BONUS_TRIWULAN_SEED_PERIODS.map((period) => loadEffectiveLoyalisPresence(period)),
  );
  const presence = Object.fromEntries(BONUS_TRIWULAN_SEED_PERIODS.map((period, index) => [
    period,
    (presenceDocs[index]?.entries || null) as Record<string, StratumEntryLike | undefined> | null,
  ]));
  const plan = planSeed(parsed.entries);
  const missingPresence = BONUS_TRIWULAN_SEED_PERIODS.filter((period) => !presence[period]);

  process.stdout.write(`${JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN',
    project: admin.app().options.projectId || null,
    rosterCount: roster.length,
    rowCount: parsed.entries.length,
    errors: parsed.errors,
    warnings: parsed.warnings,
    months: Object.fromEntries(BONUS_TRIWULAN_SEED_PERIODS.map((period) => [periodLabel(period), {
      senamMet: plan.senamMetIds[period].length,
      bonusRecipients: plan.recipients[period].map((recipient) => recipient.employeeName),
    }])),
    presenceNotSaved: missingPresence.map(periodLabel),
    [`canStillEarnIn${periodLabel(BONUS_TRIWULAN_START_PERIOD).replace(' ', '')}`]:
      previewOctoberCandidates(parsed.entries, presence),
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
    const refs = BONUS_TRIWULAN_SEED_PERIODS.flatMap((period) => [
      adminDb.collection(SENAM_PAGI_COLLECTION).doc(period),
      adminDb.collection(BONUS_TRIWULAN_COLLECTION).doc(period),
    ]);
    const snapshots = await transaction.getAll(...refs);
    for (const snapshot of snapshots) {
      if (snapshot.exists && snapshot.data()?.source !== 'paper') {
        throw new Error(`${snapshot.ref.path} sudah dicatat di SAKU; tidak ditimpa.`);
      }
    }
    written = 0;
    BONUS_TRIWULAN_SEED_PERIODS.forEach((period, index) => {
      const [senamSnapshot, bonusSnapshot] = [snapshots[index * 2], snapshots[index * 2 + 1]];
      const senamMetIds = plan.senamMetIds[period];
      const recipients = plan.recipients[period];

      const senamBefore = senamSnapshot.data();
      const senamBeforeIds = Array.isArray(senamBefore?.paperMetEmployeeIds) ? senamBefore.paperMetEmployeeIds as string[] : null;
      if (!senamBeforeIds || !sameIds(senamBeforeIds, senamMetIds)) {
        transaction.set(senamSnapshot.ref, {
          period,
          source: 'paper',
          noSessions: false,
          sessions: {},
          paperMetEmployeeIds: senamMetIds,
          revision: Number(senamBefore?.revision || 0) + 1,
          createdAt: senamBefore?.createdAt || now,
          updatedAt: now,
          updatedBy: ACTOR_UID,
          schemaVersion: 1,
        });
        transaction.create(adminDb.collection('FinancialAuditLogs').doc(), {
          action: 'SENAM_PAGI_PAPER_SEEDED',
          entityType: 'SenamPagi',
          entityId: period,
          reason: `Senam Pagi ${periodLabel(period)} dimuat dari arsip kertas.`,
          requestId: null,
          actorUid: ACTOR_UID,
          actorRole: null,
          actorEmail: null,
          before: senamBeforeIds ? { paperMetEmployeeIds: senamBeforeIds } : null,
          after: { paperMetEmployeeIds: senamMetIds },
          metadata: { file: filePath },
          occurredAt: now,
          schemaVersion: 1,
        });
        written += 1;
      }

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
