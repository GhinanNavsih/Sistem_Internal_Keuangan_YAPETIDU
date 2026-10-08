import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySenamPagiCommand,
  bonusTriwulanEventId,
  bonusTriwulanResultMatches,
  bonusTriwulanWindow,
  evaluateBonusTriwulan,
  parseSenamPagiDoc,
  senamPagiStanding,
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
    paperMetEmployeeIds: [],
    revision: 1,
  };
}

/** Four sessions, everyone present except the listed absentees on the first one(s). */
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

function presence(strata: Record<string, number>) {
  return Object.fromEntries(Object.entries(strata).map(([id, stratum]) => [id, { stratum }]));
}

/** The evaluator's input, with arrays the tests may edit in place. */
type EditableInput = BonusTriwulanInput & {
  months: BonusTriwulanMonthInput[];
  priorRecipients: Array<{ period: string; recipients: readonly string[] | null }>;
};

function input(overrides: Partial<EditableInput> = {}): EditableInput {
  const period = overrides.period || '2026-06';
  const [m2, m1, m0] = bonusTriwulanWindow(period);
  const ids = [SUSPA.employeeId, BUDI.employeeId];
  return {
    period,
    employees: [SUSPA, BUDI],
    months: [m2, m1, m0].map((month) => ({
      period: month,
      presence: presence({ [SUSPA.employeeId]: 1, [BUDI.employeeId]: 1 }),
      senam: senam(month, ids, { [SUSPA.employeeId]: 1 }),
    })),
    priorRecipients: [
      { period: m2, recipients: [] },
      { period: m1, recipients: [] },
    ],
    ...overrides,
  };
}

test('the window is M-2, M-1, M and the event is one per month', () => {
  assert.deepEqual(bonusTriwulanWindow('2026-10'), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(bonusTriwulanWindow('2027-01'), ['2026-11', '2026-12', '2027-01']);
  assert.equal(bonusTriwulanEventId('2026-10'), 'BONUS_TRIWULAN_2026-10');
});

test('Suspa: Strata 1 and one Senam miss in April, May and June pays in June', () => {
  const result = evaluateBonusTriwulan(input());
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.recipients, [BUDI.employeeId, SUSPA.employeeId].sort());
  const suspa = result.rows.find((row) => row.employeeId === SUSPA.employeeId)!;
  assert.equal(suspa.awarded, true);
  assert.deepEqual(suspa.months.map((month) => month.senam.misses), [1, 1, 1]);
});

test('two Senam misses in one month break the streak', () => {
  const base = input();
  base.months[1] = {
    ...base.months[1],
    senam: senam(base.months[1].period, [SUSPA.employeeId, BUDI.employeeId], { [SUSPA.employeeId]: 2 }),
  };
  const result = evaluateBonusTriwulan(base);
  assert.deepEqual(result.recipients, [BUDI.employeeId]);
  const suspa = result.rows.find((row) => row.employeeId === SUSPA.employeeId)!;
  assert.equal(suspa.reason, 'Mei: tidak ikut senam 2×');
});

test('Strata 2 in any month of the window fails', () => {
  const base = input();
  base.months[0] = { ...base.months[0], presence: presence({ [SUSPA.employeeId]: 2, [BUDI.employeeId]: 1 }) };
  const result = evaluateBonusTriwulan(base);
  assert.deepEqual(result.recipients, [BUDI.employeeId]);
  assert.equal(result.rows.find((row) => row.employeeId === SUSPA.employeeId)!.reason, 'April: Strata 2');
});

test('someone missing from the presence data does not qualify', () => {
  const base = input();
  base.months[2] = { ...base.months[2], presence: presence({ [BUDI.employeeId]: 1 }) };
  const result = evaluateBonusTriwulan(base);
  assert.deepEqual(result.recipients, [BUDI.employeeId]);
  assert.equal(
    result.rows.find((row) => row.employeeId === SUSPA.employeeId)!.reason,
    'Juni: tidak ada data presensi',
  );
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
  assert.equal(
    paidInMay.rows.find((row) => row.employeeId === SUSPA.employeeId)!.reason,
    'Sudah dapat di Mei; hitungan dimulai lagi',
  );

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

test('a month marked without Senam Pagi meets the Senam rule', () => {
  const base = input();
  base.months[1] = {
    ...base.months[1],
    senam: { ...sessionsMonth(base.months[1].period, {}), noSessions: true },
  };
  assert.deepEqual(evaluateBonusTriwulan(base).recipients, [BUDI.employeeId, SUSPA.employeeId].sort());
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
  assert.equal(result.rows[0].reason, 'Menunggu data lengkap');

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
  assert.deepEqual(senamPagiStanding(empty, SUSPA.employeeId), {
    recorded: false, sessionCount: 0, misses: 0, met: false,
  });
  assert.equal(senamPagiStanding(null, SUSPA.employeeId).met, false);
});

test('paper months read the met list', () => {
  const paper: SenamPagiMonth = {
    period: '2026-09',
    source: 'paper',
    noSessions: false,
    sessions: [],
    paperMetEmployeeIds: [SUSPA.employeeId],
    revision: 1,
  };
  assert.equal(senamPagiStanding(paper, SUSPA.employeeId).met, true);
  assert.equal(senamPagiStanding(paper, BUDI.employeeId).met, false);
  assert.equal(senamPagiStanding(paper, BUDI.employeeId).recorded, true);

  const base = input({ period: '2026-10' });
  base.months[1] = { ...base.months[1], senam: paper };
  assert.deepEqual(evaluateBonusTriwulan(base).recipients, [SUSPA.employeeId]);
});

test('a single session month still allows one miss', () => {
  const month = sessionsMonth('2026-10', { '2026-10-05': [] });
  assert.equal(senamPagiStanding(month, SUSPA.employeeId).met, true);
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

  const paper = parseSenamPagiDoc('2026-09', { source: 'paper', paperMetEmployeeIds: [SUSPA.employeeId] });
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
