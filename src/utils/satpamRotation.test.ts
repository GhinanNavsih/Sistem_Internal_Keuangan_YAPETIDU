import assert from 'node:assert/strict';
import test from 'node:test';
import { getSatpamShiftForTeam, getSchedulingSunday } from './satpamRotation';

test('date-only Sunday uses the newly rotated week', () => {
  assert.equal(getSatpamShiftForTeam(1, '2026-08-02'), 'Pagi');
  assert.equal(getSatpamShiftForTeam(2, '2026-08-02'), 'Malam');
  assert.equal(getSatpamShiftForTeam(3, '2026-08-02'), 'Sore');
});

test('an instant before Sunday 08:00 Jakarta remains in the previous week', () => {
  assert.equal(
    getSchedulingSunday(new Date('2026-08-02T07:59:59+07:00')).toISOString(),
    new Date('2026-07-26T08:00:00+07:00').toISOString(),
  );
  assert.equal(
    getSchedulingSunday(new Date('2026-08-02T08:00:00+07:00')).toISOString(),
    new Date('2026-08-02T08:00:00+07:00').toISOString(),
  );
});

test('rotation follows Pagi to Malam to Sore on consecutive Sundays', () => {
  assert.equal(getSatpamShiftForTeam(1, '2026-08-02'), 'Pagi');
  assert.equal(getSatpamShiftForTeam(1, '2026-08-09'), 'Malam');
  assert.equal(getSatpamShiftForTeam(1, '2026-08-16'), 'Sore');
  assert.equal(getSatpamShiftForTeam(1, '2026-08-23'), 'Pagi');
});
