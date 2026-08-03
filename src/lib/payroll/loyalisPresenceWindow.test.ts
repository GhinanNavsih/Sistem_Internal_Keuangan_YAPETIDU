import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoFillLoyalisScan,
  calculateLoyalisDailyDuration,
  LOYALIS_WORK_WINDOW_END_MINUTES,
  LOYALIS_WORK_WINDOW_START_MINUTES,
} from './loyalisPresenceWindow';

test('uses the official Loyalis work window for duration calculations', () => {
  assert.equal(LOYALIS_WORK_WINDOW_START_MINUTES, 450);
  assert.equal(LOYALIS_WORK_WINDOW_END_MINUTES, 840);

  assert.equal(
    calculateLoyalisDailyDuration('08:45:58', '14:08:04', 6.5),
    315,
  );
  assert.equal(
    calculateLoyalisDailyDuration('08:51:33', '15:38:25', 6.5),
    309,
  );
  assert.equal(
    calculateLoyalisDailyDuration('08:35:01', '16:32:53', 6.5),
    325,
  );
  assert.equal(
    calculateLoyalisDailyDuration('09:30:58', '16:44:44', 6.5),
    270,
  );
});

test('clamps scans before and after the official window', () => {
  assert.equal(calculateLoyalisDailyDuration('06:00:00', '08:00:00', 6.5), 30);
  assert.equal(calculateLoyalisDailyDuration('13:30:00', '16:00:00', 6.5), 30);
  assert.equal(calculateLoyalisDailyDuration('06:00:00', '07:00:00', 6.5), 0);
  assert.equal(calculateLoyalisDailyDuration('07:30:00', '14:00:00', 6.5), 390);
});

test('clamps generated scans from single-scan auto-fill', () => {
  assert.equal(autoFillLoyalisScan('13:30:00', 'out'), '14:00:00');
  assert.equal(autoFillLoyalisScan('07:00:00', 'in'), '07:30:00');
  assert.equal(autoFillLoyalisScan('08:00:00', 'out'), '10:30:00');
  assert.equal(autoFillLoyalisScan('14:00:00', 'in'), '11:30:00');
});

test('returns null when a scan is not a valid time', () => {
  assert.equal(calculateLoyalisDailyDuration('not-a-time', '14:00:00', 6.5), null);
  assert.equal(autoFillLoyalisScan('', 'out'), null);
});
