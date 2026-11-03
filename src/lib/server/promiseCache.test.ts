import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPromiseCache } from './promiseCache';

describe('createPromiseCache', () => {
  it('loads a key once and serves the same value afterwards', async () => {
    const cache = createPromiseCache<number>(3);
    let loads = 0;
    const load = async () => ++loads;
    assert.equal(await cache.get('a', load), 1);
    assert.equal(await cache.get('a', load), 1);
    assert.equal(loads, 1);
  });

  it('shares one read between requests that overlap', async () => {
    const cache = createPromiseCache<string>(3);
    let loads = 0;
    let release!: (value: string) => void;
    const slow = () => {
      loads += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };
    const first = cache.get('a', slow);
    const second = cache.get('a', slow);
    release('rows');
    assert.deepEqual(await Promise.all([first, second]), ['rows', 'rows']);
    assert.equal(loads, 1);
  });

  it('forgets a failed read so the next request tries again', async () => {
    const cache = createPromiseCache<number>(3);
    await assert.rejects(cache.get('a', () => Promise.reject(new Error('boom'))), /boom/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(await cache.get('a', async () => 7), 7);
  });

  it('keeps the most recently used keys when it is full', async () => {
    const cache = createPromiseCache<string>(2);
    await cache.get('a', async () => 'a1');
    await cache.get('b', async () => 'b1');
    await cache.get('a', async () => 'a2'); // a is now newer than b
    await cache.get('c', async () => 'c1'); // evicts b
    assert.equal(await cache.get('a', async () => 'a3'), 'a1');
    assert.equal(await cache.get('b', async () => 'b2'), 'b2');
  });
});
