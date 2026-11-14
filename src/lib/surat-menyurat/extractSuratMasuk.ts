export interface ExtractedSuratMasuk {
  nomorSurat: string;
  tanggalSurat: string;
  pengirim: string;
  penerima: string;
  perihal: string;
  ringkasan: string;
}

/** Treat model output as untrusted; absent and invalid values stay blank. */
export function normalizeExtractedSuratMasuk(value: unknown): ExtractedSuratMasuk {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = (key: string, limit: number) => typeof raw[key] === 'string' ? (raw[key] as string).trim().slice(0, limit) : '';
  const date = typeof raw.tanggalSurat === 'string' ? raw.tanggalSurat.trim() : '';
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  return {
    nomorSurat: text('nomorSurat', 100),
    tanggalSurat: parsedDate && !Number.isNaN(parsedDate.valueOf()) && parsedDate.toISOString().slice(0, 10) === date ? date : '',
    pengirim: text('pengirim', 150),
    penerima: text('penerima', 150),
    perihal: text('perihal', 250),
    ringkasan: text('ringkasan', 1000),
  };
}
