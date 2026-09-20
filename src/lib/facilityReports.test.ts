import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSubmitFacilityReport,
  canTransitionFacilityReport,
  canUploadFacilityRepairProof,
  FACILITY_REPORT_DASHBOARD_PATH,
  FACILITY_REPORT_STATUSES,
  EMPLOYEE_FACILITY_REPORTS_PATH,
  getFacilityReportsPath,
  isBlueCollarFacilityDashboardUser,
  isFacilityReportStatus,
} from './facilityReports';

test('facility reports expose only pending and terminal statuses', () => {
  assert.deepEqual(FACILITY_REPORT_STATUSES, ['pending', 'resolved', 'declined']);
  assert.equal(isFacilityReportStatus('in_progress'), false);
});

test('only Teknisi and Kebersihan honorer profiles use the facility dashboard route', () => {
  assert.equal(
    isBlueCollarFacilityDashboardUser({ role: 'honorer', permittedCategories: [' teknisi '] }),
    true,
  );
  assert.equal(
    isBlueCollarFacilityDashboardUser({ role: 'honorer', permittedCategories: ['KEBERSIHAN'] }),
    true,
  );
  assert.equal(
    isBlueCollarFacilityDashboardUser({ role: 'honorer', permittedCategories: ['KEBERSIHAN_PONTI'] }),
    false,
  );
  assert.equal(
    isBlueCollarFacilityDashboardUser({ role: 'honorer', permittedCategories: ['SATPAM'] }),
    false,
  );
  assert.equal(
    isBlueCollarFacilityDashboardUser({ role: 'ketua_shift_satpam', permittedCategories: ['KEBERSIHAN'] }),
    false,
  );
  assert.equal(
    getFacilityReportsPath({ role: 'honorer', permittedCategories: ['TEKNISI'] }),
    FACILITY_REPORT_DASHBOARD_PATH,
  );
  assert.equal(
    getFacilityReportsPath({ role: 'honorer', permittedCategories: ['SOPIR'] }),
    EMPLOYEE_FACILITY_REPORTS_PATH,
  );
});

test('Teknisi and Kebersihan can repair reports but cannot submit new ones', () => {
  for (const category of ['TEKNISI', 'KEBERSIHAN']) {
    assert.equal(
      canSubmitFacilityReport({ role: 'honorer', permittedCategories: [category] }),
      false,
    );
  }
  assert.equal(
    canSubmitFacilityReport({ role: 'honorer', permittedCategories: ['PEKARYA'] }),
    true,
  );
  assert.equal(canSubmitFacilityReport({ role: 'loyalis', permittedCategories: [] }), true);
  assert.equal(
    canSubmitFacilityReport({ role: 'ketua_shift_satpam', permittedCategories: ['SATPAM'] }),
    true,
  );
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

test('satker_head, super_admin, and blue-collar repairers can upload facility repair proofs', () => {
  assert.equal(canUploadFacilityRepairProof({ role: 'super_admin' }), true);
  assert.equal(canUploadFacilityRepairProof({ role: 'satker_head' }), true);
  assert.equal(
    canUploadFacilityRepairProof({ role: 'honorer', permittedCategories: ['TEKNISI'] }),
    true,
  );
  assert.equal(
    canUploadFacilityRepairProof({ role: 'honorer', permittedCategories: ['KEBERSIHAN'] }),
    true,
  );
  assert.equal(
    canUploadFacilityRepairProof({ role: 'honorer', permittedCategories: ['SATPAM'] }),
    false,
  );
  assert.equal(canUploadFacilityRepairProof({ role: 'loyalis' }), false);
  assert.equal(canUploadFacilityRepairProof(null), false);
});

