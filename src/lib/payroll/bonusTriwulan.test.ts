import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySenamPagiCommand,
  bonusTriwulanEventId,
  bonusTriwulanResultMatches,
  bonusTriwulanWindow,
  evaluateBonusTriwulan,
  isSenamPagiRecorded,
  parseSenamPagiDoc,
  senamPagiStanding,
  senamPagiWindowStanding,
  type BonusTriwulanInput,
  type BonusTriwulanMonthInput,
  type SenamPagiMonth,
} from './bonusTriwulan';

const SUSPA = { employeeId: 'Loyalis_001', employeeName: 'Suspa' };
const BUDI = { employeeId: 'Loyalis_002', employeeName: 'Budi' };

function sessionsMonth(period: string, attendance: Record<string, string[]>): SenamPagiMonth {
  return {
    period,
    source: 'saku',
    noSessions: false,
    sessions: Object.entries(attendance).map(([date, presentEmployeeIds]) => ({ date, presentEmployeeIds })),
    paperSessionCount: null,
    paperMisses: {},
    revision: 1,
  };
}

/** Four sessions, everyone present except that each listed person misses their first N. */
function senam(period: string, ids: string[], missesById: Record<string, number> = {}): SenamPagiMonth {
  const dates = ['05', '12', '19', '26'].map((day) => `${period}-${day}`);
  return sessionsMonth(
    period,
    Object.fromEntries(dates.map((date, index) => [
      date,
      ids.filter((id) => index >= (missesById[id] || 0)),
    ])),
  );
}

function paperMonth(period: string, sessionCount: number, paperMisses: Record<string, number>): SenamPagiMonth {
  return {
    period, source: 'paper', noSessions: false, sessions: [], paperSessionCount: sessionCount, paperMisses, revision: 1,
  };
}

function presence(strata: Record<string, number>) {
  return Object.fromEntries(Object.entries(strata).map(([id, stratum]) => [id, { stratum }]));
}

/** The evaluator's input, with arrays the tests may edit in place. */
type EditableInput = BonusTriwulanInput & {
  months: BonusTriwulanMonthInput[];
  priorRecipients: Array<{ period: string; recipients: readonly string[] | null }>;
};

/**
 * Everyone is Strata 1. Suspa misses `suspaMisses[i]` of the four sessions in
 * month i (by default one in the first month, so one in the whole window);
 * Budi misses none.
 */
function input(overrides: Partial<EditableInput> = {}, suspaMisses = [1, 0, 0]): EditableInput {
  const period = overrides.period || '2026-06';
  const window = bonusTriwulanWindow(period);
  const ids = [SUSPA.employeeId, BUDI.employeeId];
  return {
    period,
    employees: [SUSPA, BUDI],
    months: window.map((month, index) => ({
      period: month,
      presence: presence({ [SUSPA.employeeId]: 1, [BUDI.employeeId]: 1 }),
      senam: senam(month, ids, { [SUSPA.employeeId]: suspaMisses[index] }),
    })),
    priorRecipients: [
      { period: window[0], recipients: [] },
      { period: window[1], recipients: [] },
    ],
    ...overrides,
  };
}

const row = (result: ReturnType<typeof evaluateBonusTriwulan>, employeeId: string) =>
  result.rows.find((item) => item.employeeId === employeeId)!;

test('the window is M-2, M-1, M and the event is one per month', () => {
  assert.deepEqual(bonusTriwulanWindow('2026-10'), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(bonusTriwulanWindow('2027-01'), ['2026-11', '2026-12', '2027-01']);
  assert.equal(bonusTriwulanEventId('2026-10'), 'BONUS_TRIWULAN_2026-10');
});

test('Suspa: Strata 1 and one Senam miss in all of April, May and June pays in June', () => {
  const result = evaluateBonusTriwulan(input());
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.recipients, [BUDI.employeeId, SUSPA.employeeId].sort());
  const suspa = row(result, SUSPA.employeeId);
  assert.equal(suspa.awarded, true);
  assert.deepEqual(suspa.months.map((month) => month.senam.misses), [1, 0, 0]);
  assert.deepEqual(
    { sessions: suspa.senam.sessions, misses: suspa.senam.misses, met: suspa.senam.met },
    { sessions: 12, misses: 1, met: true },
  );
});

test('the miss limit is on the whole window: one miss in each of two months fails', () => {
  const result = evaluateBonusTriwulan(input({}, [1, 1, 0]));
  assert.deepEqual(result.recipients, [BUDI.employeeId]);
  const suspa = row(result, SUSPA.employeeId);
  assert.equal(suspa.senam.failed, true);
  assert.equal(suspa.reason, 'Senam Pagi: tidak hadir 2× dari 12 sesi (maks. 1)');
});

test('two misses in one month fail, and so do one miss in every month', () => {
  assert.deepEqual(evaluateBonusTriwulan(input({}, [0, 2, 0])).recipients, [BUDI.employeeId]);
  assert.deepEqual(evaluateBonusTriwulan(input({}, [1, 1, 1])).recipients, [BUDI.employeeId]);
});

test('no misses at all, and exactly one miss, both pass', () => {
  assert.equal(row(evaluateBonusTriwulan(input({}, [0, 0, 0])), SUSPA.employeeId).awarded, true);
  assert.equal(row(evaluateBonusTriwulan(input({}, [0, 0, 1])), SUSPA.employeeId).awarded, true);
});

test('Strata 2 in any month of the window fails, whatever the attendance', () => {
  const base = input();
  base.months[0] = { ...base.months[0], presence: presence({ [SUSPA.employeeId]: 2, [BUDI.employeeId]: 1 }) };
  const result = evaluateBonusTriwulan(base);
  assert.deepEqual(result.recipients, [BUDI.employeeId]);
  assert.equal(row(result, SUSPA.employeeId).reason, 'April: Strata 2');
});

test('a reason lists both the Strata and the Senam Pagi failure', () => {
  const base = input({}, [1, 1, 0]);
  base.months[1] = { ...base.months[1], presence: presence({ [SUSPA.employeeId]: 3, [BUDI.employeeId]: 1 }) };
  assert.equal(
    row(evaluateBonusTriwulan(base), SUSPA.employeeId).reason,
    'Mei: Strata 3; Senam Pagi: tidak hadir 2× dari 12 sesi (maks. 1)',
  );
});

test('someone missing from the presence data does not qualify', () => {
  const base = input();
  base.months[2] = { ...base.months[2], presence: presence({ [BUDI.employeeId]: 1 }) };
  const result = evaluateBonusTriwulan(base);
  assert.deepEqual(result.recipients, [BUDI.employeeId]);
  assert.equal(row(result, SUSPA.employeeId).reason, 'Juni: tidak ada data presensi');
});

test('a not-found-in-Excel entry is not Strata 1 even with a stale stratum', () => {
  const base = input();
  base.months[2] = {
    ...base.months[2],
    presence: { [SUSPA.employeeId]: { stratum: 1, isNotFoundInExcel: true }, [BUDI.employeeId]: { stratum: 1 } },
  };
  assert.deepEqual(evaluateBonusTriwulan(base).recipients, [BUDI.employeeId]);
});

test('every streak starts fresh: a payout in M-1 or M-2 blocks month M', () => {
  const paidInMay = evaluateBonusTriwulan(input({
    priorRecipients: [
      { period: '2026-04', recipients: [] },
      { period: '2026-05', recipients: [SUSPA.employeeId] },
    ],
  }));
  assert.deepEqual(paidInMay.recipients, [BUDI.employeeId]);
  assert.equal(row(paidInMay, SUSPA.employeeId).reason, 'Sudah dapat di Mei; hitungan dimulai lagi');

  const paidInApril = evaluateBonusTriwulan(input({
    priorRecipients: [
      { period: '2026-04', recipients: [SUSPA.employeeId] },
      { period: '2026-05', recipients: [] },
    ],
  }));
  assert.deepEqual(paidInApril.recipients, [BUDI.employeeId]);
});

test('someone who qualifies every month is paid every third month', () => {
  const months = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'];
  const paid = new Map<string, string[]>([['2026-08', []], ['2026-09', []]]);
  for (const period of months.slice(2)) {
    const [m2, m1] = bonusTriwulanWindow(period);
    const result = evaluateBonusTriwulan({
      period,
      employees: [SUSPA],
      months: bonusTriwulanWindow(period).map((month) => ({
        period: month,
        presence: presence({ [SUSPA.employeeId]: 1 }),
        senam: senam(month, [SUSPA.employeeId]),
      })),
      priorRecipients: [
        { period: m2, recipients: paid.get(m2) ?? null },
        { period: m1, recipients: paid.get(m1) ?? null },
      ],
    });
    paid.set(period, result.recipients);
  }
  assert.deepEqual(
    [...paid.entries()].filter(([, ids]) => ids.length > 0).map(([period]) => period),
    ['2026-10', '2027-01'],
  );
});

test('a month marked without Senam Pagi adds no sessions and no misses', () => {
  const base = input({}, [0, 0, 1]);
  base.months[1] = {
    ...base.months[1],
    senam: { ...sessionsMonth(base.months[1].period, {}), noSessions: true },
  };
  const result = evaluateBonusTriwulan(base);
  assert.deepEqual(result.recipients, [BUDI.employeeId, SUSPA.employeeId].sort());
  assert.equal(row(result, SUSPA.employeeId).senam.sessions, 8, 'only the other two months held sessions');

  // The limit still applies to what the other months held.
  const twoMisses = input({}, [1, 0, 1]);
  twoMisses.months[1] = base.months[1];
  assert.deepEqual(evaluateBonusTriwulan(twoMisses).recipients, [BUDI.employeeId]);
});

test('missing data pays nobody and says what is missing', () => {
  const base = input({ period: '2026-10' });
  base.months[2] = { ...base.months[2], senam: null };
  base.priorRecipients = [
    { period: '2026-08', recipients: null },
    { period: '2026-09', recipients: [] },
  ];
  const result = evaluateBonusTriwulan(base);
  assert.deepEqual(result.recipients, []);
  assert.deepEqual(result.missing, [
    'Senam Pagi Oktober 2026 belum dicatat.',
    'Data Bonus Triwulan Agustus 2026 dari arsip kertas belum dimasukkan.',
  ]);
  assert.equal(row(result, SUSPA.employeeId).reason, 'Menunggu data lengkap');

  const noPresence = input({ period: '2026-11' });
  noPresence.months[2] = { ...noPresence.months[2], presence: {} };
  noPresence.priorRecipients[1] = { period: '2026-10', recipients: null };
  assert.deepEqual(evaluateBonusTriwulan(noPresence).missing, [
    'Presensi Loyalis November 2026 belum disimpan.',
    'Bonus Triwulan Oktober 2026 belum dihitung.',
  ]);
});

test('an unrecorded month never counts as attended', () => {
  const empty = sessionsMonth('2026-10', {});
  assert.deepEqual(senamPagiStanding(empty, SUSPA.employeeId), { recorded: false, sessionCount: 0, misses: 0 });
  assert.equal(senamPagiStanding(null, SUSPA.employeeId).recorded, false);
});

test('paper months read how many sessions each person missed', () => {
  const september = paperMonth('2026-09', 3, { [SUSPA.employeeId]: 1, [BUDI.employeeId]: 0 });
  assert.deepEqual(senamPagiStanding(september, SUSPA.employeeId), { recorded: true, sessionCount: 3, misses: 1 });
  assert.equal(senamPagiStanding(september, BUDI.employeeId).misses, 0);
  assert.equal(senamPagiStanding(september, 'Loyalis_new').misses, 3, 'someone the record does not list missed every session');
  assert.equal(
    senamPagiStanding(paperMonth('2026-09', 3, { [SUSPA.employeeId]: 9 }), SUSPA.employeeId).misses,
    3,
    'a count cannot exceed the sessions held',
  );
});

test('a paper month counts toward the same limit as the months around it', () => {
  // October: Suspa missed one session in September (paper) and none in August or October.
  const window = ['2026-08', '2026-09', '2026-10'];
  const build = (octoberMisses: number): EditableInput => ({
    period: '2026-10',
    employees: [SUSPA],
    months: [
      { period: window[0], presence: presence({ [SUSPA.employeeId]: 1 }), senam: paperMonth(window[0], 3, { [SUSPA.employeeId]: 0 }) },
      { period: window[1], presence: presence({ [SUSPA.employeeId]: 1 }), senam: paperMonth(window[1], 3, { [SUSPA.employeeId]: 1 }) },
      { period: window[2], presence: presence({ [SUSPA.employeeId]: 1 }), senam: senam(window[2], [SUSPA.employeeId], { [SUSPA.employeeId]: octoberMisses }) },
    ],
    priorRecipients: [
      { period: window[0], recipients: [] },
      { period: window[1], recipients: [] },
    ],
  });
  assert.deepEqual(evaluateBonusTriwulan(build(0)).recipients, [SUSPA.employeeId]);
  const failed = evaluateBonusTriwulan(build(1));
  assert.deepEqual(failed.recipients, []);
  assert.equal(row(failed, SUSPA.employeeId).reason, 'Senam Pagi: tidak hadir 2× dari 10 sesi (maks. 1)');
});

test('an older paper record without session counts is treated as not recorded', () => {
  const legacy = parseSenamPagiDoc('2026-09', { source: 'paper', paperMetEmployeeIds: [SUSPA.employeeId], revision: 1 });
  assert.ok(legacy);
  assert.equal(legacy.paperSessionCount, null);
  assert.equal(isSenamPagiRecorded(legacy), false);
  assert.equal(senamPagiStanding(legacy, SUSPA.employeeId).recorded, false);

  const base = input({ period: '2026-10' });
  base.months[1] = { ...base.months[1], senam: legacy };
  const result = evaluateBonusTriwulan(base);
  assert.deepEqual(result.recipients, []);
  assert.ok(result.missing.includes('Senam Pagi September 2026 belum dicatat.'));
});

test('the window standing: over the limit is final, within it needs every month recorded', () => {
  const august = senam('2026-08', [SUSPA.employeeId], { [SUSPA.employeeId]: 1 });
  const september = senam('2026-09', [SUSPA.employeeId]);
  const october = senam('2026-10', [SUSPA.employeeId]);

  assert.deepEqual(
    senamPagiWindowStanding([august, september, october], SUSPA.employeeId),
    { complete: true, sessions: 12, misses: 1, failed: false, met: true },
  );
  const partial = senamPagiWindowStanding([august, september, null], SUSPA.employeeId);
  assert.deepEqual(
    { complete: partial.complete, failed: partial.failed, met: partial.met },
    { complete: false, failed: false, met: false },
  );
  const twoMissed = senam('2026-09', [SUSPA.employeeId], { [SUSPA.employeeId]: 1 });
  const failedEarly = senamPagiWindowStanding([august, twoMissed, null], SUSPA.employeeId);
  assert.deepEqual(
    { complete: failedEarly.complete, misses: failedEarly.misses, failed: failedEarly.failed, met: failedEarly.met },
    { complete: false, misses: 2, failed: true, met: false },
  );
});

test('a window with a single session still allows one miss, but not two', () => {
  const months = bonusTriwulanWindow('2026-10').map((period, index) => {
    const month = index === 2
      ? sessionsMonth(period, { [`${period}-05`]: [] })
      : { ...sessionsMonth(period, {}), noSessions: true };
    return { period, presence: presence({ [SUSPA.employeeId]: 1 }), senam: month };
  });
  const result = evaluateBonusTriwulan({
    period: '2026-10',
    employees: [SUSPA],
    months,
    priorRecipients: [{ period: '2026-08', recipients: [] }, { period: '2026-09', recipients: [] }],
  });
  assert.deepEqual(result.recipients, [SUSPA.employeeId]);
});

test('recorder commands: dates, roster, no-senam switch and paper months', () => {
  const context = {
    period: '2026-10',
    today: '2026-10-08',
    rosterIds: new Set([SUSPA.employeeId, BUDI.employeeId]),
  };
  const saved = applySenamPagiCommand(null, {
    action: 'save_session',
    date: '2026-10-03',
    presentEmployeeIds: [SUSPA.employeeId, SUSPA.employeeId],
  }, context);
  assert.ok('month' in saved);
  assert.deepEqual(saved.month.sessions, [{ date: '2026-10-03', presentEmployeeIds: [SUSPA.employeeId] }]);

  assert.deepEqual(
    applySenamPagiCommand(null, { action: 'save_session', date: '2026-10-09', presentEmployeeIds: [] }, context),
    { error: 'Sesi Senam Pagi yang belum berlangsung tidak dapat dicatat.' },
  );
  assert.deepEqual(
    applySenamPagiCommand(null, { action: 'save_session', date: '2026-09-30', presentEmployeeIds: [] }, context),
    { error: 'Tanggal sesi harus berada di Oktober 2026.' },
  );
  assert.deepEqual(
    applySenamPagiCommand(null, { action: 'save_session', date: '2026-10-02', presentEmployeeIds: ['Loyalis_999'] }, context),
    { error: 'Pegawai berikut bukan Loyalis aktif bulan ini: Loyalis_999.' },
  );
  assert.ok('error' in applySenamPagiCommand(saved.month, { action: 'set_no_sessions', noSessions: true }, context));

  const deleted = applySenamPagiCommand(saved.month, { action: 'delete_session', date: '2026-10-03' }, context);
  assert.ok('month' in deleted);
  const none = applySenamPagiCommand(deleted.month, { action: 'set_no_sessions', noSessions: true }, context);
  assert.ok('month' in none && none.month.noSessions);
  const again = applySenamPagiCommand(
    'month' in none ? none.month : null,
    { action: 'save_session', date: '2026-10-06', presentEmployeeIds: [] },
    context,
  );
  assert.ok('month' in again && again.month.noSessions === false);

  const paper = parseSenamPagiDoc('2026-09', {
    source: 'paper', paperSessionCount: 3, paperMisses: { [SUSPA.employeeId]: 1 },
  });
  assert.ok('error' in applySenamPagiCommand(paper, { action: 'set_no_sessions', noSessions: true }, { ...context, period: '2026-09' }));
});

test('parseSenamPagiDoc keeps only well-formed sessions of the month', () => {
  const month = parseSenamPagiDoc('2026-10', {
    sessions: {
      '2026-10-12': { presentEmployeeIds: ['B', 'A', 'A', 7] },
      '2026-10-05': { presentEmployeeIds: [] },
      '2026-11-01': { presentEmployeeIds: ['A'] },
    },
    revision: 3,
  });
  assert.deepEqual(month?.sessions, [
    { date: '2026-10-05', presentEmployeeIds: [] },
    { date: '2026-10-12', presentEmployeeIds: ['A', 'B'] },
  ]);
  assert.equal(month?.source, 'saku');
  assert.equal(parseSenamPagiDoc('2026-10', undefined), null);
});

test('parseSenamPagiDoc keeps only whole, non-negative paper miss counts', () => {
  const month = parseSenamPagiDoc('2026-09', {
    source: 'paper',
    paperSessionCount: 3,
    paperMisses: { A: 0, B: 2, C: -1, D: 1.5, E: '1', 'bad id!': 1 },
  });
  assert.equal(month?.paperSessionCount, 3);
  assert.deepEqual(month?.paperMisses, { A: 0, B: 2 });
  assert.equal(parseSenamPagiDoc('2026-09', { source: 'paper', paperSessionCount: -1 })?.paperSessionCount, null);
  assert.equal(parseSenamPagiDoc('2026-09', { source: 'paper', paperSessionCount: 0 })?.paperSessionCount, 0);
});

test('a stored result matches only the same recipients and missing list', () => {
  assert.equal(bonusTriwulanResultMatches(null, { recipients: [], missing: [] }), false);
  assert.equal(
    bonusTriwulanResultMatches({ recipients: ['b', 'a'], missing: [] }, { recipients: ['a', 'b'], missing: [] }),
    true,
  );
  assert.equal(
    bonusTriwulanResultMatches({ recipients: ['a'], missing: [] }, { recipients: ['a', 'b'], missing: [] }),
    false,
  );
  assert.equal(
    bonusTriwulanResultMatches({ recipients: [], missing: ['x'] }, { recipients: [], missing: [] }),
    false,
  );
});
