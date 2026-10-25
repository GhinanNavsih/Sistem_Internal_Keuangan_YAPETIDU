/** Actual React page lifecycle with deterministic time and isolated persistence boundaries. */
/* eslint-disable @typescript-eslint/no-require-imports -- Install the DOM before loading React DOM and the compiled page. */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const root = path.resolve(__dirname, '..');
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
  T.apiOptions.push(options);
  if (T.failRequests > 0) {
    T.failRequests--;
    throw new Error('Simulated network outage');
  }
  if (T.holdRequests) {
    await new Promise((resolve, reject) => T.held.push({ resolve, reject }));
  }
  const command = JSON.parse(options.body);
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
  '@/lib/queries/hooks': `const T=globalThis.__proposalTest; exports.useDepartments=()=>({data:T.departments}); exports.useEmployeesLoyalis=()=>({data:T.employees,isLoading:false,isError:false}); exports.usePayrollPeriod=()=>({data:T.period}); exports.useKegiatanHistoricalBaselines=()=>({data:[],isLoading:false});`,
  'firebase/firestore': `const T=globalThis.__proposalTest; exports.collection=(_,name)=>({name}); exports.doc=(_,name,id)=>({name,id}); exports.where=(...args)=>args; exports.query=(...args)=>args; exports.serverTimestamp=()=>({seconds:Math.floor(Date.now()/1000)}); exports.onSnapshot=(query,next)=>{const l={next,period:query[1][2]};T.listeners.add(l);T.notify();return()=>T.listeners.delete(l)}; exports.setDoc=T.setDoc; exports.deleteDoc=async(ref)=>{T.deleteCalls.push(ref.id);if(T.deleteFailure)throw T.deleteFailure;T.records.delete(ref.id);T.notify()};`,
  '@/lib/payroll/client': `exports.authenticatedJson=(url,options)=>globalThis.__proposalTest.api(url,options);exports.createFinancialRequestId=(prefix)=>prefix+'_'+Date.now()+'_'+(++globalThis.__proposalTest.nextId);`,
  '@/utils/generateProposalKegiatanPdf': `exports.generateProposalKegiatanPdf=()=>{};`,
  '@/utils/generateLpjPdf': `exports.generateLpjPdf=async()=>{};`,
  '@/utils/generateLpjExpenseReportPdf': `exports.generateLpjExpenseReportPdf=async()=>{};`,
  '@/lib/uploads': `exports.uploadProofFile=async()=>{throw new Error('Unexpected upload in page test')};`,
  '@/utils/ocrParser': `exports.renderFileToCanvas=async()=>{throw new Error('Unexpected receipt rendering in page test')};`,
  './SignatureSettings': `exports.default=()=>null;`,
};
const ui = `const React=require('react'); const element=(tag)=>(props)=>{const {children,variant,size,asChild,render,showCloseButton,...rest}=props;return React.createElement(tag,rest,children)}; exports.Button=element('button');exports.Input=element('input');exports.Card=element('div');exports.FloatingSnackbar=()=>null;exports.ConfirmDialog=({open,title,confirmLabel,onConfirm})=>open?React.createElement('div',{role:'dialog'},React.createElement('h3',{},title),React.createElement('button',{onClick:onConfirm},confirmLabel)):null;exports.Dialog=({open,children})=>open?React.createElement('div',{role:'dialog'},children):null;exports.DialogContent=element('div');exports.DialogHeader=element('div');exports.DialogTitle=element('h3');exports.Select=({value,onValueChange,disabled})=>React.createElement('select',{'data-testid':'department',value,disabled,onChange:e=>onValueChange(e.target.value)},React.createElement('option',{value:''},'Pilih'),React.createElement('option',{value:'REKTORAT'},'REKTORAT'));exports.SelectTrigger=()=>null;exports.SelectContent=()=>null;exports.SelectItem=()=>null;exports.SelectValue=()=>null;`;
async function bundle() {
  const pagePath = path.join(root, 'src/app/dashboard/payroll/uraian/proposal-kegiatan/page.tsx');
  const source = process.env.PROPOSAL_TEST_REVISION
    ? childProcess.execFileSync(
        'git',
        [
          'show',
          `${process.env.PROPOSAL_TEST_REVISION}:src/app/dashboard/payroll/uraian/proposal-kegiatan/page.tsx`,
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
async function fillName(name) {
  const input = document.querySelector('input[placeholder="Contoh: Reuni SainTek 2026"]');
  assert.ok(input, 'name field');
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
  T.failRequests = 0;
  T.enforceRevision = false;
  T.deleteCalls = [];
  T.deleteFailure = null;
  T.holdRequests = false;
  T.held = [];
  app = null;
  localStorage.clear();
}
const tests = [
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
      await clickText('Buat Proposal Event Baru');
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
  const selectedTests = tests.filter(([name]) => !process.env.PROPOSAL_TEST_FILTER || name.includes(process.env.PROPOSAL_TEST_FILTER));
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
