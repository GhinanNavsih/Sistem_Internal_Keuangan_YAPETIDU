import { parseProposalQty, type ProposalExpenseRow } from './proposalExpenseReports';

type BudgetLine = Pick<ProposalExpenseRow, 'rincianQty' | 'rincianRate'>;

export function getProposalLineAmount(row: BudgetLine): number {
  return parseProposalQty(row.rincianQty) * (row.rincianRate || 0);
}

export function getProposalBudget({
  pemasukanRows = [],
  pengeluaranRows = [],
  yayasanPercentage,
  unipduPercentage,
  kepanitiaaanPercentage,
}: {
  pemasukanRows?: readonly BudgetLine[];
  pengeluaranRows?: readonly (BudgetLine & Pick<ProposalExpenseRow, 'type'>)[];
  yayasanPercentage?: number;
  unipduPercentage?: number;
  kepanitiaaanPercentage?: number;
}) {
  const yayasanPct = yayasanPercentage ?? 20;
  const unipduPct = unipduPercentage ?? 20;
  const kepanitiaanPct = kepanitiaaanPercentage ?? 10;
  const totalPemasukanAnggaran = pemasukanRows.reduce((sum, row) => sum + getProposalLineAmount(row), 0);
  const yayasanAnggaran = totalPemasukanAnggaran * (yayasanPct / 100);
  const unipduAnggaran = totalPemasukanAnggaran * (unipduPct / 100);
  const totalPengembanganAnggaran = yayasanAnggaran + unipduAnggaran;
  const danaOperasionalAnggaran = totalPemasukanAnggaran - totalPengembanganAnggaran;

  // A description is optional, including for items already under a named group.
  const jumlahPengeluaranAnggaran = pengeluaranRows
    .filter(row => row.type === 'item')
    .reduce((sum, row) => sum + getProposalLineAmount(row), 0);
  const kepanitiaanAnggaran = jumlahPengeluaranAnggaran * (kepanitiaanPct / 100);
  const totalPengeluaranAnggaran = jumlahPengeluaranAnggaran + kepanitiaanAnggaran;
  const sisaAnggaran = danaOperasionalAnggaran - totalPengeluaranAnggaran;

  return {
    yayasanPct,
    unipduPct,
    kepanitiaanPct,
    totalPemasukanAnggaran,
    yayasanAnggaran,
    unipduAnggaran,
    totalPengembanganAnggaran,
    danaOperasionalAnggaran,
    jumlahPengeluaranAnggaran,
    kepanitiaanAnggaran,
    totalPengeluaranAnggaran,
    sisaAnggaran,
  };
}
