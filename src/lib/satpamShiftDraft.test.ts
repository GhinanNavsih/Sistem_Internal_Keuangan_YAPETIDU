import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSatpamShiftPendingDraft,
  SATPAM_SHIFT_DRAFT_STORAGE_VERSION,
  satpamShiftDraftStorageKey,
} from './satpamShiftDraft';

test('Satpam drafts use a versioned, employee-and-date-scoped key', () => {
  assert.equal(SATPAM_SHIFT_DRAFT_STORAGE_VERSION, 3);
  assert.equal(
    satpamShiftDraftStorageKey('employee-2', '2026-08-20'),
    'unipdu:satpam-draft:v3:employee-2:2026-08-20',
  );
});

test('a previous date payload can never hydrate the selected date', () => {
  const raw = JSON.stringify({
    payload: {
      dutyDate: '2026-08-19',
      shiftName: 'Pagi',
      assignments: [
        {
          postId: 'Pos 1',
          employeeId: 'guard-yesterday',
          photoUrl: 'https://example.test/yesterday.jpg',
        },
      ],
    },
  });

  assert.equal(parseSatpamShiftPendingDraft(raw, '2026-08-20'), null);
});

test('a valid same-date pending submission keeps its assignment and photo', () => {
  const raw = JSON.stringify({
    requestId: 'satpam_shift_request',
    savedAt: '2026-08-20T02:30:00.000Z',
    payload: {
      dutyDate: '2026-08-20',
      shiftName: 'Pagi',
      assignments: [
        {
          postId: 'Pos 1',
          employeeId: 'guard-today',
          shiftType: 'Harian',
          photoUrl: 'https://example.test/today.jpg',
        },
      ],
    },
  });

  const parsed = parseSatpamShiftPendingDraft(raw, '2026-08-20');
  assert.equal(parsed?.requestId, 'satpam_shift_request');
  assert.equal(parsed?.payload.assignments[0].employeeId, 'guard-today');
  assert.equal(
    parsed?.payload.assignments[0].photoUrl,
    'https://example.test/today.jpg',
  );
});

test('an extra-officer photo taken before the post/officer are picked still survives', () => {
  const raw = JSON.stringify({
    payload: {
      dutyDate: '2026-08-20',
      assignments: [],
      extraAssignment: {
        postId: '',
        employeeId: '',
        photoUrl: 'https://example.test/lembur-sendiri.jpg',
      },
    },
  });

  const parsed = parseSatpamShiftPendingDraft(raw, '2026-08-20');
  assert.equal(
    parsed?.payload.extraAssignment?.photoUrl,
    'https://example.test/lembur-sendiri.jpg',
  );
  assert.equal(parsed?.payload.extraAssignment?.postId, '');
  assert.equal(parsed?.payload.extraAssignment?.employeeId, '');
});

test('an extra-officer pick with no post yet still survives', () => {
  const raw = JSON.stringify({
    payload: {
      dutyDate: '2026-08-20',
      assignments: [],
      extraAssignment: {
        postId: '',
        employeeId: 'guard-overtime',
      },
    },
  });

  const parsed = parseSatpamShiftPendingDraft(raw, '2026-08-20');
  assert.equal(parsed?.payload.extraAssignment?.employeeId, 'guard-overtime');
  assert.equal(parsed?.payload.extraAssignment?.postId, '');
});

test('a blank extra-officer card with no other progress is not a draft', () => {
  assert.equal(
    parseSatpamShiftPendingDraft(
      JSON.stringify({
        payload: {
          dutyDate: '2026-08-20',
          assignments: [],
          extraAssignment: { postId: '', employeeId: '' },
        },
      }),
      '2026-08-20',
    ),
    null,
  );
});

test('an invalid extra-officer post id is dropped but the rest of the card survives', () => {
  const raw = JSON.stringify({
    payload: {
      dutyDate: '2026-08-20',
      assignments: [],
      extraAssignment: {
        postId: 'Pos 99',
        employeeId: 'guard-overtime',
      },
    },
  });

  const parsed = parseSatpamShiftPendingDraft(raw, '2026-08-20');
  assert.equal(parsed?.payload.extraAssignment?.employeeId, 'guard-overtime');
  assert.equal(parsed?.payload.extraAssignment?.postId, '');
});

test('empty and malformed drafts do not block duty-plan prefill', () => {
  assert.equal(
    parseSatpamShiftPendingDraft(
      JSON.stringify({
        payload: {
          dutyDate: '2026-08-20',
          assignments: [{ postId: 'Pos 1', employeeId: '' }],
        },
      }),
      '2026-08-20',
    ),
    null,
  );
  assert.equal(parseSatpamShiftPendingDraft('{broken', '2026-08-20'), null);
});
