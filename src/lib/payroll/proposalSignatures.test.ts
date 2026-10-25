import assert from 'node:assert/strict';
import test from 'node:test';
import { jsPDF } from 'jspdf';
import { generateProposalKegiatanPdf } from '@/utils/generateProposalKegiatanPdf';
import { renderSignaturesAt } from '@/utils/generateLpjExpenseReportPdf';
import { createProposalSignatures, getPrintableProposalSignatures, loadProposalSignatureState, normalizeProposalSignatures } from './proposalSignatures';

const proposal = createProposalSignatures().map((slot, index) => ({
  ...slot, name: `Loyalis ${index + 1}`, employeeId: `Loyalis_${index + 1}`,
}));

test('new proposals and records without signatures start with three independent default slots', () => {
  const first = loadProposalSignatureState({});
  const second = loadProposalSignatureState({});
  assert.equal(first.proposalSignatures.length, 3);
  assert.equal(first.lpjSignaturesFollowProposal, true);
  assert.deepEqual(first.lpjSignatures, first.proposalSignatures);
  first.proposalSignatures[0].name = 'Edited';
  assert.equal(second.proposalSignatures[0].name, '');
});

test('legacy empty LPJ placeholders inherit the proposal while customized LPJ signers survive', () => {
  const lpjSignatures = [
    { label: '', name: '', title: 'Wakil Rektor Bid. Keuangan, SDM dan Umum', searchText: '', showDropdown: true },
    { label: '', name: '', title: '' },
    { label: '', name: '', title: 'Direktur' },
  ];
  const inherited = loadProposalSignatureState({ signatures: proposal, lpjSignatures });
  assert.equal(inherited.lpjSignaturesFollowProposal, true);
  assert.deepEqual(inherited.lpjSignatures, proposal);

  const customized = loadProposalSignatureState({
    signatures: proposal,
    lpjSignatures: lpjSignatures.map((slot, index) => index === 2 ? { ...slot, name: 'Dekan Lama', title: 'Dekan FAI' } : slot),
  });
  assert.equal(customized.lpjSignaturesFollowProposal, false);
  assert.equal(customized.lpjSignatures[2].name, 'Dekan Lama');
  assert.equal(customized.lpjSignatures[2].title, 'Dekan FAI');
});

test('a customized legacy title without a name remains LPJ-specific', () => {
  const state = loadProposalSignatureState({
    signatures: proposal,
    lpjSignatures: [{ name: '', title: 'Dekan FAI' }],
  });
  assert.equal(state.lpjSignaturesFollowProposal, false);
  assert.equal(state.lpjSignatures[0].title, 'Dekan FAI');
});

test('persisted follow mode uses the latest proposal after reopening, including cleared names', () => {
  const changedProposal = proposal.map((slot, index) => index === 0 ? { ...slot, name: '' } : slot);
  const state = loadProposalSignatureState(JSON.parse(JSON.stringify({
    signatures: changedProposal, lpjSignatures: proposal, lpjSignaturesFollowProposal: true,
  })));
  assert.equal(state.lpjSignaturesFollowProposal, true);
  assert.deepEqual(state.lpjSignatures, changedProposal);
});

test('LPJ overrides remain independent across saving and proposal changes', () => {
  const overrides = proposal.map((slot, index) => index === 1 ? { ...slot, name: 'Loyalis pengganti', title: 'Ketua LPJ' } : slot);
  const state = loadProposalSignatureState(JSON.parse(JSON.stringify({
    signatures: createProposalSignatures(), lpjSignatures: overrides, lpjSignaturesFollowProposal: false,
  })));
  assert.equal(state.lpjSignaturesFollowProposal, false);
  assert.deepEqual(state.lpjSignatures, overrides);
  assert.deepEqual(state.proposalSignatures, createProposalSignatures());

  const cleared = loadProposalSignatureState({ lpjSignatures: createProposalSignatures(), lpjSignaturesFollowProposal: false });
  assert.equal(cleared.lpjSignaturesFollowProposal, false);
});

test('stored signature snapshots omit search UI state and preserve names independently of employee master data', () => {
  const result = normalizeProposalSignatures([
    { label: '', name: 'Nama beserta gelar', title: 'Jabatan cetak', employeeId: 'Loyalis_42', searchText: 'unfinished search', showDropdown: true },
    null,
  ]);
  assert.deepEqual(result[0], { label: '', name: 'Nama beserta gelar', title: 'Jabatan cetak', employeeId: 'Loyalis_42' });
  assert.equal(result[1].title, 'Ketua BAK');
  assert.equal(result.length, 3);
});

test('unnamed positions are omitted from PDFs even when their default title remains', () => {
  const slots = proposal.map((slot, index) => index === 1 ? { ...slot, name: '  ' } : slot);
  assert.deepEqual(getPrintableProposalSignatures(slots), [slots[0], slots[2]]);
  assert.equal(slots.length, 3, 'editing slots must keep their original positions');
  assert.deepEqual(getPrintableProposalSignatures(createProposalSignatures()), []);
});

test('proposal PDF renders only named signature spots for any omitted position', () => {
  for (const missingIndex of [0, 1, 2]) {
    const slots = proposal.map((slot, index) => index === missingIndex ? { ...slot, name: '', title: '' } : slot);
    const pdf = generateProposalKegiatanPdf({
      reportName: 'Signature regression', period: 'Oktober 2026', signatures: slots,
    }, false).output();
    assert.equal(pdf.split('(Pimpinan / Pejabat Berwenang)').length - 1, 2);
    assert.equal(pdf.includes(`(${proposal[missingIndex].name})`), false);
    assert.equal(pdf.includes('(Mengetahui,)'), false);
    for (const signature of getPrintableProposalSignatures(slots)) {
      assert.ok(pdf.includes(`(${signature.name})`));
    }
  }
  const empty = generateProposalKegiatanPdf({
    reportName: 'No signatures', period: 'Oktober 2026', signatures: createProposalSignatures(),
  }, false).output();
  assert.equal(empty.includes('(Pimpinan / Pejabat Berwenang)'), false);
});

test('LPJ signature rendering centers the remaining signers and emits nothing for empty positions', () => {
  const doc = new jsPDF({ unit: 'mm', format: [210, 330] });
  const slots = proposal.map((slot, index) => index === 1 ? { ...slot, name: '' } : slot);
  renderSignaturesAt(doc, slots, 100);
  const pdf = doc.output();
  assert.equal(pdf.includes(`(${proposal[1].name})`), false);
  assert.equal(pdf.includes('(Ketua BAK)'), false);
  assert.equal(pdf.includes('(____________________)'), false);
  for (const [index, signature] of getPrintableProposalSignatures(slots).entries()) {
    const expectedCenterMm = 15 + (index + 0.5) * 90;
    const expectedLeftPt = (expectedCenterMm - doc.getTextWidth(signature.name) / 2) * doc.internal.scaleFactor;
    const textCommand = pdf.match(new RegExp(`([\\d.]+) [\\d.]+ Td\\n\\(${signature.name}\\) Tj`));
    assert.ok(textCommand, `missing signature text: ${signature.name}`);
    assert.ok(Math.abs(Number(textCommand[1]) - expectedLeftPt) < 0.001);
  }

  const emptyDoc = new jsPDF();
  renderSignaturesAt(emptyDoc, createProposalSignatures(), 1000);
  assert.equal(emptyDoc.getNumberOfPages(), 1, 'empty signatures must not add a page');
  assert.equal(emptyDoc.output().includes('(Mengetahui,)'), false);
});
