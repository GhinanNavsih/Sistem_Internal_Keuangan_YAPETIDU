/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness loads isolated esbuild bundles. */
/* Render the real SatKer page and exercise its bookkeeping and print actions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const rootDir = path.resolve(__dirname, '..');
process.env.NODE_PATH = path.join(rootDir, 'node_modules');
require('node:module').Module._initPaths();
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost' });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
});
window.requestAnimationFrame = callback => { callback(); return 0; };
HTMLElement.prototype.scrollIntoView = () => {};
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'satker-finance-page-'));
const T = globalThis.__satkerPageTest = { writes: [], prints: [], role: 'satker_head_loyalis' };
let Page, core, app;
const stub = contents => ({ contents, loader: 'js', resolveDir: rootDir });
before(async () => {
  await build({ entryPoints: [path.join(rootDir, 'src/lib/satker-finance/core.ts')], bundle: true,
    platform: 'node', format: 'cjs', outfile: path.join(directory, 'core.cjs') });
  core = require(path.join(directory, 'core.cjs'));
  await build({ entryPoints: [path.join(rootDir, 'src/app/dashboard/satker-finance/page.tsx')],
    bundle: true, packages: 'external', platform: 'node', format: 'cjs', jsx: 'automatic',
    outfile: path.join(directory, 'page.cjs'), tsconfig: path.join(rootDir, 'tsconfig.json'),
    plugins: [{ name: 'boundaries', setup(b) {
      const mocks = {
        '@/lib/AuthContext': `const T=globalThis.__satkerPageTest; const user={getIdToken:async()=> 'test-token'};
          exports.useAuth=()=>({user,profile:{uid:'head',role:T.role}});`,
        '@/components/LogoutConfirmProvider': 'exports.useConfirmLogout=()=>()=>{};',
        '@/components/AccountSwitcher': 'module.exports=()=>null;',
        'next/image': 'module.exports=()=>null;',
        '@/components/ui/select': `const React=require('react');
          exports.Select=({items,value,onValueChange,children,disabled})=>React.createElement('select',{
            'aria-labelledby':children[0]?.props?.['aria-labelledby'],value:value||'',disabled,
            onChange:e=>onValueChange(e.target.value)},
            ...(Array.isArray(items)?items:Object.entries(items).map(([value,label])=>({value,label}))).map(i=>React.createElement('option',{key:i.value,value:i.value},i.label)));
          for(const n of ['SelectTrigger','SelectValue','SelectContent','SelectItem'])exports[n]=()=>null;`,
        '@/components/ui/search-select': `const React=require('react'); exports.SearchSelect=({options,value,onValueChange,disabled,...props})=>React.createElement('select',{'aria-label':props['aria-label'],value,disabled,onChange:e=>onValueChange(e.target.value)},React.createElement('option',{value:''},'Pilih'),...options.map(i=>React.createElement('option',{key:i.value,value:i.value},i.label)));`,
        '@/components/ui/dialog': `const React=require('react');exports.Dialog=({open,children})=>open?React.createElement('section',null,children):null;
          for(const n of ['DialogContent','DialogFooter','DialogHeader'])exports[n]=({children})=>React.createElement('div',null,children);
          exports.DialogTitle=({children})=>React.createElement('h2',null,children);exports.DialogDescription=({children})=>React.createElement('p',null,children);`,
        '@/utils/generateSatkerCashFlowPdf': `exports.generateCashFlowReportPdf=async options=>{globalThis.__satkerPageTest.prints.push(options);return {missing:0,pdf:{save:name=>globalThis.__satkerPageTest.savedPdf=name}}};`,
        '@/utils/satkerReceiptImages': 'exports.receiptPageImages=async()=>[];',
      };
      b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'test' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'test' }, args => stub(mocks[args.path]));
    }}] });
  Page = require(path.join(directory, 'page.cjs')).default;
});
after(() => { fs.rmSync(directory, { recursive: true, force: true }); dom.window.close(); });
function response(params) {
  const academicYear = params.get('academicYear');
  const monthIndex = params.get('month') === 'ANNUAL' ? 'ANNUAL' : Number(params.get('month'));
  const unit = { id: 'test-unit', name: 'Test SatKer', headName: 'Kepala Unit', adminName: '', editorUids: ['head'], revision: 1 };
  const accounts = T.accounts || core.DEFAULT_ACCOUNTS;
  const fiscalMonth = core.fiscalMonths(academicYear).find(m => m.monthIndex === (monthIndex === 'ANNUAL' ? 9 : monthIndex));
  const entry = { ...core.buildVoucher({ kind: 'EXPENSE', date: `${fiscalMonth.year}-${String(fiscalMonth.monthIndex).padStart(2, '0')}-02`, description: 'Biaya kantor', accountCode: '52101', paymentAccountCode: '10000', amount: 100 }, accounts),
    id: 'test-journal', satkerId: unit.id, academicYear, monthIndex: fiscalMonth.monthIndex, revision: 2, isBalanced: true, createdBy: 'head' };
  const openingBalances = T.openingBalances || { '10000': { debit: 1000, credit: 0 }, '30000': { debit: 0, credit: 1000 } };
  const statements = core.buildFinancialStatements({ accounts, opening: openingBalances, entries: [entry], academicYear, monthIndex });
  const signatureEmployees = [{ id: 'different-head', name: 'Ketua Pilihan', role: 'Ketua SatKer Pilihan' }, { id: 'warku', name: 'WarKu Test', role: 'Wakil Rektor Bid. Keuangan, SDM dan Umum' }];
  const cashFlowSignatures = T.signatures || { ketuaSatker: { name: 'Kepala Unit', title: 'Ketua SatKer' }, warku: { employeeId: 'warku', name: 'WarKu Test', title: signatureEmployees[1].role } };
  return { cashFlowSignatures, signatureEmployees, units: [unit], unit: params.get('unitId') === 'ALL' ? { ...unit, id: 'ALL' } : unit, accounts, academicYear,
    entries: [entry], statements, annualStatements: statements,
    // Feed legacy state too: the page must ignore it if an older response is cached.
    year: { status: 'CLOSED', revision: 4, openingSource: 'CARRIED_FORWARD', openingBalances },
    reports: [{ id: '09', monthIndex: 9, status: 'SUBMITTED', revision: 1 }],
    notifications: [{ id: 'old', title: 'Legacy approval notice' }], reportRevisions: [{ id: 'old' }],
    fixedAssets: [], reconciliations: [], events: [], monthlyTrial: [], unitSummaries: [{ unit, statements }],
  };
}
async function mount(role = 'satker_head_loyalis') {
  T.role = role; T.writes = []; T.prints = []; T.signatures = null;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') { const body = JSON.parse(options.body); T.writes.push(body); if (body.action === 'SAVE_CASH_FLOW_SIGNATURES') T.signatures = body.signatures; return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: true, json: async () => response(new URL(url, 'http://localhost').searchParams) };
  };
  app = createRoot(document.getElementById('app'));
  await act(async () => { app.render(React.createElement(Page)); });
  await settle();
}
async function settle() { for (let i = 0; i < 3; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); }
async function unmount() { if (app) await act(async () => app.unmount()); app = null; }
async function click(label) {
  const target = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label);
  assert.ok(target, `button ${label}`); assert.equal(target.disabled, false, label);
  await act(async () => target.click()); await settle();
}
async function select(label, value) {
  const target = document.querySelector(`select[aria-labelledby="${label}"]`) || document.querySelector(`select[aria-label="${label}"]`);
  assert.ok(target, `select ${label}`);
  await act(async () => { target.value = value; target.dispatchEvent(new window.Event('change', { bubbles: true })); }); await settle();
}
const noWorkflow = () => assert.doesNotMatch(document.body.textContent, /Draf|Kirim laporan|Pengajuan & persetujuan|Menunggu BAK|Minta revisi|Legacy approval notice|Penutupan tahun buku|Riwayat versi laporan/);

test('past periods expose journal and opening actions without report status or closing locks', async () => {
  try {
    await mount();
    noWorkflow();
    await select('satker-period-label', '9');
    await click('Jurnal');
    await click('Edit jurnal');
    await click('Simpan perubahan');
    assert.equal(T.writes[0].action, 'UPDATE_ENTRY');
    assert.equal(T.writes[0].expectedRevision, 2);
    assert.equal(T.writes[0].monthIndex, 9);
    await click('Akun');
    const openingInput = document.querySelector('input[aria-label="Saldo awal Debet 10000 KAS"]');
    assert.ok(openingInput); assert.equal(openingInput.disabled, false);
    await click('Simpan saldo awal');
    assert.equal(T.writes.at(-1).action, 'SAVE_OPENING');
    await select('satker-period-label', 'ANNUAL');
    await click('Ringkasan');
    noWorkflow();
  } finally { await unmount(); }
});
test('Arus Kas PDF uses the current books without digital approval', async () => {
  try {
    await mount(); await select('satker-period-label', '9'); await click('Arus Kas');
    await click('Unduh PDF Arus Kas + bukti');
    assert.equal(T.prints.length, 1);
    assert.equal(T.prints[0].unitName, 'Test SatKer');
    assert.equal(T.prints[0].openingCash, 1000);
    assert.equal(T.prints[0].signatures.ketuaSatker.name, 'Kepala Unit');
    assert.equal(T.prints[0].signatures.warku.name, 'WarKu Test');
    assert.deepEqual(Object.keys(T.prints[0].signatures).sort(), ['ketuaSatker', 'warku']);
    assert.match(T.savedPdf, /^Lap Arus Kas - TS - Sep\d{2}\.pdf$/);
    assert.equal(T.writes.length, 0);
  } finally { await unmount(); }
});
test('Arus Kas shows all accounts with non-zero debit or credit balance in page table and PDF', async () => {
  try {
    const customAccounts = core.DEFAULT_ACCOUNTS.map(a => {
      if (a.code === '11002') return { ...a, name: 'Rekening Universitas 1003253879', postable: true };
      return a;
    });
    customAccounts.push({
      id: 'custom_11003', code: '11003', name: 'Rekening Satker 7321428457', type: 'AKTIVA',
      normalBalance: 'DEBIT', reportTarget: 'BALANCE_SHEET', postable: true, cashEquivalent: true, cashFlowSection: null,
    });
    T.accounts = customAccounts;
    T.openingBalances = {
      '10000': { debit: 404_633, credit: 0 },
      '11000': { debit: 0, credit: 0 },
      '11001': { debit: 0, credit: 0 },
      '11002': { debit: 8_849_800, credit: 0 },
      'custom_11003': { debit: 3_716_650, credit: 0 },
      '30000': { debit: 0, credit: 12_971_083 },
    };
    await mount(); await select('satker-period-label', '9'); await click('Arus Kas');
    assert.match(document.body.textContent, /Rincian Saldo Kas dan Setara Kas Akhir Periode/);
    assert.match(document.body.textContent, /404\.533/);
    assert.match(document.body.textContent, /8\.849\.800/);
    assert.match(document.body.textContent, /3\.716\.650/);
    await click('Unduh PDF Arus Kas + bukti');
    assert.equal(T.prints.length, 1);
    const codes = T.prints[0].cashAccounts.map(a => a.code).sort();
    assert.deepEqual(codes, ['10000', '11002', '11003']);
    assert.equal(T.prints[0].cashAccounts.some(a => a.code === '11000' || a.code === '11001'), false);
  } finally {
    T.accounts = null; T.openingBalances = null;
    await unmount();
  }
});
test('consolidated monitoring has no submission-status columns', async () => {
  try {
    await mount('super_admin'); await select('Satuan Kerja', 'ALL');
    assert.match(document.body.textContent, /Pemantauan seluruh SatKer/);
    assert.equal([...document.querySelectorAll('th')].some(th => th.textContent === 'Status'), false);
    noWorkflow();
  } finally { await unmount(); }
});

test('Loyalis selection updates both signer fields, persists per SatKer, and reaches the PDF', async () => {
  try {
    await mount(); await select('satker-period-label', '9'); await click('Arus Kas');
    const search = document.querySelector('input[aria-label="Cari Loyalis Ketua SatKer"]');
    await act(async () => {
      search.focus();
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, 'Ketua Pilihan');
      search.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await act(async () => search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(search.getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('[role="listbox"][aria-label="Loyalis Ketua SatKer"]'), null);
    assert.equal(document.querySelector('input[aria-label="Nama penandatangan Ketua SatKer"]').value, 'Ketua Pilihan');
    assert.equal(document.querySelector('input[aria-label="Jabatan penandatangan Ketua SatKer"]').value, 'Ketua SatKer Pilihan');
    await click('Unduh PDF Arus Kas + bukti');
    assert.equal(T.prints.at(-1).signatures.ketuaSatker.employeeId, 'different-head');
    assert.equal(T.prints.at(-1).signatures.warku.employeeId, 'warku');
    await click('Simpan konfigurasi tanda tangan');
    assert.equal(T.writes.at(-1).action, 'SAVE_CASH_FLOW_SIGNATURES');
    assert.equal(T.writes.at(-1).unitId, 'test-unit');
    assert.equal(T.writes.at(-1).expectedRevision, 1);
    await select('satker-period-label', '10');
    assert.equal(document.querySelector('input[aria-label="Nama penandatangan Ketua SatKer"]').value, 'Ketua Pilihan');
    await click('Kosongkan WarKu');
    await click('Unduh PDF Arus Kas + bukti');
    assert.equal(T.prints.at(-1).signatures.warku.name, '');
    assert.equal(T.prints.at(-1).signatures.warku.title, 'Wakil Rektor Bid. Keuangan, SDM dan Umum');
  } finally { await unmount(); }
});
test('financial reviewers can print saved signers but cannot change configuration', async () => {
  try {
    await mount('rector_finance'); await select('satker-period-label', '9'); await click('Arus Kas');
    assert.equal(document.querySelector('input[aria-label="Nama penandatangan Ketua SatKer"]').disabled, true);
    assert.equal([...document.querySelectorAll('button')].some(button => button.textContent.includes('Simpan konfigurasi')), false);
    await click('Unduh PDF Arus Kas + bukti');
    assert.equal(T.writes.length, 0);
  } finally { await unmount(); }
});
