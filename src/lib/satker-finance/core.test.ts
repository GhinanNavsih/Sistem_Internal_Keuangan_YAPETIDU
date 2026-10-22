import assert from 'node:assert/strict';
import test from 'node:test';
import {
  academicYearFor, adjacentAcademicYear, buildFinancialStatements, buildVoucher, buildYearClosing, cashFlowAllocation, DEFAULT_ACCOUNTS, defaultCashFlowSection,
  defaultSurplusAccountId, entryCashFlows, entryReceiptPaths, fiscalMonths, groupNormalBalance, hasAbnormalBalance, JournalEntry, lastDateOfMonth, sameBalances,
  validateEntryDate, validateOpeningBalances, yearInUse, type FinancialAccount,
} from './core';

const academicYear = '2026-2027';
const opening = { '11001': { debit: 5_000_000, credit: 0 }, '30000': { debit: 0, credit: 5_000_000 } };

function entry(id: string, date: string, raw: Record<string, unknown>): JournalEntry {
  const voucher = buildVoucher({ date, description: `Voucher ${id}`, ...raw }, DEFAULT_ACCOUNTS);
  return { id, satkerId: 'puskomnet', academicYear, monthIndex: Number(date.slice(5, 7)), createdBy: 'test', ...voucher };
}

test('catalog faithfully includes 129 workbook codes and rejects empty placeholders', () => {
  assert.equal(DEFAULT_ACCOUNTS.length, 129);
  assert.equal(DEFAULT_ACCOUNTS.find((account) => account.code === '11000')?.postable, true);
  assert.equal(DEFAULT_ACCOUNTS.find((account) => account.code === '11000')?.cashEquivalent, true);
  assert.equal(DEFAULT_ACCOUNTS.find((account) => account.code === '11001')?.name, 'Bank Mandiri');
  assert.equal(DEFAULT_ACCOUNTS.find((account) => account.code === '11002')?.postable, false);
  assert.throws(() => entry('invalid', '2026-09-02', { kind: 'EXPENSE', accountCode: '11002', paymentAccountCode: '10000', amount: 1 }), /tidak dapat diposting|memerlukan/);
});

test('a pengeluaran may debit any postable account except the cash account it is paid from', () => {
  const toBank = entry('to-bank', '2026-09-02', { kind: 'EXPENSE', accountCode: '11001', paymentAccountCode: '10000', amount: 750_000 });
  assert.deepEqual(toBank.lines.map((line) => [line.accountCode, line.debit, line.credit]), [['11001', 750_000, 0], ['10000', 0, 750_000]]);
  assert.throws(() => entry('same', '2026-09-02', { kind: 'EXPENSE', accountCode: '10000', paymentAccountCode: '10000', amount: 1 }), /harus berbeda/);
});

test('a penerimaan may credit any postable account except the cash account it is received in', () => {
  const refund = entry('refund', '2026-09-02', { kind: 'INFLOW', accountCode: '51000', paymentAccountCode: '10000', amount: 100_000 });
  assert.deepEqual(refund.lines.map((line) => [line.accountCode, line.debit, line.credit]), [['10000', 100_000, 0], ['51000', 0, 100_000]]);
  assert.throws(() => entry('same', '2026-09-02', { kind: 'INFLOW', accountCode: '10000', paymentAccountCode: '10000', amount: 1 }), /harus berbeda/);
});

test('a batch of expense lines balanced by one KAS credit keeps each line\'s own uraian', () => {
  const batch = entry('batch', '2026-09-03', {
    kind: 'ADVANCED', description: 'Ongkos tukang dll/Suhadi/S1', cashFlowSection: 'OPERATING',
    lines: [
      { accountCode: '52101', description: 'Ongkos tukang dll/Suhadi/S1', debit: 2_212_500, credit: 0 },
      { accountCode: '52104', description: 'Doorprize ahad sehat/S2', debit: 188_400, credit: 0 },
      { accountCode: '10000', description: 'Pengeluaran BU', debit: 0, credit: 2_400_900 },
    ],
  });
  assert.deepEqual(batch.lines.map((line) => line.description), ['Ongkos tukang dll/Suhadi/S1', 'Doorprize ahad sehat/S2', 'Pengeluaran BU']);
  assert.equal(batch.totalAmount, 2_400_900);
  assert.throws(() => entry('long', '2026-09-03', { kind: 'ADVANCED', description: 'x', cashFlowSection: 'OPERATING', lines: [{ accountCode: '52101', description: 'x'.repeat(301), debit: 1, credit: 0 }, { accountCode: '10000', debit: 0, credit: 1 }] }), /maksimal 300/);
});

test('September-August fiscal calendar and real dates are enforced', () => {
  assert.deepEqual(fiscalMonths(academicYear).map((month) => month.monthIndex), [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(academicYearFor(new Date('2027-01-15T00:00:00Z')), academicYear);
  assert.doesNotThrow(() => validateEntryDate('2027-02-28', academicYear, 2));
  assert.throws(() => validateEntryDate('2027-02-29', academicYear, 2), /tidak valid/);
  assert.throws(() => validateEntryDate('2026-08-31', academicYear, 8), /di luar/);
});

test('opening balances and every journal line must balance exactly in whole Rupiah', () => {
  assert.deepEqual(validateOpeningBalances(opening, DEFAULT_ACCOUNTS), { debit: 5_000_000, credit: 5_000_000 });
  assert.throws(() => validateOpeningBalances({ '10000': { debit: 100, credit: 0 } }, DEFAULT_ACCOUNTS), /belum seimbang/);
  assert.throws(() => validateOpeningBalances({ '41000': { debit: 0, credit: 100 }, '10000': { debit: 100, credit: 0 } }, DEFAULT_ACCOUNTS), /tidak tersedia/);
  assert.throws(() => entry('bad', '2026-09-02', { kind: 'ADVANCED', cashFlowSection: 'OPERATING', lines: [
    { accountCode: '10000', debit: 100, credit: 0 }, { accountCode: '41000', debit: 0, credit: 90 },
  ] }), /harus seimbang/);
  assert.throws(() => entry('fraction', '2026-09-02', { kind: 'EXPENSE', accountCode: '52101', paymentAccountCode: '10000', amount: 1.5 }), /bulat/);
});

test('expense, droping, transfer, and investing vouchers reconcile ledger and cash flow', () => {
  const entries = [
    entry('droping', '2026-09-01', { kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '11001', amount: 5_100_000 }),
    entry('expense', '2026-09-02', { kind: 'EXPENSE', accountCode: '52101', paymentAccountCode: '10000', amount: 655_000 }),
    entry('transfer', '2026-09-03', { kind: 'TRANSFER', accountCode: '10000', paymentAccountCode: '11001', amount: 1_000_000 }),
    entry('investment', '2026-09-04', { kind: 'EXPENSE', accountCode: '13005', paymentAccountCode: '11001', amount: 2_000_000 }),
  ];
  assert.deepEqual(entries[2].lines.map((line) => [line.accountCode, line.debit, line.credit]), [['10000', 1_000_000, 0], ['11001', 0, 1_000_000]]);
  const statements = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries, academicYear, monthIndex: 9 });
  assert.equal(statements.incomeStatement.income, 5_100_000);
  assert.equal(statements.incomeStatement.expense, 655_000);
  assert.equal(statements.cashFlow.OPERATING, 5_100_000 - 655_000);
  assert.equal(statements.cashFlow.INVESTING, -2_000_000);
  assert.equal(statements.cashFlow.FINANCING, 0);
  assert.equal(statements.cashFlow.endingCash, 5_000_000 + 5_100_000 - 655_000 - 2_000_000);
  assert.equal(statements.cashFlow.reconciliationDelta, 0);
  assert.equal(statements.trialBalance.difference, 0);
  assert.equal(statements.annualWorksheet.incomeDebit, statements.annualWorksheet.incomeCredit);
  assert.equal(statements.annualWorksheet.balanceDebit, statements.annualWorksheet.balanceCredit);
  assert.equal(statements.rows.find((row) => row.account.code === '10000')?.endingDebit, 345_000);
});

test('advanced accrual does not invent a cash flow and monthly balances chain into annual', () => {
  const entries = [
    entry('accrual', '2026-09-20', { kind: 'ADVANCED', lines: [
      { accountCode: '54101', debit: 100_000, credit: 0 }, { accountCode: '20001', debit: 0, credit: 100_000 },
    ] }),
    entry('october', '2026-10-01', { kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '10000', amount: 200_000 }),
  ];
  const september = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries, academicYear, monthIndex: 9 });
  const october = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries, academicYear, monthIndex: 10 });
  const annual = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries, academicYear, monthIndex: 'ANNUAL' });
  assert.equal(september.cashFlow.netChange, 0);
  assert.equal(september.incomeStatement.expense, 100_000);
  assert.equal(october.cashFlow.openingCash, september.cashFlow.endingCash);
  assert.equal(october.cashFlow.netChange, 200_000);
  assert.equal(october.incomeStatement.expense, 0);
  assert.equal(annual.cashFlow.endingCash, october.cashFlow.endingCash);
  assert.equal(annual.trialBalance.difference, 0);
  assert.equal(annual.annualWorksheet.incomeDebit, annual.annualWorksheet.incomeCredit);
  assert.equal(annual.annualWorksheet.balanceDebit, annual.annualWorksheet.balanceCredit);
});

test('cash flows follow each counter account\'s catalog classification, not a choice made per journal', () => {
  // The section sent with the journal is ignored: equipment is investing and refreshments operating, whatever is chosen.
  const mixed = entry('mixed', '2026-09-05', { kind: 'ADVANCED', cashFlowSection: 'FINANCING', lines: [
    { accountCode: '52104', debit: 400_000, credit: 0 }, { accountCode: '13004', debit: 1_200_000, credit: 0 }, { accountCode: '11001', debit: 0, credit: 1_600_000 },
  ] });
  assert.deepEqual(mixed.cashFlows, { OPERATING: -400_000, INVESTING: -1_200_000, FINANCING: 0 });
  assert.equal(mixed.cashFlowSection, 'INVESTING');
  // Paying a payable is operating; capital paid in is financing.
  const payable = entry('payable', '2026-09-06', { kind: 'ADVANCED', lines: [{ accountCode: '20001', debit: 300_000, credit: 0 }, { accountCode: '10000', debit: 0, credit: 300_000 }] });
  assert.deepEqual(payable.cashFlows, { OPERATING: -300_000, INVESTING: 0, FINANCING: 0 });
  const capital = entry('capital', '2026-09-06', { kind: 'ADVANCED', lines: [{ accountCode: '10000', debit: 1_000_000, credit: 0 }, { accountCode: '30000', debit: 0, credit: 1_000_000 }] });
  assert.deepEqual(capital.cashFlows, { OPERATING: 0, INVESTING: 0, FINANCING: 1_000_000 });
  // An accrual and a transfer between cash accounts move no cash.
  const accrual = entry('accrual', '2026-09-07', { kind: 'ADVANCED', lines: [{ accountCode: '54101', debit: 10_000, credit: 0 }, { accountCode: '20001', debit: 0, credit: 10_000 }] });
  assert.deepEqual(accrual.cashFlows, { OPERATING: 0, INVESTING: 0, FINANCING: 0 });
  assert.equal(accrual.cashFlowSection, null);
  const statements = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries: [mixed, payable, capital, accrual], academicYear, monthIndex: 9 });
  assert.equal(statements.cashFlow.OPERATING, -700_000);
  assert.equal(statements.cashFlow.INVESTING, -1_200_000);
  assert.equal(statements.cashFlow.FINANCING, 1_000_000);
  assert.equal(statements.cashFlow.reconciliationDelta, 0);
  // A counter account the catalog has not classified is refused.
  const unclassified: FinancialAccount[] = DEFAULT_ACCOUNTS.map((account) => account.code === '52104' ? { ...account, cashFlowSection: null } : account);
  assert.throws(() => cashFlowAllocation([{ accountCode: '52104', debit: 5, credit: 0 }, { accountCode: '10000', debit: 0, credit: 5 }], unclassified), /klasifikasi arus kas/);
  assert.equal(DEFAULT_ACCOUNTS.find((account) => account.code === '20001')?.cashFlowSection, 'OPERATING');
  assert.equal(defaultCashFlowSection('HUTANG', '20009'), 'OPERATING');
  assert.equal(defaultCashFlowSection('MODAL', '30001'), 'FINANCING');
  assert.equal(defaultCashFlowSection('AKTIVA', '13009'), 'INVESTING');
});

test('journals posted before the split keep counting in the one section chosen then', () => {
  const posted = entry('legacy', '2026-09-07', { kind: 'EXPENSE', accountCode: '52104', paymentAccountCode: '11001', amount: 100 });
  const accountMap = new Map(DEFAULT_ACCOUNTS.map((account) => [account.code, account]));
  const legacy: JournalEntry = { ...posted, cashFlows: undefined, cashFlowSection: 'INVESTING' };
  assert.deepEqual(entryCashFlows(legacy, accountMap), { OPERATING: 0, INVESTING: -100, FINANCING: 0 });
  // One with no section at all counts nowhere, and the cash reconciliation shows the gap.
  const statements = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries: [{ ...legacy, cashFlowSection: null }], academicYear, monthIndex: 9 });
  assert.equal(statements.cashFlow.reconciliationDelta, 100);
});

test('the normal balance flags balances on the wrong side, contra accounts included', () => {
  const overdrawn = entry('overdrawn', '2026-09-08', { kind: 'ADVANCED', lines: [{ accountCode: '52104', debit: 50_000, credit: 0 }, { accountCode: '10000', debit: 0, credit: 50_000 }] });
  const depreciation = entry('depreciation', '2026-09-30', { kind: 'ADVANCED', lines: [{ accountCode: '54100', debit: 20_000, credit: 0 }, { accountCode: '13012', debit: 0, credit: 20_000 }] });
  const statements = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening, entries: [overdrawn, depreciation], academicYear, monthIndex: 9 });
  // KAS in credit is abnormal; accumulated depreciation in credit is its normal side.
  assert.deepEqual(statements.abnormalBalances.map((item) => [item.account.code, item.side, item.amount]), [['10000', 'CREDIT', 50_000]]);
  assert.equal(hasAbnormalBalance({ normalBalance: 'CREDIT' }, 10, 0), true);
  assert.equal(hasAbnormalBalance({ normalBalance: null }, 10, 0), false);
  assert.equal(groupNormalBalance('AKTIVA'), 'DEBIT');
  assert.equal(groupNormalBalance('AKTIVA', true), 'CREDIT');
  assert.equal(groupNormalBalance('HUTANG'), 'CREDIT');
  assert.equal(groupNormalBalance('MODAL', true), 'DEBIT');
  const row = statements.rows.find((item) => item.account.code === '10000')!;
  assert.deepEqual([row.periodDebit, row.periodCredit], [0, 50_000]);
});

test('closing a year moves the surplus into Modal and leaves next year\'s opening balance', () => {
  const entries = [
    entry('droping', '2026-09-01', { kind: 'INFLOW', accountCode: '41000', paymentAccountCode: '11001', amount: 10_000_000 }),
    entry('konsumsi', '2027-03-10', { kind: 'EXPENSE', accountCode: '52104', paymentAccountCode: '11001', amount: 1_700_000 }),
    entry('laptop', '2027-05-02', { kind: 'ADVANCED', lines: [{ accountCode: '13004', debit: 12_000_000, credit: 0 }, { accountCode: '20001', debit: 0, credit: 12_000_000 }] }),
  ];
  assert.equal(defaultSurplusAccountId(DEFAULT_ACCOUNTS), '30000');
  const closing = buildYearClosing({ accounts: DEFAULT_ACCOUNTS, opening, entries, academicYear, equityAccountId: '30000' });
  assert.equal(closing.surplus, 8_300_000);
  assert.deepEqual(closing.lines.map((line) => [line.accountCode, line.debit, line.credit]), [['41000', 10_000_000, 0], ['52104', 0, 1_700_000], ['30000', 0, 8_300_000]]);
  assert.deepEqual(closing.balances, {
    '11001': { debit: 13_300_000, credit: 0 }, '13004': { debit: 12_000_000, credit: 0 },
    '20001': { debit: 0, credit: 12_000_000 }, '30000': { debit: 0, credit: 13_300_000 },
  });
  // The carried balance is a valid opening for the next year, and its statements start where this year ended.
  const next = buildFinancialStatements({ accounts: DEFAULT_ACCOUNTS, opening: closing.balances, entries: [], academicYear: adjacentAcademicYear(academicYear, 1), monthIndex: 9 });
  assert.equal(next.trialBalance.difference, 0);
  assert.equal(next.balanceSheet.equity, 13_300_000);
  assert.equal(next.incomeStatement.income, 0);
  // A deficit is debited to Modal.
  const deficit = buildYearClosing({ accounts: DEFAULT_ACCOUNTS, opening, entries: [entries[1]], academicYear, equityAccountId: '30000' });
  assert.equal(deficit.surplus, -1_700_000);
  assert.deepEqual(deficit.lines.at(-1), { accountCode: '30000', accountNumber: '30000', accountName: 'MODAL', debit: 1_700_000, credit: 0, description: 'Defisit tahun berjalan' });
  assert.deepEqual(deficit.balances['30000'], { debit: 0, credit: 3_300_000 });
  assert.throws(() => buildYearClosing({ accounts: DEFAULT_ACCOUNTS, opening, entries, academicYear, equityAccountId: '20001' }), /Modal/);
  // Zero balances and the debit/credit split do not make two balances different.
  assert.equal(sameBalances(closing.balances, { ...closing.balances, '12001': { debit: 0, credit: 0 } }), true);
  assert.equal(sameBalances(closing.balances, { ...closing.balances, '30000': { debit: 0, credit: 13_300_001 } }), false);
});

test('year and month helpers', () => {
  assert.equal(adjacentAcademicYear('2026-2027', 1), '2027-2028');
  assert.equal(adjacentAcademicYear('2026-2027', -1), '2025-2026');
  assert.equal(lastDateOfMonth('2026-2027', 9), '2026-09-30');
  assert.equal(lastDateOfMonth('2026-2027', 2), '2027-02-28');
  assert.equal(yearInUse(null), false);
  assert.equal(yearInUse({ status: 'ACTIVE', entryCount: 0 }), false);
  assert.equal(yearInUse({ status: 'ACTIVE', entryCount: 3 }), true);
  assert.equal(yearInUse({ status: 'CLOSED', entryCount: 0 }), true);
});

test('a journal\'s receipts come from receiptPaths, or from the single receiptPath of older journals', () => {
  assert.deepEqual(entryReceiptPaths({}), []);
  assert.deepEqual(entryReceiptPaths({ receiptPath: 'a.jpg' }), ['a.jpg']);
  assert.deepEqual(entryReceiptPaths({ receiptPaths: ['a.jpg', 'b.pdf'] }), ['a.jpg', 'b.pdf']);
  assert.deepEqual(entryReceiptPaths({ receiptPath: 'old.jpg', receiptPaths: ['a.jpg', 'old.jpg'] }), ['a.jpg', 'old.jpg'], 'the list wins once it exists');
  assert.deepEqual(entryReceiptPaths({ receiptPaths: [] }), []);
});

test('accounts with decimal/float codes can be used in vouchers and statements', () => {
  const customAccounts: FinancialAccount[] = [
    ...DEFAULT_ACCOUNTS,
    {
      id: 'custom_11000_1',
      code: '11000.1',
      name: 'Bank Kepegawaian Khusus',
      type: 'AKTIVA',
      normalBalance: 'DEBIT',
      reportTarget: 'BALANCE_SHEET',
      postable: true,
      cashEquivalent: true,
      cashFlowSection: null,
    },
    {
      id: 'custom_52199_1',
      code: '52199.1',
      name: 'Beban Operasional Khusus',
      type: 'KELUAR',
      normalBalance: 'DEBIT',
      reportTarget: 'INCOME_STATEMENT',
      postable: true,
      cashEquivalent: false,
      cashFlowSection: 'OPERATING',
    },
  ];

  assert.equal(defaultCashFlowSection('AKTIVA', '11000.1'), 'OPERATING');
  assert.equal(defaultCashFlowSection('AKTIVA', '13000.1'), 'INVESTING');

  const voucher = buildVoucher({
    date: '2026-09-02',
    description: 'Biaya khusus',
    kind: 'ADVANCED',
    lines: [
      { accountCode: 'custom_52199_1', debit: 250_000, credit: 0 },
      { accountCode: 'custom_11000_1', debit: 0, credit: 250_000 },
    ],
  }, customAccounts);

  assert.equal(voucher.lines[0].accountNumber, '52199.1');
  assert.equal(voucher.lines[1].accountNumber, '11000.1');

  const journalEntry: JournalEntry = {
    id: 'entry-float-1',
    satkerId: 'puskomnet',
    academicYear,
    monthIndex: 9,
    createdBy: 'test',
    ...voucher,
  };

  const statements = buildFinancialStatements({
    accounts: customAccounts,
    opening: { custom_11000_1: { debit: 1_000_000, credit: 0 }, '30000': { debit: 0, credit: 1_000_000 } },
    entries: [journalEntry],
    academicYear,
    monthIndex: 9,
  });

  assert.equal(statements.trialBalance.difference, 0);
  assert.equal(statements.rows.find((r) => r.account.code === '11000.1')?.endingDebit, 750_000);
  assert.equal(statements.rows.find((r) => r.account.code === '52199.1')?.endingDebit, 250_000);
});
