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
const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
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
exports.Button=el('button');exports.Input=el('input');exports.Label=el('label');exports.AutoResizeTextarea=el('textarea');`;
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
test('existing agenda entry can be edited, saved twice and printed from edit view', async () => {
  calls.length = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ method: init.method, body });
    return { ok: true, json: async () => ({ ok: true, data: { id: body.id || 'new-id' } }) };
  };
  const surat = { id: 'existing-id', nomorSurat: '001/A/AU/11/2026', tanggalSurat: '2026-11-10',
    tujuan: 'Fatmah', perihal: 'Undangan Rapat', satkerName: 'BAK', penandatanganNama: 'Kepala BAK',
    penandatanganJabatan: 'Kepala', status: 'terkirim', attachments: [] };
  try {
    await mount(surat);
    assert.equal(document.querySelector('input').value, surat.nomorSurat);
    assert.ok([...document.querySelectorAll('input')].some(input => input.value === 'Fatmah'));
    const text = document.querySelector('textarea[placeholder="Isi utama / rincian kegiatan / poin penting..."]');
    await change(text, 'Rapat hari Selasa');
    await click('Simpan Naskah');
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].body.id, 'existing-id');
    assert.equal(calls[0].body.letterDraft.isiParagraf2, 'Rapat hari Selasa');
    assert.ok(!('status' in calls[0].body));
    await change(text, 'Rapat hari Rabu');
    assert.match(document.body.textContent, /Naskah belum disimpan/);
    await click('Simpan Naskah');
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].body.id, 'existing-id');
    assert.equal(calls[1].body.letterDraft.isiParagraf2, 'Rapat hari Rabu');
    await click('Edit');
    let printed = '';
    window.open = () => ({ document: { write: html => { printed = html; }, close: () => {} } });
    await click('Cetak / PDF');
    assert.match(printed, /Rapat hari Rabu/);
    assert.match(printed, /001\/A\/AU\/11\/2026/);
    assert.match(printed, /window\.print/);
  } finally { await unmount(); }
});
test('standalone composer creates once then updates the newly created record', async () => {
  calls.length = 0;
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
