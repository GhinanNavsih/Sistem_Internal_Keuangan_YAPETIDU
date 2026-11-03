/** Real login page/provider lifecycle; only Firebase and browser routing are simulated. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');

const rootDir = path.resolve(__dirname, '..');
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-auth-test-'));
const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/login' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realDateNow = Date.now;
let now = 0;
let nextTimer = 0;
const timers = new Map();
globalThis.setTimeout = (fn, delay = 0) => {
  const id = ++nextTimer;
  timers.set(id, { at: now + delay, fn });
  return id;
};
globalThis.clearTimeout = id => timers.delete(id);
Date.now = () => now;
const T = globalThis.__loginTest = {};
const snapshot = data => ({ exists: () => data !== null, data: () => data });
const validProfile = { email: 'test@example.invalid', role: 'super_admin', permittedCategories: [] };
const firebaseUser = { uid: 'approved-user', getIdToken: async () => 'test-token' };
const mockSources = {
  '@/lib/firebase': 'exports.auth=globalThis.__loginTest.auth;exports.db={};',
  'firebase/auth': `
    const T=globalThis.__loginTest;
    exports.onAuthStateChanged=(_auth,callback)=>{T.listener=callback;queueMicrotask(()=>callback(T.auth.currentUser));return()=>{T.listener=null;};};
    exports.signInWithEmailAndPassword=async(_auth,email,password)=>{T.credentials.push({email,password});if(T.credentialError)throw T.credentialError;T.auth.currentUser=T.user;if(T.notifySignIn)queueMicrotask(()=>T.listener?.(T.user));return {user:T.user};};
    exports.signInWithPopup=exports.signInWithEmailAndPassword;
    exports.signInWithCustomToken=exports.signInWithEmailAndPassword;
    exports.GoogleAuthProvider=class {};
    exports.signOut=async()=>{T.signOuts++;T.auth.currentUser=null;queueMicrotask(()=>T.listener?.(null));};
  `,
  'firebase/firestore': `
    const T=globalThis.__loginTest;
    exports.doc=(_db,_collection,uid)=>({uid});
    exports.getDocFromServer=ref=>T.serverRead(ref);
    exports.getDocFromCache=ref=>T.cacheRead(ref);
  `,
  'next/navigation': 'exports.useRouter=()=>globalThis.__loginTest.router;',
  'next/image': 'module.exports=()=>null;',
  '@/components/ui/button': `const React=require('react');exports.Button=props=>React.createElement('button',props);`,
  '@/components/ui/input': `const React=require('react');exports.Input=props=>React.createElement('input',props);`,
  'lucide-react': `for(const name of ['Hexagon','Mail','Lock','Eye','EyeOff','AlertCircle','Loader2','LogIn','CheckCircle2'])exports[name]=()=>null;`,
};
let bundle;
let reactRoot;
let context;
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
async function advance(ms) {
  const end = now + ms;
  while (true) {
    const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at;
    timers.delete(next[0]);
    await act(async () => { next[1].fn(); });
    await flush();
  }
  now = end;
  await flush();
}
async function mount({ delay = 0, profile = validProfile, cache = null, serverError = null, initialUser = null } = {}) {
  if (reactRoot) await act(async () => reactRoot.unmount());
  now = 0;
  timers.clear();
  localStorage.clear();
  sessionStorage.clear();
  Object.assign(T, {
    auth: T.auth || { currentUser: null }, user: firebaseUser, listener: null,
    credentials: [], credentialError: null, signOuts: 0, reads: 0, cacheReads: 0, redirects: [],
    notifySignIn: true,
  });
  T.auth.currentUser = initialUser;
  T.router = { replace: route => T.redirects.push(route) };
  T.serverRead = () => {
    T.reads++;
    return new Promise((resolve, reject) => setTimeout(() => serverError ? reject(serverError) : resolve(snapshot(profile)), delay));
  };
  T.cacheRead = async () => { T.cacheReads++; if (cache === null) throw new Error('No cached profile'); return snapshot(cache); };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ disabled: false, accounts: [] }) });
  function Probe() { context = bundle.useAuth(); return React.createElement(bundle.LoginPage); }
  reactRoot = createRoot(document.getElementById('app'));
  await act(async () => reactRoot.render(React.createElement(bundle.AuthProvider, null, React.createElement(Probe))));
  await flush();
  return T;
}
async function submit() {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    for (const [id, value] of [['email', 'test@example.invalid'], ['password', 'correct-test-password']]) {
      const input = document.getElementById(id);
      setter.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    }
  });
  await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  await flush();
}

async function changeEmail(value) {
  await act(async () => {
    const input = document.getElementById('email');
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

before(async () => {
  const outfile = path.join(buildDir, 'login.cjs');
  await build({
    stdin: { contents: `export {AuthProvider,useAuth} from './src/lib/AuthContext';export {default as LoginPage} from './src/app/login/page';`, resolveDir: rootDir, loader: 'tsx' },
    outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
    plugins: [{ name: 'login-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mockSources, args.path) ? { path: args.path, namespace: 'mock' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mockSources[args.path], loader: 'js', resolveDir: rootDir }));
    } }],
  });
  // External React must be shared with the test renderer, even from the temp folder.
  process.env.NODE_PATH = path.join(rootDir, 'node_modules');
  require('node:module').Module._initPaths();
  T.auth = { currentUser: null };
  bundle = require(outfile);
});
after(async () => {
  if (reactRoot) await act(async () => reactRoot.unmount());
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  Date.now = realDateNow;
  fs.rmSync(buildDir, { recursive: true, force: true });
  dom.window.close();
});

test('one Masuk click completes when the first profile response takes more than three seconds', async () => {
  await mount({ delay: 3500 });
  await submit();
  assert.equal(T.credentials.length, 1, 'The real form must submit the credentials once');
  await advance(4000);
  assert.equal(context.user?.uid, firebaseUser.uid, 'Correct credentials must finish login without a second click');
  assert.ok(T.redirects.includes('/dashboard/payroll'), 'The login page must navigate after one click');
  assert.equal(T.signOuts, 0);
});

test('the observer and the email submission share one profile request', async () => {
  await mount({ delay: 100 });
  await submit();
  await advance(101);
  assert.equal(context.user?.uid, firebaseUser.uid);
  assert.equal(T.reads, 1, 'The auth observer must not race a second login profile read');
});

test('a temporary Firestore failure recovers within the same Masuk submission', async () => {
  await mount();
  T.serverRead = async () => {
    T.reads++;
    if (T.reads === 1) throw Object.assign(new Error('Temporary connection failure'), { code: 'unavailable' });
    return snapshot(validProfile);
  };
  await submit();
  await advance(1000);
  assert.equal(context.user?.uid, firebaseUser.uid);
  assert.ok(T.redirects.includes('/dashboard/payroll'));
  assert.equal(T.credentials.length, 1);
  assert.equal(T.signOuts, 0);
});

test('an old cached disabled flag cannot reject a fresh enabled server profile', async () => {
  await mount({ delay: 3500, cache: { ...validProfile, disabled: true } });
  await submit();
  await advance(4000);
  assert.equal(context.user?.uid, firebaseUser.uid);
  assert.equal(T.signOuts, 0);
});

test('a delayed disabled-email response cannot block a different email', async () => {
  await mount();
  let resolveOld;
  globalThis.fetch = async url => {
    if (String(url).includes('old%40example.invalid')) {
      return new Promise(resolve => { resolveOld = resolve; });
    }
    return { ok: true, json: async () => ({ disabled: false }) };
  };
  await changeEmail('old@example.invalid');
  await advance(400);
  await changeEmail('test@example.invalid');
  await advance(400);
  await act(async () => resolveOld({ ok: true, json: async () => ({ disabled: true }) }));
  await flush();
  assert.ok(!document.body.textContent.includes('Akun Terdaftar Dalam Status Non-Aktif'));
});

test('a confirmed disabled profile is rejected', async () => {
  await mount({ profile: { ...validProfile, disabled: true } });
  await submit();
  await advance(1);
  assert.equal(context.profile, null);
  assert.ok(T.signOuts > 0);
  assert.equal(T.redirects.length, 0);
  assert.ok(document.body.textContent.includes('Akun Terdaftar Dalam Status Non-Aktif'));
});

test('fresh server status rejects a disabled account even if its cached profile is enabled', async () => {
  await mount({ delay: 3500, profile: { ...validProfile, disabled: true }, cache: validProfile });
  await submit();
  await advance(4000);
  assert.equal(context.profile, null);
  assert.ok(T.signOuts > 0);
  assert.equal(T.redirects.length, 0);
});

test('a missing profile is rejected with its own message', async () => {
  await mount({ profile: null });
  await submit();
  await advance(1);
  assert.equal(context.user, null);
  assert.ok(T.signOuts > 0);
  assert.ok(document.body.textContent.includes('Akun Anda belum terdaftar dalam sistem'));
});

test('a denied profile read cannot be mistaken for a missing account or force logout', async () => {
  await mount({ serverError: { code: 'permission-denied' } });
  await submit();
  await advance(1000);
  assert.equal(context.user, null);
  assert.equal(T.signOuts, 0);
  assert.ok(document.body.textContent.includes('profil belum dapat dimuat'));
  assert.ok(!document.body.textContent.includes('Akun Anda belum terdaftar dalam sistem'));
});

test('a first profile denial during credential propagation recovers without a second click', async () => {
  await mount();
  T.serverRead = async () => {
    T.reads++;
    if (T.reads === 1) throw { code: 'permission-denied' };
    return snapshot(validProfile);
  };
  await submit();
  await advance(1000);
  assert.equal(context.user?.uid, firebaseUser.uid);
  assert.equal(T.credentials.length, 1);
  assert.equal(T.signOuts, 0);
});

test('a hung profile request releases the button and ignores a late response', async () => {
  await mount({ delay: 20000 });
  await submit();
  await advance(15001);
  assert.equal(context.user, null);
  assert.equal(context.loading, false);
  assert.equal(document.getElementById('btn-login-email').disabled, false);
  assert.ok(document.body.textContent.includes('profil belum dapat dimuat'));
  await advance(5000);
  assert.equal(context.user, null);
  assert.equal(T.redirects.length, 0);
  assert.equal(T.signOuts, 0);
});

test('logging out while the profile loads cannot restore the old session', async () => {
  await mount({ delay: 1000 });
  await submit();
  await act(async () => context.logout());
  await advance(1001);
  assert.equal(context.user, null);
  assert.equal(context.profile, null);
  assert.equal(T.redirects.length, 0);
});

test('rapid repeated submissions do not submit the credentials twice', async () => {
  await mount({ delay: 3500 });
  await submit();
  await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(T.credentials.length, 1);
  assert.equal(document.getElementById('btn-login-email').disabled, true);
  await advance(4000);
  assert.equal(context.user?.uid, firebaseUser.uid);
});

test('restoring an existing session waits for a slow profile without forcing logout', async () => {
  await mount({ initialUser: firebaseUser, delay: 3500 });
  assert.equal(context.loading, true);
  await advance(4000);
  assert.equal(context.user?.uid, firebaseUser.uid);
  assert.equal(T.credentials.length, 0);
  assert.equal(T.signOuts, 0);
});

test('wrong credentials remain rejected without a profile request', async () => {
  await mount();
  T.credentialError = { code: 'auth/invalid-credential' };
  await submit();
  await advance(1);
  assert.equal(context.user, null);
  assert.equal(T.reads, 0);
  assert.ok(document.body.textContent.includes('Email atau password salah'));
});

test('an explicit retry works when Firebase does not repeat its same-user auth event', async () => {
  await mount({ delay: 20000 });
  await submit();
  await advance(15001);
  T.notifySignIn = false;
  T.serverRead = async () => { T.reads++; return snapshot(validProfile); };
  await submit();
  await flush();
  assert.equal(context.user?.uid, firebaseUser.uid);
  assert.ok(T.redirects.includes('/dashboard/payroll'));
});

test('a late disabled profile from the previous account cannot sign out the new account', async () => {
  await mount();
  T.serverRead = ref => {
    T.reads++;
    return new Promise(resolve => setTimeout(() => resolve(snapshot({ ...validProfile, disabled: ref.uid === firebaseUser.uid })), ref.uid === firebaseUser.uid ? 1000 : 0));
  };
  await submit();
  const newUser = { ...firebaseUser, uid: 'new-approved-user' };
  await act(async () => { T.auth.currentUser = newUser; T.listener(newUser); });
  await advance(1);
  assert.equal(context.user?.uid, newUser.uid);
  await advance(1000);
  assert.equal(context.user?.uid, newUser.uid);
  assert.equal(T.signOuts, 0);
});

test('a stale signed-out observer event cannot clear a newer account', async () => {
  await mount();
  await submit();
  await advance(1);
  await act(async () => T.listener(null));
  assert.equal(context.user?.uid, firebaseUser.uid);
});

test('Google sign-in shares the same slow-profile protection', async () => {
  await mount({ delay: 3500 });
  await act(async () => document.getElementById('btn-login-google').click());
  await advance(4000);
  assert.equal(context.user?.uid, firebaseUser.uid);
  assert.equal(T.reads, 1);
  assert.ok(T.redirects.includes('/dashboard/payroll'));
});
