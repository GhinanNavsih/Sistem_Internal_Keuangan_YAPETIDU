/* Exercises the actual composer with browser and network boundaries isolated. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const root = path.resolve(__dirname, '..');
process.env.NODE_PATH = path.join(root, 'node_modules');
require('node:module').Module._initPaths();
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'surat-composer-'));
let Composer, app;
const calls = [];
const ui = `const React=require('react');
const el=tag=>({children,variant,size,showCloseButton,asChild,minRows,...props})=>React.createElement(tag,props,children);
exports.Dialog=({open,children})=>open?React.createElement('section',null,children):null;
exports.DialogContent=el('div');exports.DialogHeader=el('header');exports.DialogTitle=el('h2');exports.DialogDescription=el('p');exports.DialogFooter=el('footer');
exports.Button=el('button');exports.Input=el('input');exports.Label=el('label');exports.AutoResizeTextarea=el('textarea');
exports.OptionSelect=({id,value,onValueChange,options})=>React.createElement('select',{id,value,onChange:e=>onValueChange(e.target.value)},options.map(o=>React.createElement('option',{key:o.value,value:o.value},o.label)));`;
before(async () => {
  await build({ entryPoints: [path.join(root, 'src/components/surat-menyurat/SuratComposerModal.tsx')],
    bundle: true, packages: 'external', platform: 'node', format: 'cjs', outfile: path.join(directory, 'composer.cjs'),
    tsconfig: path.join(root, 'tsconfig.json'), plugins: [{ name: 'boundaries', setup(b) {
      b.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: args.path, namespace: 'ui' }));
      b.onLoad({ filter: /.*/, namespace: 'ui' }, () => ({ contents: ui, loader: 'js', resolveDir: root }));
      b.onResolve({ filter: /^@\/lib\/AuthContext$/ }, args => ({ path: args.path, namespace: 'auth' }));
      b.onLoad({ filter: /.*/, namespace: 'auth' }, () => ({ contents: `exports.useAuth=()=>({user:{getIdToken:async()=> 'test-token'}});`, loader: 'js' }));
      b.onResolve({ filter: /^next\/image$/ }, args => ({ path: args.path, namespace: 'image' }));
      b.onLoad({ filter: /.*/, namespace: 'image' }, () => ({ contents: `const React=require('react');module.exports=({priority,...props})=>React.createElement('img',props);`, loader: 'js', resolveDir: root }));
    }}] });
  Composer = require(path.join(directory, 'composer.cjs')).default;
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));
async function mount(surat) {
  app = createRoot(document.getElementById('app'));
  await act(async () => app.render(React.createElement(Composer, { open: true, onOpenChange: () => {},
    defaultSatkerName: 'BAK', nextSequence: 2, surat })));
}
async function unmount() { await act(async () => app.unmount()); app = null; }
async function click(label) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label);
  assert.ok(button, `missing button: ${label}`);
  await act(async () => button.click());
}
async function change(input, value) {
  const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
  await act(async () => input.dispatchEvent(new window.Event('input', { bubbles: true })));
}
test('letter date can be chosen from an Indonesian calendar', async () => {
  let savedBody;
  globalThis.fetch = async (_url, init) => {
    savedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ ok: true, data: { id: 'calendar-id' } }) };
  };
  try {
    await mount({ id: 'calendar-id', nomorSurat: '005', tanggalSurat: '2026-11-14', templateType: 'undangan',
      tujuan: 'Penerima', perihal: 'Rapat', satkerName: 'BAK' });
    const trigger = document.querySelector('button[aria-label="Tanggal Surat"]');
    assert.match(trigger.textContent, /14 November 2026/);
    await act(async () => trigger.click());
    assert.match(document.body.textContent, /November 2026/);
    for (const day of ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']) assert.match(document.body.textContent, new RegExp(day));
    const nextMonth = document.querySelector('button[aria-label="Bulan berikutnya"]');
    await act(async () => nextMonth.click());
    assert.match(document.body.textContent, /Desember 2026/);
    await act(async () => document.querySelector('button[aria-label="Kamis, 3 Desember 2026"]').click());
    assert.match(trigger.textContent, /3 Desember 2026/);
    assert.match(document.getElementById('printable-official-letter').textContent, /3 Desember 2026/);
    const previewDate = document.querySelector('[title="Klik dua kali untuk mengedit tanggal surat"]');
    await act(async () => previewDate.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })));
    await act(async () => document.querySelector('button[aria-label="Jumat, 4 Desember 2026"]').click());
    assert.match(trigger.textContent, /4 Desember 2026/);
    await click('Simpan Naskah');
    assert.equal(savedBody.tanggalSurat, '2026-12-04');
  } finally { await unmount(); }
});
test('existing agenda entry shows editor and preview and can be saved and printed', async () => {
  calls.length = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ method: init.method, body });
    return { ok: true, json: async () => ({ ok: true, data: { id: body.id || 'new-id' } }) };
  };
  const surat = { id: 'existing-id', nomorSurat: '005/A/AU/11/2026', tanggalSurat: '2026-11-14', templateType: 'tugas',
    tujuan: 'Fatmah', perihal: 'Undangan Rapat', satkerName: 'BAK', penandatanganNama: 'Kepala BAK',
    penandatanganJabatan: 'Kepala', status: 'terkirim', attachments: [] };
  try {
    await mount(surat);
    assert.ok(document.getElementById('printable-official-letter'));
    assert.match(document.getElementById('printable-official-letter').textContent, /UNIVERSITAS PESANTREN TINGGI DARUL ULUM/);
    for (const label of ['Edit', 'Preview', 'Keduanya']) {
      assert.ok(![...document.querySelectorAll('button')].some(button => button.textContent.trim() === label));
    }
    assert.ok([...document.querySelectorAll('input')].some(input => input.value === surat.nomorSurat));
    assert.ok([...document.querySelectorAll('input')].some(input => input.value === 'Fatmah'));
    const text = document.querySelector('textarea[placeholder="Isi utama / rincian kegiatan / poin penting..."]');
    await change(text, 'Rapat hari Selasa');
    await click('Simpan Naskah');
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].body.id, 'existing-id');
    assert.equal(calls[0].body.letterDraft.isiParagraf2, 'Rapat hari Selasa');
    assert.ok(!('status' in calls[0].body));
    await change(text, 'Rapat hari Rabu');
    assert.doesNotMatch(document.body.textContent, /Naskah belum disimpan/);
    await click('Simpan Naskah');
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].body.id, 'existing-id');
    assert.equal(calls[1].body.letterDraft.isiParagraf2, 'Rapat hari Rabu');
    let printed = '';
    const printDocument = { write: html => { printed = html; }, close: () => {} };
    window.open = () => ({ document: printDocument });
    await click('Cetak / PDF');
    assert.equal(calls[2].method, 'PUT');
    assert.equal(calls[2].body.id, 'existing-id');
    assert.match(printed, /Rapat hari Rabu/);
    assert.match(printed, /005\/A\/AU\/11\/2026/);
    assert.match(printed, /window\.print/);
    assert.match(printed, /UNIVERSITAS PESANTREN TINGGI DARUL ULUM/);
    assert.equal(printDocument.title, '005 Tugas 14-11-26');
  } finally { await unmount(); }
});
test('printing creates an outgoing letter before opening the print dialog', async () => {
  calls.length = 0;
  let saved = false;
  let printed = '';
  globalThis.fetch = async (_url, init) => {
    calls.push({ method: init.method, body: JSON.parse(init.body) });
    return { ok: true, json: async () => { saved = true; return { ok: true, data: { id: 'printed-id' } }; } };
  };
  window.open = () => ({ close: () => {}, document: { write: html => {
    assert.equal(saved, true, 'printing must follow a successful save');
    printed = html;
  }, close: () => {} } });
  try {
    await mount(null);
    await click('Cetak / PDF');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(Object.hasOwn(calls[0].body, 'status'), false);
    assert.match(printed, /window\.print/);
    await click('Cetak / PDF');
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].body.id, 'printed-id');
  } finally { await unmount(); }
});
test('the print filename follows the selected template and letter date', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, data: { id: 'other-id' } }) });
  const printDocument = { write: () => {}, close: () => {} };
  window.open = () => ({ document: printDocument });
  try {
    await mount({ id: 'other-id', nomorSurat: '12/BAK/UNIPDU/XII/2025', tanggalSurat: '2025-12-03',
      templateType: 'undangan', tujuan: 'Penerima', perihal: 'Rapat', satkerName: 'BAK' });
    await click('Cetak / PDF');
    assert.equal(printDocument.title, '012 Undangan 03-12-25');
  } finally { await unmount(); }
});
test('a failed save closes the print window and displays the error', async () => {
  let closed = false;
  let printed = false;
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ ok: false, error: 'Gagal menyimpan surat.' }) });
  window.open = () => ({ close: () => { closed = true; }, document: { write: () => { printed = true; }, close: () => {} } });
  try {
    await mount(null);
    await click('Cetak / PDF');
    assert.equal(closed, true);
    assert.equal(printed, false);
    assert.match(document.body.textContent, /Gagal menyimpan surat/);
  } finally { await unmount(); }
});
test('standalone composer creates once then updates the newly created record', async () => {
  calls.length = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body); calls.push({ method: init.method, body });
    return { ok: true, json: async () => ({ ok: true, data: { id: body.id || 'new-id' } }) };
  };
  try {
    await mount(null);
    const save = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Simpan ke Surat Keluar');
    await act(async () => { save.click(); save.click(); });
    assert.equal(calls.length, 1, 'rapid clicks cannot create two agenda entries');
    assert.equal(calls[0].method, 'POST');
    await click('Simpan Naskah');
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].body.id, 'new-id');
  } finally { await unmount(); }
});
test('a YAPETIDU agenda entry uses the foundation letterhead', async () => {
  try {
    await mount({ id: 'foundation', institutionScope: 'YAPETIDU', nomorSurat: '001', tanggalSurat: '2026-11-10',
      tujuan: 'Penerima', perihal: 'Perihal', satkerName: 'YAPETIDU', penandatanganNama: 'Ketua', penandatanganJabatan: 'Ketua' });
    const preview = document.getElementById('printable-official-letter');
    assert.match(preview.textContent, /YAYASAN PESANTREN TINGGI/);
    assert.equal(preview.querySelector('img').alt, 'Logo YAPETIDU');
  } finally { await unmount(); }
});
