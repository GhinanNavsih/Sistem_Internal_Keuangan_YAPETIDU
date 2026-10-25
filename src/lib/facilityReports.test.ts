import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSubmitFacilityReport,
  canTransitionFacilityReport,
  canUploadFacilityRepairProof,
  canViewFacilityNotifications,
  compareFacilityReports,
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

test('compareFacilityReports orders pending reports above resolved and declined, and newest to oldest within status', () => {
  const reports = [
    { id: '1', status: 'resolved', reportedDate: '2026-10-24', reportedAtMillis: 2000 },
    { id: '2', status: 'pending', reportedDate: '2026-10-20', reportedAtMillis: 1000 },
    { id: '3', status: 'pending', reportedDate: '2026-10-24', reportedAtMillis: 3000 },
    { id: '4', status: 'declined', reportedDate: '2026-10-25', reportedAtMillis: 4000 },
    { id: '5', status: 'resolved', reportedDate: '2026-10-19', reportedAtMillis: 500 },
  ];

  const sorted = [...reports].sort(compareFacilityReports);

  // Pending first (newest to oldest: 3 then 2), then resolved (newest to oldest: 1 then 5), then declined (4)
  assert.deepEqual(
    sorted.map((r) => r.id),
    ['3', '2', '1', '5', '4'],
  );
});

test('compareFacilityReports falls back to reportedDate when reportedAtMillis is absent', () => {
  const reports = [
    { id: '1', status: 'pending', reportedDate: '2026-10-18' },
    { id: '2', status: 'pending', reportedDate: '2026-10-22' },
    { id: '3', status: 'resolved', reportedDate: '2026-10-25' },
  ];

  const sorted = [...reports].sort(compareFacilityReports);

  assert.deepEqual(
    sorted.map((r) => r.id),
    ['2', '1', '3'],
  );
});

test('canViewFacilityNotifications allows satker pekarya heads, teknisi, kebersihan, and super admin only', () => {
  // Satker Pekarya authorized for facility repair (Teknisi / Kebersihan)
  assert.equal(
    canViewFacilityNotifications({ role: 'satker_head', permittedCategories: ['TEKNISI'] }),
    true,
  );
  assert.equal(
    canViewFacilityNotifications({ role: 'satker_head', permittedCategories: ['kebersihan'] }),
    true,
  );
  assert.equal(
    canViewFacilityNotifications({ role: 'satker_head', permittedCategories: ['SOPIR'] }),
    false,
  );

  // Satker Loyalis head
  assert.equal(
    canViewFacilityNotifications({ role: 'satker_head_loyalis', permittedCategories: ['TEKNISI'] }),
    false,
  );

  // Honorer repairers: Teknisi and Kebersihan
  assert.equal(
    canViewFacilityNotifications({ role: 'honorer', permittedCategories: ['TEKNISI'] }),
    true,
  );
  assert.equal(
    canViewFacilityNotifications({ role: 'honorer', permittedCategories: ['KEBERSIHAN'] }),
    true,
  );
  assert.equal(
    canViewFacilityNotifications({ role: 'honorer', permittedCategories: ['SATPAM'] }),
    false,
  );
  assert.equal(
    canViewFacilityNotifications({ role: 'honorer', permittedCategories: ['SOPIR'] }),
    false,
  );

  // Loyalis and other roles
  assert.equal(canViewFacilityNotifications({ role: 'loyalis' }), false);
  assert.equal(canViewFacilityNotifications({ role: 'super_admin' }), true);
  assert.equal(canViewFacilityNotifications(null), false);
});



