import assert from 'node:assert/strict';
import test from 'node:test';
import { planScrollAnchor } from './scrollAnchor';

const page = { scrollHeight: 5000, clientHeight: 900 };

test('scrolls by the drift when the page is still tall enough', () => {
  assert.deepEqual(planScrollAnchor({ ...page, scrollTop: 1200, drift: 300 }), { top: 1500, fill: 0 });
  assert.deepEqual(planScrollAnchor({ ...page, scrollTop: 1200, drift: -300 }), { top: 900, fill: 0 });
});

test('asks for empty space when a short list leaves the page too short', () => {
  // The browser already clamped the scroll to 600 (page 1500 tall, 900 visible);
  // the toolbar moved 700px down the screen, so we need to be back at 1300.
  assert.deepEqual(
    planScrollAnchor({ scrollHeight: 1500, clientHeight: 900, scrollTop: 600, drift: 700 }),
    { top: 1300, fill: 700 },
  );
});

test('fill covers exactly what is missing, rounded up', () => {
  assert.deepEqual(
    planScrollAnchor({ scrollHeight: 1500, clientHeight: 900, scrollTop: 600, drift: 100.4 }),
    { top: 700.4, fill: 101 },
  );
});

test('never scrolls above the top of the page', () => {
  assert.deepEqual(planScrollAnchor({ ...page, scrollTop: 100, drift: -400 }), { top: 0, fill: 0 });
});

test('a page shorter than the window needs no fill when scrolling stays at the top', () => {
  assert.deepEqual(
    planScrollAnchor({ scrollHeight: 700, clientHeight: 900, scrollTop: 0, drift: 0 }),
    { top: 0, fill: 0 },
  );
});
