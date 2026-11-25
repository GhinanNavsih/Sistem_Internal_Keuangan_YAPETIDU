/** What the AI reads from a scanned outgoing letter. */
export interface ExtractedSuratKeluar {
  nomorSurat: string;
  tanggalSurat: string;
  tujuan: string;
  perihal: string;
  lampiranKeterangan: string;
  penandatanganNama: string;
  penandatanganJabatan: string;
  ringkasan: string;
}

/** Treat model output as untrusted; absent and invalid values stay blank. */
export function normalizeExtractedSuratKeluar(value: unknown): ExtractedSuratKeluar {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : '');
  const date = typeof raw.tanggalSurat === 'string' ? raw.tanggalSurat.trim() : '';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  // The recipient may come back over several lines; the record keeps it on one line.
  const tujuan = typeof raw.tujuan === 'string' ? raw.tujuan.split('\n').map((line) => line.trim()).filter(Boolean).join(' - ') : '';
  return {
    nomorSurat: text('nomorSurat'),
    tanggalSurat: parsed && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : '',
    tujuan,
    perihal: text('perihal'),
    lampiranKeterangan: text('lampiranKeterangan'),
    penandatanganNama: text('penandatanganNama'),
    penandatanganJabatan: text('penandatanganJabatan'),
    ringkasan: text('ringkasan'),
  };
}
