import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPLOYEE_ACTIVITY_PATHS,
  SOPIR_JOURNEY_REPORT_PATH,
  canAccessEmployeeActivityPath,
  getEmployeeActivitiesPath,
  getEmployeeActivityWorkflow,
  getEmployeeActivityWorkflowFromPath,
  getEmployeeRouteRedirect,
  isEmployeeActivityPath,
} from './employeeActivities';

test('Ketua Shift always resolves to the Satpam workflow', () => {
  assert.equal(
    getEmployeeActivitiesPath({
      role: 'ketua_shift_satpam',
      permittedCategories: [],
    }),
    EMPLOYEE_ACTIVITY_PATHS.satpam,
  );
});

test('Satpam takes priority over Sopir for multi-category profiles', () => {
  assert.equal(
    getEmployeeActivityWorkflow({
      role: 'honorer',
      permittedCategories: ['sopir', ' SATPAM '],
    }),
    'satpam',
  );
});

test('Sopir resolves to the Sopir workflow', () => {
  assert.equal(
    getEmployeeActivitiesPath({
      role: 'honorer',
      permittedCategories: ['SOPIR'],
    }),
    EMPLOYEE_ACTIVITY_PATHS.sopir,
  );
});

test('Sopir resolution ignores category order and casing', () => {
  // Regression guard: driver-history and the Sopir journey-report page each
  // derived their own `permittedCategories[0] === 'SOPIR'` check. That denied a
  // legitimate Sopir whose SOPIR category was not stored first — the route guard
  // let them in, then the page itself showed "Akses Ditolak" / rendered blank.
  // Every consumer must delegate to the resolver instead of indexing the array.
  for (const permittedCategories of [
    ['SOPIR'],
    ['KEBERSIHAN', 'SOPIR'],
    ['PONTI', ' sopir '],
  ]) {
    const profile = { role: 'honorer', permittedCategories };
    assert.equal(getEmployeeActivityWorkflow(profile), 'sopir');
    assert.equal(getEmployeeRouteRedirect(profile, '/employee/driver-history'), null);
  }
});

test('a Satpam-and-Sopir profile is kept out of the driver-only pages', () => {
  // The nav menu must gate its "Riwayat Perjalanan" link on the resolved
  // workflow, not on bare SOPIR membership: Satpam wins, so this profile would
  // otherwise be offered a link that the route guard bounces straight back.
  const both = { role: 'honorer', permittedCategories: ['SATPAM', 'SOPIR'] };
  assert.equal(getEmployeeActivityWorkflow(both), 'satpam');
  assert.equal(
    getEmployeeRouteRedirect(both, '/employee/driver-history'),
    EMPLOYEE_ACTIVITY_PATHS.satpam,
  );
});

test('Kebersihan, Teknisi, unknown, and missing categories use Pekarya', () => {
  for (const categories of [
    ['KEBERSIHAN'],
    ['TEKNISI'],
    ['PONTI'],
    ['CATEGORY_FROM_A_FUTURE_RELEASE'],
    [],
  ]) {
    assert.equal(
      getEmployeeActivitiesPath({
        role: 'honorer',
        permittedCategories: categories,
      }),
      EMPLOYEE_ACTIVITY_PATHS.pekarya,
    );
  }
});

test('only the resolved workflow and its supported nested route are accessible', () => {
  const sopir = { role: 'honorer', permittedCategories: ['SOPIR'] };
  assert.equal(
    canAccessEmployeeActivityPath(sopir, EMPLOYEE_ACTIVITY_PATHS.sopir),
    true,
  );
  assert.equal(
    canAccessEmployeeActivityPath(sopir, SOPIR_JOURNEY_REPORT_PATH),
    true,
  );
  assert.equal(
    canAccessEmployeeActivityPath(sopir, EMPLOYEE_ACTIVITY_PATHS.satpam),
    false,
  );
});

test('category authorization redirects employees away from another workflow', () => {
  const pekarya = {
    role: 'honorer',
    permittedCategories: ['KEBERSIHAN'],
  };
  assert.equal(
    getEmployeeRouteRedirect(pekarya, EMPLOYEE_ACTIVITY_PATHS.satpam),
    EMPLOYEE_ACTIVITY_PATHS.pekarya,
  );
  assert.equal(
    getEmployeeRouteRedirect(pekarya, '/employee/driver-history'),
    EMPLOYEE_ACTIVITY_PATHS.pekarya,
  );
});

test('Ketua Shift can use Satpam support pages but not Sopir pages', () => {
  const ketua = {
    role: 'ketua_shift_satpam',
    permittedCategories: ['SATPAM'],
  };
  assert.equal(
    getEmployeeRouteRedirect(ketua, '/employee/satpam-duty-plan'),
    null,
  );
  assert.equal(getEmployeeRouteRedirect(ketua, '/employee/leave'), null);
  assert.equal(
    getEmployeeRouteRedirect(ketua, SOPIR_JOURNEY_REPORT_PATH),
    EMPLOYEE_ACTIVITY_PATHS.satpam,
  );
});

test('retired activity URLs are not recognized as compatibility routes', () => {
  assert.equal(getEmployeeActivityWorkflowFromPath('/employee/activities'), null);
  assert.equal(
    getEmployeeActivityWorkflowFromPath('/employee/activities/journey-report'),
    null,
  );
  assert.equal(isEmployeeActivityPath('/employee/activities'), false);
  assert.equal(
    getEmployeeRouteRedirect(
      { role: 'honorer', permittedCategories: ['SOPIR'] },
      '/employee/activities',
    ),
    null,
  );
});

test('path matching tolerates query strings and trailing slashes', () => {
  assert.equal(
    getEmployeeActivityWorkflowFromPath(
      `${SOPIR_JOURNEY_REPORT_PATH}/?id=journey-1`,
    ),
    'sopir',
  );
});
