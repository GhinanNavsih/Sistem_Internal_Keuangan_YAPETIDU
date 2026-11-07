import * as XLSX from 'xlsx';
import { SuratMasuk, SuratKeluar } from './types';

export function exportBukuAgendaToExcel({
  satkerName,
  suratMasukList,
  suratKeluarList,
}: {
  satkerName: string;
  suratMasukList: SuratMasuk[];
  suratKeluarList: SuratKeluar[];
}): void {
  const wb = XLSX.utils.book_new();

  // 1. Sheet Surat Masuk
  const masukRows = suratMasukList.map((item, idx) => ({
    'No.': idx + 1,
    'Tanggal Diterima': item.tanggalDiterima,
    'Nomor Surat': item.nomorSurat,
    'Tanggal Surat': item.tanggalSurat,
    'Pengirim': item.pengirim,
    'Penerima': item.penerima,
    'Perihal': item.perihal,
    'Sifat': item.sifat.toUpperCase(),
    'Kategori': item.kategori,
    'Status': item.status.replace(/_/g, ' ').toUpperCase(),
    'Instruksi Disposisi': item.disposisi?.instruksi || '-',
    'Diteruskan Kepada': item.disposisi?.diteruskanKepada || '-',
    'Catatan Disposisi': item.disposisi?.catatan || '-',
    'Lampiran': item.attachments?.length ? `${item.attachments.length} berkas` : 'Tidak ada',
  }));

  const wsMasuk = XLSX.utils.json_to_sheet(masukRows);
  XLSX.utils.book_append_sheet(wb, wsMasuk, 'Surat Masuk');

  // 2. Sheet Surat Keluar
  const keluarRows = suratKeluarList.map((item, idx) => ({
    'No.': idx + 1,
    'Tanggal Surat': item.tanggalSurat,
    'Nomor Surat': item.nomorSurat,
    'Tujuan / Penerima': item.tujuan,
    'Perihal': item.perihal,
    'Sifat': item.sifat.toUpperCase(),
    'Kategori': item.kategori,
    'Penandatangan': item.penandatanganNama ? `${item.penandatanganNama} (${item.penandatanganJabatan})` : '-',
    'Status': item.status.toUpperCase(),
    'Ringkasan': item.ringkasan || '-',
    'Lampiran': item.attachments?.length ? `${item.attachments.length} berkas` : (item.lampiranKeterangan || '-'),
  }));

  const wsKeluar = XLSX.utils.json_to_sheet(keluarRows);
  XLSX.utils.book_append_sheet(wb, wsKeluar, 'Surat Keluar');

  const safeSatker = (satkerName || 'SatKer').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Buku_Agenda_Surat_${safeSatker}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
