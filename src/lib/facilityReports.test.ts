import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canTransitionFacilityReport,
  FACILITY_REPORT_STATUSES,
  isFacilityReportStatus,
} from './facilityReports';

test('facility reports expose only pending and terminal statuses', () => {
  assert.deepEqual(FACILITY_REPORT_STATUSES, ['pending', 'resolved', 'declined']);
  assert.equal(isFacilityReportStatus('in_progress'), false);
});

test('pending reports can be closed as resolved or declined', () => {
  assert.equal(canTransitionFacilityReport('pending', 'resolved'), true);
  assert.equal(canTransitionFacilityReport('pending', 'declined'), true);
  assert.equal(canTransitionFacilityReport('pending', 'pending'), false);
});

test('terminal facility report statuses cannot be changed', () => {
  assert.equal(canTransitionFacilityReport('resolved', 'declined'), false);
  assert.equal(canTransitionFacilityReport('declined', 'resolved'), false);
});
