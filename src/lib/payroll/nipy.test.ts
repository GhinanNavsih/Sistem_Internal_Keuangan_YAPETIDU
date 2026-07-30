import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPekaryaNipyPreview,
  formatPekaryaNipyDate,
  generatePekaryaNipy,
  isValidPekaryaNipy,
  pekaryaNipyGroup,
} from './nipy';

test('Pekarya NIPY formula maps every supported category', () => {
  assert.equal(generatePekaryaNipy('SOPIR', '1998-08-01', 1), '14010898001');
  assert.equal(generatePekaryaNipy('SATPAM', '1997-12-01', 1), '15011297001');
  assert.equal(generatePekaryaNipy('TEKNISI', '2006-01-01', 2), '16010106002');
  assert.equal(
    generatePekaryaNipy('KEBERSIHAN_PONTI', '1989-02-01', 15),
    '13010289015',
  );
  assert.equal(pekaryaNipyGroup('KEBERSIHAN_IC'), 'KEBERSIHAN');
  assert.equal(formatPekaryaNipyDate('2000-10-01'), '011000');
});

test('Pekarya NIPY formula rejects invalid dates, categories, and sequences', () => {
  assert.throws(() => generatePekaryaNipy('LAINNYA', '2026-08-01', 1));
  assert.throws(() => generatePekaryaNipy('SOPIR', '2026-02-30', 1));
  assert.throws(() => generatePekaryaNipy('SOPIR', '2026-08-01', 0));
  assert.throws(() => generatePekaryaNipy('SOPIR', '2026-08-01', 1000));
  assert.equal(isValidPekaryaNipy('14010898001'), true);
  assert.equal(isValidPekaryaNipy('1401089801'), false);
});

test('initial preview sequences active employees by BC order within category', () => {
  const preview = buildPekaryaNipyPreview([
    {
      employeeId: 'BC_010',
      name: 'Satpam Satu',
      category: 'SATPAM',
      startDate: '1997-12-01',
      active: true,
      nipy: '',
    },
    {
      employeeId: 'BC_002',
      name: 'Sopir Dua',
      category: 'SOPIR',
      startDate: '2000-10-01',
      active: true,
      nipy: '',
    },
    {
      employeeId: 'BC_001',
      name: 'Sopir Satu',
      category: 'SOPIR',
      startDate: '1998-08-01',
      active: true,
      nipy: '',
    },
    {
      employeeId: 'BC_003',
      name: 'Nonaktif',
      category: 'SOPIR',
      startDate: '2001-01-01',
      active: false,
      nipy: '',
    },
  ]);
  assert.equal(preview.summary.active, 3);
  assert.equal(preview.summary.ready, 3);
  assert.equal(preview.items.find((item) => item.employeeId === 'BC_001')?.proposedNipy, '14010898001');
  assert.equal(preview.items.find((item) => item.employeeId === 'BC_002')?.sequence, 2);
  assert.equal(preview.items.find((item) => item.employeeId === 'BC_010')?.sequence, 1);
  assert.deepEqual(preview.counters, {
    KEBERSIHAN: 0,
    SOPIR: 2,
    SATPAM: 1,
    TEKNISI: 0,
  });
});

test('missing dates reserve cleaning positions without shifting later employees', () => {
  const preview = buildPekaryaNipyPreview([
    {
      employeeId: 'BC_052',
      name: 'Sebelas',
      category: 'KEBERSIHAN',
      startDate: '2021-07-01',
      active: true,
      nipy: '',
      assignment: {
        categoryGroup: 'KEBERSIHAN',
        sequence: 11,
      },
    },
    {
      employeeId: 'BC_053',
      name: 'Dua Belas',
      category: 'KEBERSIHAN_IC',
      startDate: null,
      active: true,
      nipy: '',
      assignment: {
        categoryGroup: 'KEBERSIHAN',
        sequence: 12,
      },
    },
    {
      employeeId: 'BC_054',
      name: 'Tiga Belas',
      category: 'KEBERSIHAN_IC',
      startDate: null,
      active: true,
      nipy: '',
      assignment: {
        categoryGroup: 'KEBERSIHAN',
        sequence: 13,
      },
    },
    {
      employeeId: 'BC_062',
      name: 'Empat Belas',
      category: 'KEBERSIHAN',
      startDate: '2024-12-26',
      active: true,
      nipy: '',
      assignment: {
        categoryGroup: 'KEBERSIHAN',
        sequence: 14,
      },
    },
  ], {
    initialized: true,
    counters: { KEBERSIHAN: 14 },
  });
  assert.equal(preview.summary.reserved, 2);
  assert.equal(preview.items.find((item) => item.employeeId === 'BC_053')?.sequence, 12);
  assert.equal(preview.items.find((item) => item.employeeId === 'BC_062')?.proposedNipy, '13261224014');
});

test('initialized preview allocates the next category sequence', () => {
  const preview = buildPekaryaNipyPreview(
    [
      {
        employeeId: 'BC_067',
        name: 'Pegawai Baru',
        category: 'SOPIR',
        startDate: '2026-08-01',
        active: true,
        nipy: '',
      },
    ],
    { initialized: true, counters: { SOPIR: 9 } },
  );
  assert.equal(preview.items[0].sequence, 10);
  assert.equal(preview.items[0].proposedNipy, '14010826010');
  assert.equal(preview.counters.SOPIR, 10);
});

test('issued NIPY remains existing when its source data later changes', () => {
  const preview = buildPekaryaNipyPreview(
    [
      {
        employeeId: 'BC_001',
        name: 'Pegawai',
        category: 'TEKNISI',
        startDate: '2000-01-01',
        active: true,
        nipy: '14010898001',
        assignment: {
          status: 'issued',
          categoryGroup: 'SOPIR',
          sourceStartDate: '1998-08-01',
          sequence: 1,
        },
      },
    ],
    { initialized: true, counters: { SOPIR: 9, TEKNISI: 2 } },
  );
  assert.equal(preview.items[0].state, 'existing');
  assert.equal(preview.items[0].needsWrite, false);
  assert.equal(
    preview.items[0].reasonCode,
    'SOURCE_CHANGED_AFTER_ISSUANCE',
  );
  assert.equal(preview.summary.conflicts, 0);
});
