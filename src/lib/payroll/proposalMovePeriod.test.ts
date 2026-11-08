import assert from 'node:assert/strict';
import test from 'node:test';

export function canMoveProposalDraft(
  actor: { role: string; uid: string },
  proposal: { submittedBy: string; status: string; period: string },
  targetPeriod: string,
  targetPeriodClosed: boolean,
): { allowed: boolean; reason?: string } {
  if (!['super_admin', 'finance_verifier', 'satker_head_loyalis'].includes(actor.role)) {
    return { allowed: false, reason: 'Akun ini tidak memiliki akses proposal kegiatan.' };
  }
  const isFinance = actor.role === 'super_admin' || actor.role === 'finance_verifier';
  if (!isFinance && proposal.submittedBy !== actor.uid) {
    return { allowed: false, reason: 'Proposal ini bukan milik akun Anda.' };
  }
  if (proposal.status !== 'proposal_draft') {
    return { allowed: false, reason: 'Hanya proposal berstatus draft yang dapat dipindahkan ke periode lain.' };
  }
  if (proposal.period === targetPeriod) {
    return { allowed: false, reason: 'Proposal sudah berada di periode tujuan.' };
  }
  if (targetPeriodClosed) {
    return { allowed: false, reason: 'Periode tujuan sudah ditutup.' };
  }
  return { allowed: true };
}

export function formatClonedProposalName(pastName: string, targetYear: number): string {
  let nextName = pastName || '';
  if (nextName.includes('2025')) {
    nextName = nextName.replace('2025', String(targetYear));
  } else if (nextName.includes('2024')) {
    nextName = nextName.replace('2024', String(targetYear));
  } else if (!nextName.includes(String(targetYear))) {
    nextName = `${nextName} ${targetYear}`;
  }
  return nextName;
}

test('only proposal_draft can be moved to another period', () => {
  const actor = { role: 'satker_head_loyalis', uid: 'user-1' };
  const draft = { submittedBy: 'user-1', status: 'proposal_draft', period: '2026-10' };
  const submitted = { submittedBy: 'user-1', status: 'proposal_submitted', period: '2026-10' };
  const approved = { submittedBy: 'user-1', status: 'proposal_approved', period: '2026-10' };

  assert.equal(canMoveProposalDraft(actor, draft, '2026-11', false).allowed, true);
  assert.equal(canMoveProposalDraft(actor, submitted, '2026-11', false).allowed, false);
  assert.equal(canMoveProposalDraft(actor, approved, '2026-11', false).allowed, false);
});

test('moving to a closed target period is rejected', () => {
  const actor = { role: 'satker_head_loyalis', uid: 'user-1' };
  const draft = { submittedBy: 'user-1', status: 'proposal_draft', period: '2026-10' };

  assert.equal(canMoveProposalDraft(actor, draft, '2026-09', true).allowed, false);
  assert.equal(canMoveProposalDraft(actor, draft, '2026-09', true).reason, 'Periode tujuan sudah ditutup.');
});

test('moving to the same period is rejected', () => {
  const actor = { role: 'satker_head_loyalis', uid: 'user-1' };
  const draft = { submittedBy: 'user-1', status: 'proposal_draft', period: '2026-10' };

  assert.equal(canMoveProposalDraft(actor, draft, '2026-10', false).allowed, false);
});

test('satker head cannot move someone else draft', () => {
  const actor = { role: 'satker_head_loyalis', uid: 'user-1' };
  const othersDraft = { submittedBy: 'user-2', status: 'proposal_draft', period: '2026-10' };

  assert.equal(canMoveProposalDraft(actor, othersDraft, '2026-11', false).allowed, false);
  assert.equal(canMoveProposalDraft(actor, othersDraft, '2026-11', false).reason, 'Proposal ini bukan milik akun Anda.');
});

test('super admin can move any satker draft', () => {
  const admin = { role: 'super_admin', uid: 'admin-1' };
  const draft = { submittedBy: 'user-2', status: 'proposal_draft', period: '2026-10' };

  assert.equal(canMoveProposalDraft(admin, draft, '2026-11', false).allowed, true);
});

test('cloned proposal name does not duplicate existing year', () => {
  assert.equal(
    formatClonedProposalName('ANGGARAN PAS (PRATIKUM AHWALUS SYAKHSIYAH) TA 2026/2027', 2026),
    'ANGGARAN PAS (PRATIKUM AHWALUS SYAKHSIYAH) TA 2026/2027',
  );
  assert.equal(
    formatClonedProposalName('Reuni Akbar 2025', 2026),
    'Reuni Akbar 2026',
  );
  assert.equal(
    formatClonedProposalName('Seminar Nasional', 2026),
    'Seminar Nasional 2026',
  );
});
