/** Actual React page lifecycle with deterministic time and isolated persistence boundaries. */
/* eslint-disable @typescript-eslint/no-require-imports -- Install the DOM before loading React DOM and the compiled page. */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const root = path.resolve(__dirname, '..');
const testingVakasi = process.argv.includes('--vakasi');
const testingRealDialog = process.argv.includes('--real-dialog');
const os = require('node:os');
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-page-test-'));
process.env.NODE_PATH = path.join(root, 'node_modules');
require('node:module').Module._initPaths();
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  ShadowRoot: dom.window.ShadowRoot,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
let now = 1792920000000;
let nextTimer = 1;
const timers = new Map();
globalThis.setTimeout = (fn, delay = 0) => {
  const id = nextTimer++;
  timers.set(id, { fn, at: now + delay });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
dom.window.setTimeout = globalThis.setTimeout;
dom.window.clearTimeout = globalThis.clearTimeout;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame = globalThis.clearTimeout;
Date.now = () => now;
const clone = (value) => structuredClone(value);
const T = (globalThis.__proposalTest = {
  profile: null,
  records: new Map(),
  listeners: new Set(),
  writes: [],
  departments: ['REKTORAT'],
  employees: [],
  period: { attendanceStatus: 'open' },
});
T.notify = () => {
  for (const listener of T.listeners)
    queueMicrotask(() =>
      listener.next({
        docs: [...T.records]
          .filter(([, record]) => record.period === listener.period)
          .map(([id, record]) => ({ id, data: () => clone(record) })),
      }),
    );
};
T.setDoc = async (ref, payload) => {
  T.writes.push({ id: ref.id, payload: clone(payload) });
  T.records.set(ref.id, { ...T.records.get(ref.id), ...clone(payload) });
  T.notify();
};
T.nextId = 0;
T.api = async (url, options) => {
  const actor = structuredClone(T.profile);
  const command = JSON.parse(options.body);
  if (command.action === 'delete') { T.deleteCalls.push(command.proposalId); if (T.deleteFailure) throw T.deleteFailure; T.records.delete(command.proposalId); T.notify(); return {proposalId:command.proposalId,status:'deleted',revision:0}; }
  T.apiOptions.push(options);
  if (T.failRequests > 0) {
    T.failRequests--;
    throw new Error('Simulated network outage');
  }
  if (T.holdRequests) {
    await new Promise((resolve, reject) => T.held.push({ resolve, reject }));
  }
  if (command.actorUid && command.actorUid !== actor.uid)
    throw new Error('Account changed; original local draft retained');
  const before = T.records.get(command.proposalId);
  if (T.enforceRevision && command.expectedRevision !== Number(before?.revision || 0)) {
    throw new Error('Proposal sudah diperbarui di sesi lain. Draft lokal tetap disimpan; buka versi terbaru sebelum melanjutkan.');
  }
  const owner = before?.submittedBy || actor.uid;
  const status =
    command.action === 'review'
      ? command.decision
      : command.action === 'submit_proposal'
        ? 'proposal_submitted'
        : command.action === 'submit_lpj'
          ? 'lpj_submitted'
          : command.action === 'save_lpj'
            ? 'lpj_draft'
            : before?.status || 'proposal_draft';
  const revision = (before?.revision || 0) + 1;
  T.records.set(command.proposalId, {
    ...before,
    ...(command.action === 'review' ? {} : command.data),
    period: command.period,
    status,
    revision,
    submittedBy: owner,
    submittedByName: before?.submittedByName || actor.displayName,
    creatorRole: before?.creatorRole || actor.role,
    createdAt: before?.createdAt || { seconds: Math.floor(Date.now() / 1000) },
    updatedAt: { seconds: Math.floor(Date.now() / 1000) },
  });
  T.notify();
  return { proposalId: command.proposalId, status, revision };
};
const head = {
  uid: 'head-fixture',
  role: 'satker_head_loyalis',
  displayName: 'Kepala Fixture',
  email: 'head@example.test',
};
const admin = {
  uid: 'admin-fixture',
  role: 'super_admin',
  displayName: 'Admin Fixture',
  email: 'admin@example.test',
};
const fixture = () => ({
  reportName: 'Saved event fixture',
  departmentUnit: 'REKTORAT',
  period: '2026-10',
  status: 'proposal_submitted',
  submittedBy: head.uid,
  submittedByName: head.displayName,
  submittedByEmail: null,
  pemasukanRows: [{ uraian: 'Pemasukan', rincianQty: '1', rincianRate: 1000 }],
  pengeluaranRows: [
    { rowId: 'header', type: 'group_header', uraian: 'Biaya', rincianQty: '', rincianRate: 0 },
  ],
  updatedAt: { seconds: Math.floor(now / 1000) },
});
const mocks = {
  'next/navigation': `exports.useSearchParams=()=>new URLSearchParams(globalThis.__proposalTest.params||'month=10&year=2026');`,
  'next/image': `exports.default=()=>null;`,
  '@/lib/AuthContext': `exports.useAuth=()=>({profile:globalThis.__proposalTest.profile});`,
  '@/lib/firebase': `exports.db={};`,
  '@/lib/queries/hooks': `const T=globalThis.__proposalTest; exports.useDepartments=()=>({data:T.departments}); exports.useEmployeesLoyalis=()=>({data:T.employees,isLoading:false,isError:false}); exports.useEmployeesBlueCollar=()=>({data:[],isLoading:false,isError:false}); exports.usePayrollPeriod=()=>({data:T.period}); exports.useKegiatanHistoricalBaselines=()=>({data:[],isLoading:false});`,
  '@/components/payroll/ReferralFinancePanel': `exports.default=()=>null;`,
  'firebase/firestore': `const T=globalThis.__proposalTest; exports.collection=(_,name)=>({name}); exports.doc=(_,name,id)=>({name,id}); exports.where=(...args)=>args; exports.query=(...args)=>args; exports.serverTimestamp=()=>({seconds:Math.floor(Date.now()/1000)}); exports.onSnapshot=(query,next)=>{const l={next,period:query[1][2]};T.listeners.add(l);T.notify();return()=>T.listeners.delete(l)}; exports.setDoc=T.setDoc; exports.deleteDoc=async(ref)=>{T.deleteCalls.push(ref.id);if(T.deleteFailure)throw T.deleteFailure;T.records.delete(ref.id);T.notify()};`,
  '@/lib/payroll/client': `exports.authenticatedJson=(url,options)=>globalThis.__proposalTest.api(url,options);exports.createFinancialRequestId=(prefix)=>prefix+'_'+Date.now()+'_'+(++globalThis.__proposalTest.nextId);`,
  '@/utils/generateProposalKegiatanPdf': `exports.generateProposalKegiatanPdf=()=>{};`,
  '@/utils/generateLpjPdf': `exports.generateLpjPdf=async()=>{};`,
  '@/utils/generateLpjExpenseReportPdf': `exports.generateLpjExpenseReportPdf=async()=>{};`,
  '@/lib/uploads': `exports.uploadProofFile=async(endpoint,file,fields)=>{globalThis.__proposalTest.receiptUploads.push({endpoint,file,fields});return 'https://receipt.test/uploaded.jpg'};`,
  '@/lib/payroll/expenseReportReceipt': `exports.prepareExpenseReportReceipt=async(file)=>{globalThis.__proposalTest.receiptInputs.push(file);return new File([new Uint8Array([255,216,255,217])],'processed-receipt.jpg',{type:'image/jpeg'})};`,
  '@/utils/ocrParser': `exports.renderFileToCanvas=async()=>{throw new Error('Unexpected receipt rendering in page test')};`,
};
const ui = `const React=require('react'); const element=(tag)=>(props)=>{const {children,variant,size,asChild,render,showCloseButton,initialFocus,...rest}=props;return React.createElement(tag,rest,children)}; exports.Button=element('button');exports.Input=element('input');exports.Card=element('div');exports.FloatingSnackbar=()=>null;exports.ConfirmDialog=({open,title,confirmLabel,cancelLabel='Kembali',onConfirm,onOpenChange,finalFocus})=>{React.useEffect(()=>{if(!open&&typeof finalFocus==='function'){const target=finalFocus();if(target&&typeof target.focus==='function')target.focus();}},[open]);return open?React.createElement('div',{role:'dialog'},React.createElement('h3',{},title),React.createElement('button',{onClick:()=>onOpenChange(false)},cancelLabel),React.createElement('button',{onClick:onConfirm},confirmLabel)):null};exports.Dialog=({open,children})=>open?React.createElement('div',{role:'dialog'},children):null;exports.DialogContent=element('div');exports.DialogHeader=element('div');exports.DialogTitle=element('h3');exports.Select=({value,onValueChange,disabled})=>React.createElement('select',{'data-testid':'department',value,disabled,onChange:e=>onValueChange(e.target.value)},React.createElement('option',{value:''},'Pilih'),React.createElement('option',{value:'REKTORAT'},'REKTORAT'));exports.SelectTrigger=()=>null;exports.SelectContent=()=>null;exports.SelectItem=()=>null;exports.SelectValue=()=>null;`;
async function bundle() {
  const currentPage = testingVakasi ? 'src/app/dashboard/payroll/uraian/vakasi-karyawan/page.tsx' : 'src/app/dashboard/payroll/uraian/kegiatan-satker/page.tsx';
  const legacyPage = 'src/app/dashboard/payroll/uraian/proposal-kegiatan/page.tsx';
  const pagePath = path.join(root, currentPage);
  let revisionPage = currentPage;
  if (process.env.PROPOSAL_TEST_REVISION) {
    try {
      childProcess.execFileSync('git', ['cat-file', '-e', `${process.env.PROPOSAL_TEST_REVISION}:${currentPage}`], { cwd: root, stdio: 'ignore' });
    } catch {
      revisionPage = legacyPage;
    }
  }
  const source = process.env.PROPOSAL_TEST_REVISION
    ? childProcess.execFileSync(
        'git',
        [
          'show',
          `${process.env.PROPOSAL_TEST_REVISION}:${revisionPage}`,
        ],
        { cwd: root, encoding: 'utf8' },
      )
    : fs.readFileSync(pagePath, 'utf8');
  await build({
    stdin: {
      contents: source,
      resolveDir: path.dirname(pagePath),
      sourcefile: pagePath,
      loader: 'tsx',
    },
    absWorkingDir: root,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    outfile: path.join(buildDir, 'page.cjs'),
    tsconfig: path.join(root, 'tsconfig.json'),
    plugins: [
      {
        name: 'boundaries',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (Object.hasOwn(mocks, args.path)) return { path: args.path, namespace: 'mock' };
            if (testingRealDialog && ['@/components/ui/dialog', '@/components/ui/confirm-dialog'].includes(args.path)) return;
            if (args.path.startsWith('@/components/ui/'))
              return { path: args.path, namespace: 'ui' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
            contents: 'exports.__esModule=true;' + mocks[args.path],
            loader: 'js',
            resolveDir: root,
          }));
          builder.onLoad({ filter: /.*/, namespace: 'ui' }, () => ({
            contents: ui,
            loader: 'js',
            resolveDir: root,
          }));
        },
      },
    ],
  });
  return require(path.join(buildDir, 'page.cjs')).default;
}
let app;
let Page;
async function mount(profile) {
  T.profile = profile;
  app = createRoot(document.getElementById('app'));
  await act(async () => app.render(React.createElement(Page)));
}
async function unmount() {
  await act(async () => app.unmount());
  document.getElementById('app').replaceChildren();
}
async function advance(ms) {
  const until = now + ms;
  while (true) {
    const candidate = [...timers]
      .filter(([, t]) => t.at <= until)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!candidate) break;
    now = candidate[1].at;
    timers.delete(candidate[0]);
    await act(async () => {
      await candidate[1].fn();
    });
  }
  now = until;
  await act(async () => {});
}
async function confirmEditIfNeeded() {
  if (T.autoConfirmEdits === false) return;
  const confirm = [...document.querySelectorAll('button')].find(button => button.textContent === 'Ya, ubah nilai');
  if (confirm) await act(async () => confirm.click());
}
async function fillName(name) {
  const input = document.querySelector('input[placeholder="Contoh: Reuni SainTek 2026"]');
  assert.ok(input, 'name field');
  await act(async () => input.click());
  await confirmEditIfNeeded();
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(
      input,
      name,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(input.value, name);
}
async function chooseDepartment() {
  const select = document.querySelector('[data-testid="department"]');
  await act(async () => select.click());
  await confirmEditIfNeeded();
  await act(async () => {
    select.value = 'REKTORAT';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function clickText(text) {
  const target = [...document.querySelectorAll('button,p,span')].find(
    (el) => el.textContent.trim() === text,
  );
  assert.ok(target, `missing control: ${text}`);
  await act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await confirmEditIfNeeded();
}
async function reset() {
  if (app) {
    try {
      await unmount();
    } catch {}
  }
  timers.clear();
  T.records.clear();
  T.listeners.clear();
  T.writes = [];
  T.params = 'month=10&year=2026';
  T.apiOptions = [];
  T.autoConfirmEdits = true;
  T.failRequests = 0;
  T.enforceRevision = false;
  T.deleteCalls = [];
  T.deleteFailure = null;
  T.receiptInputs = [];
  T.receiptUploads = [];
  T.holdRequests = false;
  T.held = [];
  app = null;
  localStorage.clear();
}
const tests = [
  ...['mouse', 'touch', 'pen'].map(pointerType => [`release: opening pointer gesture (${pointerType}) cannot dismiss the confirmation`, async () => {
    T.autoConfirmEdits = false;
    T.records.set('saved-event', { ...fixture(), revision: 1, creatorRole: 'satker_head_loyalis' });
    await mount(admin);
    await clickText('Saved event fixture');
    const input = document.querySelector('input[placeholder="Contoh: Reuni SainTek 2026"]');
    const pointer = (type, target) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type.endsWith('down') ? 1 : 0, detail: type === 'click' ? 1 : 0, clientX: 20, clientY: 20 });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType }, isPrimary: { value: true } });
      target.dispatchEvent(event);
    };
    await act(async () => pointer('pointerdown', input));
    assert.ok(document.body.textContent.includes('Ubah data kegiatan?'), 'pointerdown opens confirmation');
    const releaseTarget = document.querySelector('[data-slot="dialog-overlay"]') || input;
    await act(async () => pointer('pointerup', releaseTarget));
    await act(async () => pointer('mouseup', releaseTarget));
    await act(async () => pointer('click', releaseTarget));
    await advance(500);
    const dialog = document.querySelector(testingRealDialog ? '[role="dialog"][data-open]' : '[role="dialog"]');
    assert.ok(dialog?.textContent.includes('Ubah data kegiatan?'), 'confirmation disappeared before the user answered');
    assert.equal(T.apiOptions.length, 0, 'opening gesture must never save');
    assert.equal(input.value, 'Saved event fixture', 'opening gesture must never edit');
    if (testingRealDialog) {
      await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      await advance(500);
      assert.equal(document.querySelector('[role="dialog"][data-open]'), null, 'Escape still cancels the confirmation');
      assert.equal(T.apiOptions.length, 0, 'Escape cancellation must never save');
    }
  }]),
  ['release: a report edit cannot adopt a newer revision before its autosave', async () => {
    const rows = [{ rowId: 'group', type: 'group_header', uraian: 'Honor', rincianQty: '', rincianRate: 0, reportId: 'report-pay' }, { rowId: 'item', type: 'item', uraian: 'Honor satu', rincianQty: '1', rincianRate: 1000, realisasi: 1000 }];
    const report = { id: 'report-pay', expenseRowId: 'group', expenseLabel: 'Honor', title: 'Original report', mode: 'expense', rows: [{ id: 'detail', parentRowId: 'item', uraian: 'Honor satu', rincianQty: '1', rincianRate: 1000, realisasi: 1000, employeeId: '', employeeName: '' }], receipts: {}, source: 'custom' };
    T.records.set('saved-event', { ...fixture(), status: 'lpj_draft', revision: 1, creatorRole: 'satker_head_loyalis', lpjPengeluaranRows: rows, expenseReports: [report] });
    T.enforceRevision = true;
    await mount(admin);
    await clickText('Saved event fixture');
    await clickText('Buka Laporan');
    await advance(0);
    const input = document.querySelector('input[placeholder="Contoh: Laporan Pembayaran Tim Pelaksana"]');
    await act(async () => input.click());
    await confirmEditIfNeeded();
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Unsaved modal title');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { T.records.set('saved-event', { ...T.records.get('saved-event'), revision: 2, reportName: 'Head latest event title' }); T.notify(); });
    await advance(1500);
    assert.equal(T.records.get('saved-event').expenseReports[0].title, 'Original report');
    assert.ok(document.body.textContent.includes('Proposal sudah diperbarui di sesi lain'));
  }],
  ['vakasi release: deep links show managed LPJ payments without editable controls', async () => {
    T.params += '&eventId=LPJ_PAYROLL_fixture';
    T.records.set('LPJ_PAYROLL_fixture', { period: '2026-10', sourceKind: 'proposal_lpj_payroll', sourceProposalId: 'source-event', eventName: 'LPJ Payroll fixture', submittedBy: head.uid, status: 'approved', totalPayout: 150_000, eventWorkers: { e1: { employeeName: 'Pegawai LPJ', payGiven: 150_000, employeeCollection: 'Employees_Loyalis' } } });
    T.records.set('sandbox', { period: '2026-10', sourceKind: 'proposal_lpj_report', eventName: 'Legacy sandbox fixture', status: 'approved' });
    await mount(head);
    assert.ok(document.body.textContent.includes('Pegawai LPJ'));
    assert.equal(document.body.textContent.includes('Legacy sandbox fixture'), false);
    const link = [...document.querySelectorAll('a')].find(anchor => anchor.textContent.includes('Buka LPJ Kegiatan SatKer'));
    assert.ok(link.href.endsWith('/dashboard/payroll/uraian/kegiatan-satker?month=10&year=2026&proposalId=source-event'));
    assert.equal([...document.querySelectorAll('button')].some(button => ['Simpan Event', 'Batalkan Persetujuan'].includes(button.textContent.trim())), false);
    await advance(2000);
    assert.equal(T.apiOptions.length, 0);
  }],
  ['release: approved employee report links to its generated Vakasi entry', async () => {
    T.records.set('saved-event', { ...fixture(), status: 'lpj_approved', payrollReportIdsByReport: { 'report-pay': 'LPJ_PAYROLL_fixture' },
      lpjPengeluaranRows: [{ rowId: 'group', type: 'group_header', uraian: 'Honor', rincianQty: '', rincianRate: 0, reportId: 'report-pay' }],
      expenseReports: [{ id: 'report-pay', expenseRowId: 'group', expenseLabel: 'Honor', title: 'Pembayaran tim', mode: 'employee', rows: [{ id: 'one', uraian: 'Honor', employeeId: 'e1', employeeName: 'Pegawai', rincianQty: '1', rincianRate: 100000, realisasi: 100000 }], receipts: {}, source: 'custom' }] });
    await mount(head);
    await clickText('Saved event fixture');
    await clickText('Buka Laporan');
    await advance(0);
    const link = [...document.querySelectorAll('a')].find(anchor => anchor.textContent === 'Buka di Vakasi Karyawan');
    assert.ok(link.href.endsWith('/dashboard/payroll/uraian/vakasi-karyawan?month=10&year=2026&eventId=LPJ_PAYROLL_fixture'));
    assert.equal(document.body.textContent.includes('Sandbox'), false);
  }],
  ['release: selectors, signatures and mutation buttons share the confirmation guard', async () => {
    T.autoConfirmEdits = false;
    T.records.set('saved-event', { ...fixture(), creatorRole: 'satker_head_loyalis' });
    await mount(admin);
    await clickText('Saved event fixture');
    const department = document.querySelector('[data-testid="department"]');
    await act(async () => department.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true })));
    assert.ok(document.body.textContent.includes('Ubah data kegiatan?'));
    await clickText('Kembali');
    const signature = document.querySelector('input[role="combobox"]');
    await act(async () => signature.focus());
    assert.ok(document.body.textContent.includes('Ubah data kegiatan?'));
    await clickText('Kembali');
    await clickText('Simpan Laporan');
    assert.ok(document.body.textContent.includes('Ubah data kegiatan?'));
    await clickText('Kembali');
    assert.equal(T.apiOptions.length, 0);
  }],
  ['release: a recovered local draft retains its first creation time', async () => {
    T.failRequests = 3;
    await mount(head);
    await fillName('First local value');
    await advance(700);
    const key = 'proposal_kegiatan_drafts_v1_head-fixture_2026-10';
    const first = JSON.parse(localStorage.getItem(key))[0].createdAt;
    assert.ok(first > 0);
    await fillName('Later local value');
    await advance(700);
    assert.equal(JSON.parse(localStorage.getItem(key))[0].createdAt, first);
    await unmount();
    T.failRequests = 2;
    await mount(head);
    assert.equal(JSON.parse(localStorage.getItem(key))[0].createdAt, first);
  }],
  ['release: confirmation cancels safely and expires when focus leaves', async () => {
    T.autoConfirmEdits = false;
    T.records.set('saved-event', { ...fixture(), revision: 1, creatorRole: 'satker_head_loyalis' });
    await mount(admin);
    await clickText('Saved event fixture');
    const input = document.querySelector('input[placeholder="Contoh: Reuni SainTek 2026"]');
    await act(async () => input.focus());
    assert.ok(document.body.textContent.includes('Ubah data kegiatan?'));
    await clickText('Kembali');
    await advance(1500);
    assert.equal(T.apiOptions.length, 0);
    assert.equal(input.value, 'Saved event fixture');
    await act(async () => input.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await clickText('Ya, ubah nilai');
    await fillName('Confirmed value');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await advance(1000);
    assert.equal(T.records.get('saved-event').reportName, 'Confirmed value');
    await act(async () => input.blur());
    await act(async () => input.focus());
    assert.ok(document.body.textContent.includes('Ubah data kegiatan?'), 'returning to a field requires confirmation again');
    await clickText('Kembali');
  }],
  ['release: readonly viewing and modal closing never save', async () => {
    const rows = [{ rowId: 'group', type: 'group_header', uraian: 'Pembayaran', rincianQty: '', rincianRate: 0, reportId: 'report-pay' }];
    T.records.set('saved-event', { ...fixture(), status: 'lpj_draft', revision: 1, creatorRole: 'satker_head_loyalis', lpjPengeluaranRows: rows,
      expenseReports: [{ id: 'report-pay', expenseRowId: 'group', expenseLabel: 'Pembayaran', title: 'Pembayaran tim', mode: 'employee', rows: [], receipts: {}, source: 'custom' }] });
    T.autoConfirmEdits = false;
    await mount(admin);
    await clickText('Saved event fixture');
    await clickText('Buka Laporan');
    await advance(2000);
    assert.equal(T.apiOptions.length, 0, 'opening a report must not write');
    assert.equal(document.body.textContent.includes('Ubah data kegiatan?'), false, 'opening a report must not autofocus an editable field');
    const title = document.querySelector('input[placeholder="Contoh: Laporan Pembayaran Tim Pelaksana"]');
    await act(async () => title.focus());
    assert.ok(document.body.textContent.includes('Ubah data kegiatan?'), 'modal fields share the guard');
    await clickText('Kembali');
    await clickText('Tutup');
    await advance(2000);
    assert.equal(T.apiOptions.length, 0, 'cancelling and closing a report must not write');
  }],
  ['release: dirty form keeps its revision when another editor saves', async () => {
    T.enforceRevision = true;
    T.records.set('saved-event', { ...fixture(), revision: 1 });
    await mount(admin);
    await clickText('Saved event fixture');
    await fillName('Unsaved admin value');
    await act(async () => { T.records.set('saved-event', { ...T.records.get('saved-event'), revision: 2, reportName: 'Head latest value' }); T.notify(); });
    await advance(1000);
    assert.equal(T.records.get('saved-event').reportName, 'Head latest value');
    assert.equal(document.querySelector('input[placeholder="Contoh: Reuni SainTek 2026"]').value, 'Unsaved admin value');
    assert.ok(document.body.textContent.includes('Proposal sudah diperbarui di sesi lain'));
  }],
  ['release: linked event opens once and admin-created events edit freely', async () => {
    T.params += '&proposalId=admin-event';
    T.records.set('admin-event', { ...fixture(), submittedBy: admin.uid, creatorRole: 'super_admin', revision: 1 });
    T.autoConfirmEdits = false;
    await mount(admin);
    assert.equal(document.querySelector('input[placeholder="Contoh: Reuni SainTek 2026"]').value, 'Saved event fixture');
    await fillName('Admin own value');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await advance(1000);
    assert.equal(T.records.get('admin-event').reportName, 'Admin own value');
  }],
  ['release: creation order ignores edits', async () => {
    T.records.set('older', { ...fixture(), reportName: 'Older creation', createdAt: { seconds: 100 }, updatedAt: { seconds: 300 } });
    T.records.set('newer', { ...fixture(), reportName: 'Newer creation', createdAt: { seconds: 200 }, updatedAt: { seconds: 200 } });
    await mount(admin);
    const titles = () => [...document.querySelectorAll('p')].map(x => x.textContent).filter(x => ['Older creation', 'Newer creation'].includes(x));
    assert.deepEqual(titles(), ['Newer creation', 'Older creation']);
    await act(async () => { T.records.get('older').updatedAt.seconds = 999; T.notify(); });
    assert.deepEqual(titles(), ['Newer creation', 'Older creation']);
  }],
  ['release: clean form refreshes without overwriting another editor', async () => {
    T.enforceRevision = true;
    T.records.set('saved-event', { ...fixture(), revision: 1 });
    await mount(admin);
    await clickText('Saved event fixture');
    await act(async () => {
      T.records.set('saved-event', { ...T.records.get('saved-event'), revision: 2, pemasukanRows: [{ uraian: 'Head latest income', rincianQty: '1', rincianRate: 9999 }] });
      T.notify();
    });
    await fillName('Admin title change');
    await advance(1500);
    assert.equal(T.records.get('saved-event').pemasukanRows[0].rincianRate, 9999);
  }],
  ['release: head-owned fields require confirmation before editing', async () => {
    T.records.set('saved-event', { ...fixture(), revision: 1, creatorRole: 'satker_head_loyalis' });
    await mount(admin);
    await clickText('Saved event fixture');
    const input = document.querySelector('input[placeholder="Contoh: Reuni SainTek 2026"]');
    await act(async () => input.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.ok(document.querySelector('[role="dialog"]'), 'a head-owned field needs confirmation');
    assert.equal(T.apiOptions.length, 0, 'viewing must not save');
  }],
  [
    'non-pegawai receipt upload accepts the shared formats and processes large untyped files before uploading',
    async () => {
      const rows = [
        { rowId: 'group', type: 'group_header', uraian: 'Konsumsi', rincianQty: '', rincianRate: 0, reportId: 'receipt-report' },
        { rowId: 'item', type: 'item', uraian: 'Konsumsi rapat', rincianQty: '1', rincianRate: 1000, realisasi: 1000 },
      ];
      T.records.set('saved-event', { ...fixture(), status: 'lpj_draft', pengeluaranRows: rows, lpjPengeluaranRows: rows,
        expenseReports: [{ id: 'receipt-report', expenseRowId: 'group', expenseLabel: 'Konsumsi', title: 'Bukti Konsumsi', mode: 'expense', source: 'custom', notes: '', receipts: {},
          rows: [{ id: 'detail', parentRowId: 'item', uraian: 'Konsumsi rapat', rincianQty: '1', rincianRate: 1000, realisasi: 1000, employeeId: '', employeeName: '', note: '' }],
        }],
      });
      await mount(admin);
      await clickText('Saved event fixture');
      await clickText('Buka Laporan');
      await advance(0);
      const input = document.querySelector('[role=dialog] input[type=file]');
      assert.ok(input);
      for (const extension of ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tiff', '.pdf']) {
        assert.ok(input.accept.includes(extension), `${extension} must be selectable`);
      }
      const original = new File([new Uint8Array(26 * 1024 * 1024)], 'iphone.heic', { type: '' });
      await act(async () => input.click());
      await confirmEditIfNeeded();
      Object.defineProperty(input, 'files', { value: [original], configurable: true });
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
      assert.equal(T.receiptInputs[0], original, 'file size and missing MIME must not block compression');
      assert.equal(T.receiptUploads.length, 1);
      assert.equal(T.receiptUploads[0].file.name, 'processed-receipt.jpg');
      assert.ok(T.receiptUploads[0].file.size <= 1024 * 1024, 'only the processed receipt should be uploaded');
      await advance(1000);
      const receipt = T.records.get('saved-event').expenseReports[0].receipts.item;
      assert.equal(receipt.url, 'https://receipt.test/uploaded.jpg');
      assert.equal(receipt.fileName, 'processed-receipt.jpg');
    },
  ],
  [
    'deleting a saved event with no local edits reaches Firestore',
    async () => {
      T.records.set('saved-event', fixture());
      await mount(admin);
      await clickText('Saved event fixture');
      await clickText('Hapus Laporan');
      await clickText('Hapus');
      assert.deepEqual(T.deleteCalls, ['saved-event']);
      assert.equal(T.records.has('saved-event'), false);
    },
  ],
  [
    'deleting a stale local draft discards it without saving first',
    async () => {
      const record = { ...fixture(), status: 'proposal_draft', revision: 0 };
      T.records.set('saved-event', record);
      T.enforceRevision = true;
      await mount(admin);
      await clickText('Saved event fixture');
      await fillName('Unsaved local edit');
      await act(async () => {
        T.records.set('saved-event', { ...record, revision: 1 });
        T.notify();
      });
      await clickText('Hapus Laporan');
      await clickText('Hapus');
      assert.equal(T.records.has('saved-event'), false, 'a stale draft must not block confirmed deletion');
      assert.equal(T.apiOptions.length, 0, 'confirmed deletion must not save edits that are being discarded');
      assert.ok(document.body.textContent.includes('Proposal berhasil dihapus'));
      await advance(1000);
      await unmount();
      await mount(admin);
      assert.equal(T.records.has('saved-event'), false, 'discarded autosave must not recreate the deleted event');
      assert.equal(localStorage.getItem('proposal_kegiatan_drafts_v1_admin-fixture_2026-10'), '[]');
    },
  ],
  ...[false, true].map((conflict) => [
    `deleting waits for an in-flight ${conflict ? 'conflicting' : 'successful'} save and discards later edits`,
    async () => {
      const record = { ...fixture(), status: 'proposal_draft', revision: 0 };
      T.records.set('saved-event', record);
      T.enforceRevision = true;
      T.holdRequests = true;
      await mount(admin);
      await clickText('Saved event fixture');
      await fillName('Already in flight');
      await advance(600);
      assert.equal(T.held.length, 1);
      await fillName('Queued edit to discard');
      if (conflict) {
        await act(async () => {
          T.records.set('saved-event', { ...record, revision: 1 });
          T.notify();
        });
      }
      await clickText('Hapus Laporan');
      await clickText('Hapus');
      const deletesBeforeRelease = T.deleteCalls.length;
      await act(async () => {
        T.holdRequests = false;
        T.held.shift().resolve();
      });
      assert.equal(deletesBeforeRelease, 0, 'remote delete must wait so an older save cannot recreate the event');
      assert.equal(T.records.has('saved-event'), false, 'a completed save must not block the confirmed deletion');
      assert.equal(T.apiOptions.length, 1, 'queued edits must not start another save while deleting');
      await advance(1000);
      assert.equal(T.records.has('saved-event'), false);
    },
  ]),
  [
    'deleting failure retains the unsaved draft for retry',
    async () => {
      T.records.set('saved-event', { ...fixture(), status: 'proposal_draft' });
      await mount(admin);
      await clickText('Saved event fixture');
      await fillName('Keep this local draft');
      T.deleteFailure = Object.assign(new Error('Deletion denied'), { code: 'permission-denied' });
      await clickText('Hapus Laporan');
      await clickText('Hapus');
      assert.ok(document.body.textContent.includes('Proposal gagal dihapus'));
      assert.equal(T.records.get('saved-event').reportName, 'Saved event fixture', 'failed deletion must not force a draft save');
      const local = JSON.parse(localStorage.getItem('proposal_kegiatan_drafts_v1_admin-fixture_2026-10'));
      assert.equal(local.find((draft) => draft.id === 'saved-event')?.data.reportName, 'Keep this local draft');
      await clickText('Tutup');
      T.deleteFailure = null;
      await clickText('Hapus Laporan');
      await clickText('Hapus');
      assert.equal(T.records.has('saved-event'), false);
      assert.equal(localStorage.getItem('proposal_kegiatan_drafts_v1_admin-fixture_2026-10'), '[]');
    },
  ],
  ...[
    ['report save preserves 30 Botol x 2 sesi and its Rp180000 budget', true, '30 Botol x 2 sesi', 180000],
    ['single report item preserves a multiplied quantity on save', false, '30 Botol x 2 sesi', 180000],
    ['single report item preserves a quantity with one session', false, '30 Botol x 1 sesi', 90000],
    ['single report item preserves a quantity with three sessions', false, '30 Botol x 3 sesi', 270000],
    ['report save previews and applies an edited multiplied quantity once', false, '30 Botol x 2 sesi', 180000, '40 Botol x 2 sesi', 240000],
  ].map(([name, includeRice, sourceQty, sourceAmount, editedQty, editedAmount]) => [
    name,
    async () => {
      const record = fixture();
      const rows = [
        { rowId: 'consumption', type: 'group_header', uraian: 'Konsumsi Seminar', rincianQty: '', rincianRate: 0, reportId: 'consumption-report' },
        ...(includeRice ? [{ rowId: 'rice', type: 'item', uraian: 'Nasi kotak', rincianQty: '30 Nasi x 1 sesi', rincianRate: 16000, realisasi: 480000 }] : []),
        { rowId: 'water', type: 'item', uraian: 'SahDu Botol 600ml', rincianQty: sourceQty, rincianRate: 3000, realisasi: sourceAmount },
      ];
      record.status = 'lpj_draft';
      record.pengeluaranRows = clone(rows);
      record.lpjPengeluaranRows = clone(rows);
      record.expenseReports = [{
        id: 'consumption-report', expenseRowId: 'consumption', expenseLabel: 'Konsumsi Seminar',
        title: 'Laporan Konsumsi Seminar', mode: 'expense', notes: '', source: 'custom',
        receipts: {},
        rows: rows.slice(1).map((row) => ({
          id: `detail-${row.rowId}`, parentRowId: row.rowId, parentUraian: row.uraian,
          uraian: row.uraian, rincianQty: row.rincianQty, rincianRate: row.rincianRate,
          realisasi: row.realisasi, employeeId: '', employeeName: '', note: '',
        })),
      }];
      T.records.set('saved-event', record);
      await mount(admin);
      await clickText('Saved event fixture');
      await clickText('Buka Laporan');
      await advance(0);
      assert.ok(document.body.textContent.includes('Hubungkan Header Grup ke Laporan'));
      assert.ok([...document.querySelector('[role=dialog]').querySelectorAll('input')].some((input) => input.value === sourceQty), 'modal detail preserves the original quantity');
      await advance(400);
      assert.ok([...document.querySelectorAll('input')].some((input) => input.value === sourceQty), 'modal autosave preserves the original quantity');
      if (editedQty) {
        const input = [...document.querySelector('[role=dialog]').querySelectorAll('input')].find((input) => input.value === sourceQty);
        await act(async () => input.click());
        await confirmEditIfNeeded();
        await act(async () => {
          Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, editedQty);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }
      await clickText('Simpan & Selesai');
      if (editedQty) {
        const confirmation = [...document.querySelectorAll('[role=dialog]')].at(-1);
        assert.ok(confirmation.textContent.includes('Konfirmasi Perubahan Nilai SPJ'));
        assert.ok(confirmation.textContent.includes(`${sourceQty} → ${editedQty}`), 'confirmation must show the same expression that will be saved');
        await clickText('Konfirmasi & Simpan');
      }
      assert.equal(document.querySelectorAll('[role=dialog]').length, 0, 'unchanged report must save without confirmation');
      const expectedQty = editedQty || sourceQty;
      const expectedAmount = editedAmount || sourceAmount;
      const qty = [...document.querySelectorAll('input')].find((input) => input.value.includes('Botol x'))?.value;
      assert.equal(qty, expectedQty, 'saving a report must not multiply the LPJ quantity again');
      await advance(1000);
      const saved = T.records.get('saved-event');
      const water = saved.lpjPengeluaranRows.find((row) => row.rowId === 'water');
      assert.equal(water.rincianQty, expectedQty);
      assert.equal(water.realisasi, expectedAmount);
      assert.equal(saved.pengeluaranRows.find((row) => row.rowId === 'water').rincianQty, sourceQty);
      await clickText('Buka Laporan');
      await advance(0);
      await clickText('Simpan & Selesai');
      assert.equal(document.querySelectorAll('[role=dialog]').length, 0, 'saving the same report again must not require confirmation');
      await advance(1000);
      assert.equal(T.records.get('saved-event').lpjPengeluaranRows.find((row) => row.rowId === 'water').rincianQty, expectedQty);
    },
  ]),
  [
    'switching accounts during a pending first save cannot transfer the new event',
    async () => {
      await mount(head);
      await fillName('Pending original account event');
      await chooseDepartment();
      T.profile = { ...head, uid: 'next-account' };
      await act(async () => app.render(React.createElement(Page)));
      assert.equal(
        [...T.records.values()].some(
          (record) =>
            record.reportName === 'Pending original account event' &&
            record.submittedBy !== head.uid,
        ),
        false,
        'a departed page saved its first event under the newly signed-in account',
      );
      T.profile = head;
      await act(async () => app.render(React.createElement(Page)));
      await advance(1000);
      assert.ok(
        [...T.records.values()].some(
          (record) =>
            record.reportName === 'Pending original account event' &&
            record.submittedBy === head.uid,
        ),
      );
    },
  ],

  [
    'a conflicting local draft can be saved as a copy before loading the server version',
    async () => {
      const record = fixture();
      record.status = 'proposal_draft';
      T.records.set('saved-event', record);
      await mount(head);
      await clickText('Saved event fixture');
      T.failRequests = 1;
      await fillName('Locally edited event');
      await advance(700);
      assert.ok(document.querySelector('[role=alert]'));
      await clickText('Simpan salinan & buka versi terbaru');
      await advance(1000);
      assert.equal(T.records.get('saved-event').reportName, 'Saved event fixture');
      assert.ok(
        [...T.records.values()].some(
          (record) => record.reportName === 'Locally edited event (Salinan draft)',
        ),
      );
      assert.equal(
        document.querySelector('input[placeholder="Contoh: Reuni SainTek 2026"]').value,
        'Saved event fixture',
      );
    },
  ],
  [
    'large LPJ drafts do not exceed the browser keepalive body limit',
    async () => {
      const record = fixture();
      record.status = 'proposal_draft';
      record.receiptRows = [{ itemName: 'x'.repeat(70000), qty: 1, unitPrice: 1 }];
      T.records.set('saved-event', record);
      await mount(head);
      await clickText('Saved event fixture');
      await fillName('Large draft fixture');
      await advance(700);
      assert.equal(T.apiOptions.at(-1).keepalive, false);
    },
  ],

  [
    'a failed save stays recoverable and retries when the connection returns',
    async () => {
      await mount(head);
      T.failRequests = 1;
      await fillName('Offline event fixture');
      await chooseDepartment();
      await advance(700);
      assert.ok(document.querySelector('[role=alert]'));
      await unmount();
      await mount(head);
      assert.ok(document.body.textContent.includes('Offline event fixture'));
      await act(async () => window.dispatchEvent(new Event('online')));
      await advance(1000);
      assert.ok(
        [...T.records.values()].some((record) => record.reportName === 'Offline event fixture'),
      );
    },
  ],
  [
    'quick successive new events keep separate identities',
    async () => {
      await mount(head);
      await fillName('First quick event');
      await chooseDepartment();
      await clickText(document.body.textContent.includes('Buat Kegiatan Baru') ? 'Buat Kegiatan Baru' : 'Buat Proposal Event Baru');
      await fillName('Second quick event');
      await chooseDepartment();
      await unmount();
      await mount(head);
      await advance(1000);
      assert.ok(
        [...T.records.values()].some((record) => record.reportName === 'First quick event'),
      );
      assert.ok(
        [...T.records.values()].some((record) => record.reportName === 'Second quick event'),
      );
      assert.equal(T.records.size, 2);
    },
  ],
  [
    'switching accounts clears the previous editor and keeps drafts scoped to their owner',
    async () => {
      await mount(head);
      await fillName('Private head event');
      await chooseDepartment();
      await advance(700);
      T.profile = { ...head, uid: 'different-head' };
      await act(async () => app.render(React.createElement(Page)));
      const name = document.querySelector('input[placeholder="Contoh: Reuni SainTek 2026"]');
      assert.equal(name.value, '', 'the previous account editor leaked into the new account');
      assert.equal(document.body.textContent.includes('Private head event'), false);
    },
  ],
  [
    'switching the payroll period does not carry the editor into another period',
    async () => {
      await mount(head);
      await fillName('October event');
      await chooseDepartment();
      await advance(700);
      T.params = 'month=11&year=2026';
      await act(async () => app.render(React.createElement(Page)));
      const name = document.querySelector('input[placeholder="Contoh: Reuni SainTek 2026"]');
      assert.equal(name.value, '', 'the previous period editor remained active');
      assert.equal(document.body.textContent.includes('October event'), false);
      assert.ok([...T.records.values()].every((record) => record.period === '2026-10'));
    },
  ],
  [
    'a failed request from a departed page cannot replace newer local input',
    async () => {
      await mount(head);
      await fillName('Slow event');
      await chooseDepartment();
      T.holdRequests = true;
      await advance(700);
      assert.equal(T.held.length, 1);
      await fillName('Before navigation');
      await unmount();
      await mount(head);
      await clickText('Before navigation');
      await fillName('Newest recovered input');
      await act(async () => T.held[0].reject(new Error('Old request failed')));
      const drafts = JSON.parse(
        localStorage.getItem('proposal_kegiatan_drafts_v1_head-fixture_2026-10'),
      );
      assert.ok(
        drafts.some((draft) => draft.data.reportName === 'Newest recovered input'),
        'departed page replaced the recovered draft',
      );
      T.holdRequests = false;
      for (const held of T.held.slice(1)) await act(async () => held.resolve());
      await unmount();
    },
  ],

  [
    'new event survives navigation after the autosave completes',
    async () => {
      await mount(head);
      await fillName('Saved navigation event fixture');
      await chooseDepartment();
      await advance(1500);
      await unmount();
      await mount(head);
      assert.ok(document.body.textContent.includes('Saved navigation event fixture'));
    },
  ],
  [
    'early edits after selecting an event survive navigation',
    async () => {
      const d = fixture();
      d.status = 'proposal_draft';
      T.records.set('saved-event', d);
      await mount(head);
      await clickText('Saved event fixture');
      await fillName('Edited immediately fixture');
      await advance(1500);
      await unmount();
      await mount(head);
      assert.ok(
        document.body.textContent.includes('Edited immediately fixture'),
        'edit in the initial load guard disappeared',
      );
    },
  ],
  [
    'new account draft with only a title survives navigation',
    async () => {
      await mount({ ...head, uid: 'new-head-fixture' });
      await fillName('New account event fixture');
      await unmount();
      await mount({ ...head, uid: 'new-head-fixture' });
      assert.ok(
        document.body.textContent.includes('New account event fixture'),
        'first event disappeared before the SatKer field was filled',
      );
    },
  ],
  [
    'saved event survives navigation',
    async () => {
      T.records.set('saved-event', fixture());
      await mount(head);
      assert.ok(document.body.textContent.includes('Saved event fixture'));
      await unmount();
      await mount(head);
      assert.ok(document.body.textContent.includes('Saved event fixture'));
    },
  ],
  [
    'new event survives leaving before the autosave delay',
    async () => {
      await mount(head);
      await fillName('Navigation event fixture');
      await chooseDepartment();
      await unmount();
      await mount(head);
      assert.ok(
        document.body.textContent.includes('Navigation event fixture'),
        'created event disappeared after navigating away and back',
      );
    },
  ],
  [
    'approval preserves the head ownership and visibility',
    async () => {
      T.records.set('saved-event', fixture());
      await mount(admin);
      await clickText('Saved event fixture');
      await advance(600);
      await clickText('Setujui Proposal');
      await advance(2000);
      await unmount();
      await mount(head);
      assert.equal(
        T.records.get('saved-event').submittedBy,
        head.uid,
        'approval transferred ownership to the admin',
      );
      assert.ok(
        document.body.textContent.includes('Saved event fixture'),
        'approved event disappeared from the head list',
      );
      assert.equal(
        T.records.get('saved-event').status,
        'proposal_approved',
        'approval was reverted by a stale save',
      );
    },
  ],
  [
    'admin manual save preserves the head ownership and visibility',
    async () => {
      T.records.set('saved-event', fixture());
      await mount(admin);
      await clickText('Saved event fixture');
      await advance(600);
      await clickText('Simpan Laporan');
      await unmount();
      await mount(head);
      assert.equal(
        T.records.get('saved-event').submittedBy,
        head.uid,
        'manual save transferred ownership to the admin',
      );
      assert.ok(
        document.body.textContent.includes('Saved event fixture'),
        'event disappeared from the head list after admin save',
      );
    },
  ],
];
(async () => {
  Page = await bundle();
  let failed = 0;
  const selectedTests = tests.filter(([name]) => name.startsWith('vakasi release:') === testingVakasi && (!testingRealDialog || name.includes('opening pointer gesture') || name.includes('confirmation cancels safely') || name.includes('readonly viewing and modal closing')) && (!process.env.PROPOSAL_TEST_FILTER || name.includes(process.env.PROPOSAL_TEST_FILTER)));
  assert.ok(selectedTests.length, 'test filter must select at least one scenario');
  for (const [name, run] of selectedTests) {
    await reset();
    try {
      await run();
      console.log('PASS ' + name);
    } catch (error) {
      failed++;
      console.log('FAIL ' + name + '\n  ' + error.message);
    }
  }
  await reset();
  console.log(`${selectedTests.length - failed}/${selectedTests.length} lifecycle scenarios passed`);
  fs.rmSync(buildDir, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
