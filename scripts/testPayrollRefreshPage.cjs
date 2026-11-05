/* Actual refresh UI and dashboard handlers, with isolated persistence boundaries. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const childProcess = require('node:child_process');
const { test, before, after } = require('node:test');
const rootDir = path.resolve(__dirname, '..');
process.env.NODE_PATH = path.join(rootDir, 'node_modules');
require('node:module').Module._initPaths();
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  ShadowRoot: dom.window.ShadowRoot, MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true });
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const T = globalThis.__payrollRefreshTest = {};
globalThis.alert = text => T.alerts.push(text);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'payroll-refresh-test-'));
let PaySlipDialog, BulkProbe, app;
const fields = amount => [{ label: 'Gaji Pokok', amount }];
const clone = structuredClone;
function reset() { Object.assign(T, { writes: [], alerts: [], states: {}, changes: [], errors: {}, notification: null, closed: false, period: '2026_11', errorsUI: {}, gate: null }); }
const ui = `const React=require('react');const el=tag=>({children,variant,size,showCloseButton,asChild,...props})=>React.createElement(tag,props,children);
exports.Dialog=({open,children})=>open?React.createElement('section',{'data-dialog':true},children):null;
exports.DialogContent=el('div');exports.DialogHeader=el('header');exports.DialogTitle=el('h2');exports.DialogDescription=el('p');exports.DialogFooter=el('footer');
exports.Button=el('button');exports.Input=el('input');exports.Label=el('label');exports.Badge=el('span');`;
const sourceAtRevision = file => process.env.REFRESH_TEST_REVISION
  ? childProcess.execFileSync('git', ['show', `${process.env.REFRESH_TEST_REVISION}:${file}`], { cwd: rootDir, encoding: 'utf8' })
  : fs.readFileSync(path.join(rootDir, file), 'utf8');
const page = sourceAtRevision('src/app/dashboard/payroll/page.tsx');
const start = page.indexOf('  const handleToggleSelectEmployee =');
const end = page.indexOf('  const handleSlipRefresh =', start);
const dialogStart = page.indexOf('      {/* ─── Bulk Refresh Dialog');
const dialogEnd = page.indexOf('      {/* Bulk-operation failure report */}', dialogStart);
assert.ok(start > 0 && end > start);
before(async () => {
  await build({ stdin: { contents: sourceAtRevision('src/components/PaySlipDialog.tsx'), loader: 'tsx', resolveDir: rootDir },
    bundle: true, packages: 'external', platform: 'node', format: 'cjs', outfile: path.join(directory, 'dialog.cjs'),
    tsconfig: path.join(rootDir, 'tsconfig.json'), plugins: [{ name: 'boundaries', setup(b) {
      b.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: args.path, namespace: 'ui' }));
      b.onLoad({ filter: /.*/, namespace: 'ui' }, () => ({ contents: ui, loader: 'js', resolveDir: rootDir }));
      b.onResolve({ filter: /^@\/utils\/generatePaySlipPdf$/ }, args => ({ path: args.path, namespace: 'pdf' }));
      b.onLoad({ filter: /.*/, namespace: 'pdf' }, () => ({ contents: 'exports.generatePaySlipPdf=async()=>{};', loader: 'js' }));
    }}] });
  PaySlipDialog = require(path.join(directory, 'dialog.cjs')).default;
  await build({ stdin: { contents: `import React,{useState,useRef} from 'react';
    import {normalizeTaxFields} from '@/lib/payroll/payrollTax';
    import {applySlipRefresh,refreshFieldKey} from '@/lib/payroll/slipRefresh';
    import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
    import {Button} from '@/components/ui/button';
    import {RefreshCw,Loader2,CheckCheck} from 'lucide-react';
    const T=globalThis.__payrollRefreshTest;
    const formatIDR=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
    const createFinancialRequestId=()=> 'refresh-fixture-request';
    const authenticatedJson=async(url,options)=>{const body=JSON.parse(options.body);T.writes.push(body);if(T.gate)await T.gate;if(T.errors[body.employeeId])throw new Error(T.errors[body.employeeId]);return {earnings:body.earnings,deductions:body.deductions,taxes:[],taxApplied:false,revision:2};};
    export default function BulkProbe(){
      const attendancePeriodStatus=T.closed?'closed':'open',targetDate=new Date(2026,10,1);
      const bulkRefreshInFlight=useRef(false),bulkRefreshPeriod=useRef(T.period||'2026_11');
      const refreshRequestId=()=>createFinancialRequestId();
      const [bulkRefreshErrors,setBulkRefreshErrors]=useState({});T.errorsUI=bulkRefreshErrors;
      const [slipStates,setSlipStates]=useState(T.states);
      const [bulkChanges,setBulkChanges]=useState(T.changes);
      const [selectedBulkRefreshEmployeeIds,setSelectedBulkRefreshEmployeeIds]=useState(new Set(T.changes.map(c=>c.employeeId)));
      const [selectedBulkRefreshFields,setSelectedBulkRefreshFields]=useState(Object.fromEntries(T.changes.map(c=>[c.employeeId,new Set(c.diffs.map(refreshFieldKey))])));
      const [refreshingBulk,setRefreshingBulk]=useState(false);
      const [bulkRefreshDialogOpen,setBulkRefreshDialogOpen]=useState(true);
      const setNotification=(value)=>{T.notification=typeof value==='function'?value(T.notification):value;};
      ${page.slice(start,end)}
      T.handlers={handleApplyBulkRefresh,handleToggleSelectField,handleToggleSelectEmployee,handleToggleSelectAll};T.localStates=slipStates;T.dialogOpen=bulkRefreshDialogOpen;T.selected=selectedBulkRefreshEmployeeIds;T.selectedFields=selectedBulkRefreshFields;
      return <>${page.slice(dialogStart, dialogEnd)}</>;
    }`, loader: 'tsx', resolveDir: rootDir }, bundle: true, packages: 'external', platform: 'node', format: 'cjs',
    outfile: path.join(directory, 'bulk.cjs'), tsconfig: path.join(rootDir, 'tsconfig.json'), plugins:[{name:'ui',setup(b){
      b.onResolve({filter:/^@\/components\/ui\//},args=>({path:args.path,namespace:'ui'}));
      b.onLoad({filter:/.*/,namespace:'ui'},()=>({contents:ui,loader:'js',resolveDir:rootDir}));
    }}] });
  BulkProbe = require(path.join(directory, 'bulk.cjs')).default;
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));
async function mount(Component, props = {}) {
  app = createRoot(document.getElementById('app'));
  await act(async () => app.render(React.createElement(Component, props)));
}
async function unmount() { if (app) await act(async () => app.unmount()); app = null; }
async function click(text) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
  assert.ok(button, `Button ${text} exists`);
  await act(async () => button.click());
}
function props(overrides = {}) {
  return { open: true, employee: { id: 'a', personal_info: { name: 'Test' } }, employeeNo: 1,
    gapok: 1000000, period: 'November 2026', periodToken: '2026-11', periodClosed: false,
    slipState: { status: 'draft', earnings: fields(1000000), deductions: [], taxes: [], revision: 1 },
    activeTab: 'loyalis', vakasiTambahanList: [], customColumns: [], actorRole: 'super_admin',
    onOpenChange: () => {}, onRefresh: async () => ({ earnings: fields(2000000), deductions: [] }),
    onSave: async (employeeId, earnings, deductions) => { T.writes.push({ employeeId, earnings: clone(earnings), deductions: clone(deductions) }); },
    ...overrides };
}
function change(employeeId) {
  return { employeeId, employeeName: employeeId, expectedRevision: 1, isLocked: false, currentEarnings: fields(1000000), currentDeductions: [],
    freshEarnings: fields(2000000), freshDeductions: [],
    diffs: [{ type: 'earnings', label: 'Gaji Pokok', oldValue: 1000000, newValue: 2000000 }] };
}
test('single refresh confirmation persists the approved amount without a second save', async () => {
  reset();
  try {
    await mount(PaySlipDialog, props());
    await click('Refresh');
    await click('Terapkan Perubahan');
    assert.equal(T.writes.length, 1, 'confirmation saves exactly once');
    assert.deepEqual(T.writes[0].earnings, fields(2000000));
  } finally { await unmount(); }
});
test('bulk refresh reports partial success and updates every successful local slip', async () => {
  reset();T.changes = ['a','b','c'].map(change);
  T.states = Object.fromEntries(['a','b','c'].map(id => [id,{ status: 'draft', earnings: fields(1000000), deductions: [], revision: 1 }]));
  T.errors.b = 'Slip ini sudah dikunci';
  try {
    await mount(BulkProbe);
    await act(async () => T.handlers.handleApplyBulkRefresh());
    assert.deepEqual(T.writes.map(w=>w.employeeId), ['a','b','c'], 'one failed employee must not abandon the rest');
    assert.deepEqual(T.localStates.a.earnings, fields(2000000));
    assert.deepEqual(T.localStates.b.earnings, fields(1000000));
    assert.deepEqual(T.localStates.c.earnings, fields(2000000));
    assert.equal(T.dialogOpen, true, 'failed employees remain available for review');
  } finally { await unmount(); }
});
test('bulk refresh can apply a listed change for a slip that is not saved yet', async () => {
  reset();T.changes=[{ ...change('new'), expectedRevision: null }];
  try {
    await mount(BulkProbe);
    await act(async () => T.handlers.handleApplyBulkRefresh());
    assert.equal(T.writes.length, 1, 'a change offered for confirmation must not be silently filtered out');
  } finally { await unmount(); }
});

test('a later Pekarya preview update does not dismiss the comparison or reset the reviewed form', async () => {
  reset();
  const preview = amount => ({ earnings: fields(amount), meta: { warnings: [], canCreateSlip: true } });
  const base = props({ activeTab: 'blue', pekaryaPreview: preview(1000000) });
  function Parent() {
    const [current, setCurrent] = React.useState(base.pekaryaPreview);
    T.replacePreview = () => setCurrent(preview(2500000));
    return React.createElement(PaySlipDialog, { ...base, pekaryaPreview: current, onRefresh: async () => {
      setCurrent(preview(2000000));
      return { earnings: fields(2000000), deductions: [], expectedRevision: 1 };
    } });
  }
  try {
    await mount(Parent);
    await click('Refresh');
    await act(async () => T.replacePreview());
    assert.ok(document.body.textContent.includes('Perbandingan Data Terbaru'));
    await click('Terapkan Perubahan');
    assert.equal(T.writes.length, 1);
    assert.deepEqual(T.writes[0].earnings, fields(2000000));
  } finally { await unmount(); }
});

test('a failed single save keeps the comparison open, explains the error, and can be retried', async () => {
  reset();let attempts=0;
  try {
    await mount(PaySlipDialog, props({ onSave: async () => { if (++attempts === 1) throw new Error('Koperasi sedang tidak tersedia'); } }));
    await click('Refresh');
    await click('Terapkan Perubahan');
    assert.match(document.querySelector('[role="alert"]').textContent, /Koperasi/);
    assert.ok(document.body.textContent.includes('Perbandingan Data Terbaru'));
    await click('Terapkan Perubahan');
    assert.equal(attempts, 2);
    assert.match(document.querySelector('[role="status"]').textContent, /telah disimpan/);
  } finally { await unmount(); }
});

test('rapid single confirmation clicks save once and keep the dialog busy until completion', async () => {
  reset();let finish;
  try {
    await mount(PaySlipDialog, props({ onSave: () => { T.writes.push('save'); return new Promise(resolve=>{finish=resolve;}); } }));
    await click('Refresh');
    const apply=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Terapkan Perubahan');
    await act(async()=>{apply.click();apply.click();});
    assert.equal(T.writes.length,1);
    assert.equal(apply.disabled,true);
    await act(async()=>finish());
  } finally { await unmount(); }
});

test('unchecked bulk fields survive; field and employee selections stay aligned in Strict Mode', async () => {
  reset();
  const c=change('a');
  c.currentEarnings.push({label:'Manual',amount:500});
  c.diffs.push({type:'earnings',label:'Manual',oldValue:500,newValue:null});
  T.changes=[c];T.states={a:{status:'draft',earnings:clone(c.currentEarnings),deductions:[]}};
  const Strict=()=>React.createElement(React.StrictMode,null,React.createElement(BulkProbe));
  try {
    await mount(Strict);
    await act(async()=>T.handlers.handleToggleSelectField('a','earnings::manual'));
    assert.equal(T.selected.has('a'),true);
    assert.equal(T.selectedFields.a.has('earnings::manual'),false);
    await act(async()=>T.handlers.handleApplyBulkRefresh());
    assert.deepEqual(T.writes[0].earnings,[...fields(2000000),{label:'Manual',amount:500}]);
  } finally { await unmount(); }
});

test('bulk refresh refuses a closed or changed period without writing', async () => {
  for (const config of [{closed:true},{period:'2026_10'}]) {
    reset();Object.assign(T,config);T.changes=[change('a')];
    try { await mount(BulkProbe);await act(async()=>T.handlers.handleApplyBulkRefresh());
      assert.equal(T.writes.length,0);assert.ok(T.errorsUI._global);
    } finally { await unmount(); }
  }
});

test('clicking the actual bulk field label preserves unchecked manual rows', async () => {
  reset();const c=change('a');c.currentEarnings.push({label:'Manual',amount:500});
  c.diffs.push({type:'earnings',label:'Manual',oldValue:500,newValue:null});T.changes=[c];
  try {
    await mount(BulkProbe);
    const label=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Manual'));
    await act(async()=>label.click());
    await click('Terapkan Perubahan (1)');
    assert.deepEqual(T.writes[0].earnings,[...fields(2000000),{label:'Manual',amount:500}]);
  } finally { await unmount(); }
});

test('bulk confirmation cannot run twice and selection controls stay disabled while saving', async () => {
  reset();T.changes=[change('a')];let finish;T.gate=new Promise(resolve=>{finish=resolve;});
  try {
    await mount(BulkProbe);
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Terapkan Perubahan (1)');
    await act(async()=>{button.click();button.click();});
    assert.equal(T.writes.length,1);
    assert.ok([...document.querySelectorAll('input[type="checkbox"]')].every(input=>input.disabled));
    await act(async()=>finish());
  } finally { T.gate=null;await unmount(); }
});
