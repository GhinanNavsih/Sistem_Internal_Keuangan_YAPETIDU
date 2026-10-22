import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    standalone: { type: 'string' },
    origin: { type: 'string' },
    'if-standalone': { type: 'boolean', default: false },
  },
});
if (values.origin && values.standalone) throw new Error('Choose --origin or --standalone.');

const source = path.resolve('public');
const standalone = path.resolve(values.standalone || `${process.env.NEXT_DIST_DIR || '.next'}/standalone`);
if (!values.origin && values['if-standalone'] && !process.env.NEXT_PRIVATE_STANDALONE
  && !(await stat(standalone).catch(() => null))?.isDirectory()) {
  console.log('Public asset packaging check skipped: this build does not use standalone output.');
  process.exit(0);
}

async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}

const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
let failures = 0;
const assets = await files(source);
for (const asset of assets) {
  try {
    const expected = await readFile(path.join(source, asset));
    let actual;
    if (values.origin) {
      const url = new URL(`/${asset.split('/').map(encodeURIComponent).join('/')}`, values.origin);
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      actual = Buffer.from(await response.arrayBuffer());
    } else {
      actual = await readFile(path.join(standalone, 'public', asset));
    }
    if (digest(expected) !== digest(actual)) throw new Error('contents differ from public/');
    console.log(`PASS ${asset}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${asset}: ${error.message}`);
  }
}
console.log(`${assets.length - failures}/${assets.length} public assets verified.`);
process.exitCode = failures ? 1 : 0;
