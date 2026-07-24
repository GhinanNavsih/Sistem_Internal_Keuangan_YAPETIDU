import assert from 'node:assert/strict';
import test from 'node:test';
import { getSatpamShiftForTeam, getSchedulingMonday } from './satpamRotation';

test('date-only Monday uses the newly rotated week', () => {
  assert.equal(getSatpamShiftForTeam(1, '2026-07-13'), 'Pagi');
  assert.equal(getSatpamShiftForTeam(2, '2026-07-13'), 'Malam');
  assert.equal(getSatpamShiftForTeam(3, '2026-07-13'), 'Sore');
});

test('an instant before Monday 08:00 Jakarta remains in the previous week', () => {
  assert.equal(
    getSchedulingMonday(new Date('2026-07-13T07:59:59+07:00')).toISOString(),
    new Date('2026-07-06T08:00:00+07:00').toISOString(),
  );
  assert.equal(
    getSchedulingMonday(new Date('2026-07-13T08:00:00+07:00')).toISOString(),
    new Date('2026-07-13T08:00:00+07:00').toISOString(),
  );
});

test('rotation follows Pagi to Malam to Sore', () => {
  assert.equal(getSatpamShiftForTeam(1, '2026-07-13'), 'Pagi');
  assert.equal(getSatpamShiftForTeam(1, '2026-07-20'), 'Malam');
  assert.equal(getSatpamShiftForTeam(1, '2026-07-27'), 'Sore');
  assert.equal(getSatpamShiftForTeam(1, '2026-08-03'), 'Pagi');
});
