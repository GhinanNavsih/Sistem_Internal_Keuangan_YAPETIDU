import * as XLSX from 'xlsx';
import { SuratMasuk, SuratKeluar } from './types';
import { calculateUsiaArsip, formatKodeArsip } from './numbering';
import { KLASIFIKASI_KEARSIPAN_POPULAR } from './constants';

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

  // 1. Sheet SURAT KELUAR (Matches layout of APLIKASI PERSURATAN 2026)
  const keluarRows = suratKeluarList.map((item, idx) => {
    const seq = item.nomorUrut || idx + 1;
    const usia = item.usiaArsip || calculateUsiaArsip(item.tanggalSurat);
    const arsip = item.kodeArsip || formatKodeArsip({
      type: 'keluar',
      institutionScope: item.institutionScope || 'UNIPDU',
      sequenceNumber: seq,
    });

    return {
      'Nomor Urut': seq,
      'Alamat Penerima': item.tujuan,
      'Nomor Surat': item.nomorSurat,
      'Tanggal Surat': item.tanggalSurat,
      'Hal': item.perihal,
      'Kode Surat': item.kodeSurat || item.kategori || 'AU',
      'Sifat Surat': (item.sifat || 'biasa').toUpperCase(),
      'Kode Arsip': arsip,
      'Usia Arsip': usia,
      'Penandatangan': item.penandatanganNama ? `${item.penandatanganNama} (${item.penandatanganJabatan})` : '-',
      'Status': item.status.toUpperCase(),
      'Lampiran': item.attachments?.length ? `${item.attachments.length} berkas` : (item.lampiranKeterangan || '-'),
    };
  });

  const wsKeluar = XLSX.utils.json_to_sheet(keluarRows);
  XLSX.utils.book_append_sheet(wb, wsKeluar, 'SURAT KELUAR');

  // 2. Sheet SURAT MASUK (Matches layout of APLIKASI PERSURATAN 2026)
  const masukRows = suratMasukList.map((item, idx) => {
    const seq = item.nomorUrut || idx + 1;
    const usia = item.usiaArsip || calculateUsiaArsip(item.tanggalSurat);
    const arsip = item.kodeArsip || formatKodeArsip({
      type: 'masuk',
      institutionScope: item.institutionScope || 'UNIPDU',
      sequenceNumber: seq,
    });

    return {
      'Nomor Urut': seq,
      'Alamat Pengirim': item.pengirim,
      'Nomor Surat': item.nomorSurat,
      'Tanggal Surat': item.tanggalSurat,
      'Tanggal Diterima': item.tanggalDiterima,
      'Perihal': item.perihal,
      'Kode Surat': item.kodeSurat || 'BU',
      'Sifat Surat': (item.sifat || 'biasa').toUpperCase(),
      'Kode Arsip': arsip,
      'Usia Arsip': usia,
      'Status': item.status.replace(/_/g, ' ').toUpperCase(),
      'Instruksi Disposisi': item.disposisi?.instruksi || '-',
      'Diteruskan Kepada': item.disposisi?.diteruskanKepada || '-',
      'Catatan Disposisi': item.disposisi?.catatan || '-',
      'Lampiran': item.attachments?.length ? `${item.attachments.length} berkas` : 'Tidak ada',
    };
  });

  const wsMasuk = XLSX.utils.json_to_sheet(masukRows);
  XLSX.utils.book_append_sheet(wb, wsMasuk, 'SURAT MASUK');

  // 3. Sheet ENTRY DATA (Master configuration header)
  const entryDataRows = [
    { 'Parameter': 'Satuan Kerja', 'Nilai': satkerName || 'UNIVERSITAS PESANTREN TINGGI DARUL \'ULUM JOMBANG' },
    { 'Parameter': 'Fakultas / Unit', 'Nilai': 'Sekretariat Rektorat' },
    { 'Parameter': 'Alamat', 'Nilai': 'PP. Darul Ulum Tromol Pos 10 Jombang 61481' },
    { 'Parameter': 'Nomor Telepon / Fax', 'Nilai': '(0321) 876771, 873655 Fax: (0321) 876771' },
    { 'Parameter': 'Website & Email', 'Nilai': 'www.unipdu.ac.id | rektorat@unipdu.ac.id' },
    { 'Parameter': 'Tahun Arsip', 'Nilai': `TAHUN ${new Date().getFullYear()}` },
  ];
  const wsEntry = XLSX.utils.json_to_sheet(entryDataRows);
  XLSX.utils.book_append_sheet(wb, wsEntry, 'ENTRY DATA');

  // 4. Sheet KLASIFIKASI KEARSIPAN (Indonesian standard 3-digit basic classification)
  const klasifikasiRows = KLASIFIKASI_KEARSIPAN_POPULAR.map((k) => ({
    'Kode Dasar': k.code,
    'Uraian Klasifikasi': k.name,
  }));
  const wsKlas = XLSX.utils.json_to_sheet(klasifikasiRows);
  XLSX.utils.book_append_sheet(wb, wsKlas, 'KLASIFIKASI KEARSIPAN');

  const safeSatker = (satkerName || 'SatKer').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `APLIKASI_PERSURATAN_${safeSatker}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
