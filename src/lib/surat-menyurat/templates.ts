import type { SuratKeluar, TemplateType } from './types';

export interface AssignedPerson { id: string; collection: 'Employees_Loyalis' | 'Employees_BlueCollar'; name: string; role: string }
export interface LetterDraftPayload {
  templateType: TemplateType;
  nomorSurat: string;
  lampiranKeterangan: string;
  perihal: string;
  tanggalSurat: string; // YYYY-MM-DD
  tujuanNama: string;
  tujuanJabatanInstansi: string;
  tujuanAlamatKota: string;
  salamPembuka: string;
  isiParagraf1: string;
  isiParagraf2: string;
  isiParagraf3: string;
  salamPenutup: string;
  penandatanganNama: string;
  penandatanganJabatan: string;
  penandatanganNipy: string;
  satkerName: string;
  satkerHeadEmail?: string;
  satkerHeadPhone?: string;
  assignedPeople?: AssignedPerson[];
  taskAssigner?: AssignedPerson;
}

const templateTypes: TemplateType[] = ['tugas', 'keterangan', 'undangan', 'pengantar', 'permohonan', 'edaran', 'rekomendasi', 'balasan', 'custom'];
const draftFieldLimits: Record<Exclude<keyof LetterDraftPayload, 'templateType' | 'satkerHeadEmail' | 'satkerHeadPhone' | 'assignedPeople' | 'taskAssigner'>, number> = {
  nomorSurat: 100, lampiranKeterangan: 150, perihal: 250, tanggalSurat: 10,
  tujuanNama: 150, tujuanJabatanInstansi: 150, tujuanAlamatKota: 150,
  salamPembuka: 1000, isiParagraf1: 10000, isiParagraf2: 10000,
  isiParagraf3: 10000, salamPenutup: 1000, penandatanganNama: 100,
  penandatanganJabatan: 100, penandatanganNipy: 100, satkerName: 150,
};
const optionalDraftFieldLimits: Record<string, number> = {
  satkerHeadEmail: 150,
  satkerHeadPhone: 50,
};

/** Reject invalid or oversized drafts rather than silently losing edited text. */
export function parseLetterDraft(value: unknown): LetterDraftPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!templateTypes.includes(raw.templateType as TemplateType)) return null;
  const result: Record<string, unknown> = { templateType: raw.templateType as string };
  for (const [key, limit] of Object.entries(draftFieldLimits)) {
    if (typeof raw[key] !== 'string' || raw[key].length > limit) return null;
    result[key] = raw[key];
  }
  for (const [key, limit] of Object.entries(optionalDraftFieldLimits)) {
    if (raw[key] !== undefined && raw[key] !== null) {
      if (typeof raw[key] !== 'string' || raw[key].length > limit) return null;
      result[key] = raw[key];
    }
  }
  if (raw.assignedPeople !== undefined) {
    if (!Array.isArray(raw.assignedPeople) || raw.assignedPeople.length > 100) return null;
    const people: AssignedPerson[] = [];
    for (const item of raw.assignedPeople) {
      if (!item || typeof item !== 'object' || !['Employees_Loyalis', 'Employees_BlueCollar'].includes(item.collection) || typeof item.id !== 'string' || !item.id || item.id.length > 150 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 150 || typeof item.role !== 'string' || item.role.length > 150) return null;
      if (people.some((person) => person.id === item.id && person.collection === item.collection)) return null;
      people.push({ id: item.id, collection: item.collection, name: item.name, role: item.role });
    }
    result.assignedPeople = people;
  }
  if (raw.taskAssigner !== undefined) {
    const item = raw.taskAssigner as AssignedPerson | null;
    if (!item || typeof item !== 'object' || !['Employees_Loyalis', 'Employees_BlueCollar'].includes(item.collection) || typeof item.id !== 'string' || !item.id || item.id.length > 150 || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 150 || typeof item.role !== 'string' || item.role.length > 150) return null;
    result.taskAssigner = { id: item.id, collection: item.collection, name: item.name, role: item.role };
  }
  return result as unknown as LetterDraftPayload;
}

export function draftRecipient(draft: LetterDraftPayload): string {
  return [draft.tujuanNama.trim(), draft.tujuanJabatanInstansi.trim()].filter(Boolean).join(' - ');
}

export function formatPenandatanganJabatan(jabatan?: string, satkerName?: string): string {
  const cleanSatker = (satkerName || '').trim();
  let title = (jabatan || 'Kepala').trim();

  if (cleanSatker) {
    // Deduplicate repeated satker names if already duplicated (e.g. "Kepala Pusat Komputer Net Pusat Komputer Net")
    const escapedSatker = cleanSatker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const repeatedSatkerRegex = new RegExp(`(${escapedSatker})(?:\\s+\\1)+`, 'gi');
    title = title.replace(repeatedSatkerRegex, '$1').trim();

    // If title already includes satker name (case-insensitive), don't append it again
    if (title.toLowerCase().includes(cleanSatker.toLowerCase())) {
      return title;
    }

    if (/^kepala\s+(?:satuan\s+kerja|satker)$/i.test(title) || /^kepala$/i.test(title)) {
      return `Kepala ${cleanSatker}`;
    }

    return `${title} ${cleanSatker}`.trim();
  }

  return title;
}

/** Agenda fields are authoritative if they were changed outside the composer. */
export function draftFromSurat(surat: SuratKeluar, fallbackSatker: string): LetterDraftPayload {
  const targetSatker = surat.satkerName || fallbackSatker;
  const saved = parseLetterDraft(surat.letterDraft);
  const draft = saved || {
    ...getDefaultDraft(targetSatker),
    templateType: (templateTypes.includes(surat.templateType as TemplateType) ? surat.templateType : 'custom') as TemplateType,
    tujuanNama: surat.tujuan || '', tujuanJabatanInstansi: '', tujuanAlamatKota: 'di Tempat',
    salamPembuka: '', isiParagraf1: '', isiParagraf2: surat.contentBody || '', isiParagraf3: '', salamPenutup: '',
    penandatanganNipy: '',
  };
  if (saved && draftRecipient(saved) !== surat.tujuan) {
    draft.tujuanNama = surat.tujuan || '';
    draft.tujuanJabatanInstansi = '';
  }
  return {
    ...draft, nomorSurat: surat.nomorSurat || '', tanggalSurat: surat.tanggalSurat || '',
    perihal: surat.perihal || '', penandatanganNama: surat.penandatanganNama || '',
    penandatanganJabatan: saved?.templateType === 'tugas' && saved.taskAssigner ? (surat.penandatanganJabatan || draft.penandatanganJabatan) : formatPenandatanganJabatan(surat.penandatanganJabatan || draft.penandatanganJabatan, targetSatker),
    lampiranKeterangan: surat.lampiranKeterangan ?? draft.lampiranKeterangan,
    satkerHeadEmail: saved?.satkerHeadEmail ?? draft.satkerHeadEmail,
    satkerHeadPhone: saved?.satkerHeadPhone ?? draft.satkerHeadPhone,
  };
}

export function getDefaultDraft(
  satkerName: string,
  kepalaName = '',
  kepalaJabatan = 'Kepala',
  satkerHeadEmail = '',
  satkerHeadPhone = '',
): LetterDraftPayload {
  const today = new Date().toISOString().slice(0, 10);
  const resolvedJabatan = formatPenandatanganJabatan(kepalaJabatan, satkerName);
  return {
    templateType: 'tugas',
    nomorSurat: '',
    lampiranKeterangan: '-',
    perihal: 'Surat Tugas Pelaksanaan Kegiatan',
    tanggalSurat: today,
    tujuanNama: 'Bapak / Ibu Dosen & Tenaga Kependidikan',
    tujuanJabatanInstansi: satkerName || 'Universitas Pesantren Tinggi Darul \'Ulum',
    tujuanAlamatKota: 'di Tempat',
    salamPembuka: 'Assalamu\'alaikum Wr. Wb.',
    isiParagraf1: 'Dengan ini memberikan tugas kepada:',
    isiParagraf2: 'Untuk melaksanakan tugas: .................................\nPada tanggal/tempat: ......................................',
    isiParagraf3: 'Demikian surat tugas ini diterbitkan untuk dipergunakan sebagaimana mestinya dan setelah melaksanakan tugas segera menyampaikan laporan.',
    salamPenutup: 'Wassalamu\'alaikum Wr. Wb.',
    penandatanganNama: kepalaName || 'Kepala SatKer',
    penandatanganJabatan: resolvedJabatan,
    penandatanganNipy: '',
    satkerName: satkerName || 'Satuan Kerja Loyalis',
    satkerHeadEmail: satkerHeadEmail || '',
    satkerHeadPhone: satkerHeadPhone || '',
  };
}

export function applyTemplateDefaults(
  current: LetterDraftPayload,
  type: TemplateType,
  satkerName: string,
  kepalaName: string,
  kepalaJabatan: string,
): LetterDraftPayload {
  const targetSatker = satkerName || current.satkerName;
  const base = {
    ...current,
    templateType: type,
    satkerName: targetSatker,
    satkerHeadEmail: current.satkerHeadEmail,
    satkerHeadPhone: current.satkerHeadPhone,
    penandatanganNama: kepalaName || current.penandatanganNama,
    penandatanganJabatan: formatPenandatanganJabatan(kepalaJabatan || current.penandatanganJabatan, targetSatker),
  };

  switch (type) {
    case 'tugas':
      return {
        ...base,
        perihal: 'Surat Tugas Pelaksanaan Kegiatan',
        lampiranKeterangan: '-',
        salamPembuka: 'Assalamu\'alaikum Wr. Wb.',
        isiParagraf1: 'Dengan ini memberikan tugas kepada:',
        isiParagraf2: 'Untuk melaksanakan tugas: .................................\nPada tanggal/tempat: ......................................',
        isiParagraf3: 'Demikian surat tugas ini diterbitkan untuk dipergunakan sebagaimana mestinya dan setelah melaksanakan tugas segera menyampaikan laporan.',
        salamPenutup: 'Wassalamu\'alaikum Wr. Wb.',
      };

    case 'keterangan':
      return {
        ...base,
        perihal: 'Surat Keterangan',
        lampiranKeterangan: '-',
        tujuanNama: 'Yang Berkepentingan',
        tujuanJabatanInstansi: '',
        tujuanAlamatKota: 'di Tempat',
        salamPembuka: 'Assalamu\'alaikum Wr. Wb.',
        isiParagraf1: `Yang bertanda tangan di bawah ini, ${base.penandatanganJabatan || 'Kepala SatKer'} Universitas Pesantren Tinggi Darul 'Ulum (UNIPDU) Jombang menerangkan bahwa:`,
        isiParagraf2: 'Nama: ....................................................\nNIPY / NIM: ..............................................\nUnit / Prodi: ............................................\nAdalah benar aktif dan terdaftar pada unit kami.',
        isiParagraf3: 'Demikian surat keterangan ini kami buat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.',
        salamPenutup: 'Wassalamu\'alaikum Wr. Wb.',
      };

    case 'undangan':
      return {
        ...base,
        perihal: 'Undangan Rapat Koordinasi SatKer',
        lampiranKeterangan: '1 (satu) lembar agenda',
        tujuanNama: 'Bapak / Ibu / Saudara Pengurus & Anggota SatKer',
        tujuanJabatanInstansi: satkerName,
        tujuanAlamatKota: 'di Tempat',
        salamPembuka: 'Assalamu\'alaikum Wr. Wb.',
        isiParagraf1: `Puji syukur kita panjatkan ke hadirat Allah SWT atas limpahan rahmat-Nya. Sehubungan dengan program kerja ${satkerName}, kami mengharap kehadiran Bapak/Ibu pada rapat koordinasi yang akan diselenggarakan pada:`,
        isiParagraf2: 'Hari / Tanggal: ...........................................\nWaktu: ...................................................\nTempat: ..................................................\nAgenda: ..................................................',
        isiParagraf3: 'Mengingat pentingnya agenda tersebut, mohon hadir tepat waktu. Atas perhatian dan kerjasamanya, kami sampaikan terima kasih.',
        salamPenutup: 'Wassalamu\'alaikum Wr. Wb.',
      };

    case 'pengantar':
      return {
        ...base,
        perihal: 'Surat Pengantar Dokumen / Laporan',
        lampiranKeterangan: '1 (satu) Berkas',
        tujuanNama: 'Rektor Universitas Pesantren Tinggi Darul \'Ulum',
        tujuanJabatanInstansi: 'c.q. Bagian Administrasi / BAK',
        tujuanAlamatKota: 'di Jombang',
        salamPembuka: 'Assalamu\'alaikum Wr. Wb.',
        isiParagraf1: 'Dengan hormat, bersama ini kami sampaikan berkas dokumen dari satuan kerja kami sebagaimana tercantum di bawah ini:',
        isiParagraf2: 'No | Uraian Dokumen / Berkas | Banyaknya | Keterangan\n1.  | Laporan Pertanggungjawaban | 1 Eksemplar | Disampaikan dengan hormat untuk diverifikasi.',
        isiParagraf3: 'Demikian surat pengantar ini kami sampaikan, atas perhatian dan tindak lanjutnya kami ucapkan terima kasih.',
        salamPenutup: 'Wassalamu\'alaikum Wr. Wb.',
      };

    case 'permohonan':
      return {
        ...base,
        perihal: 'Permohonan Fasilitas / Dukungan Kegiatan',
        lampiranKeterangan: '1 (satu) Proposal',
        tujuanNama: 'Kepala Biro Umum / Pejabat Terkait',
        tujuanJabatanInstansi: 'Universitas Pesantren Tinggi Darul \'Ulum',
        tujuanAlamatKota: 'di Jombang',
        salamPembuka: 'Assalamu\'alaikum Wr. Wb.',
        isiParagraf1: `Semoga Allah SWT senantiasa melimpahkan taufiq dan hidayah-Nya dalam menjalankan tugas sehari-hari. Sehubungan dengan kegiatan yang diselenggarakan oleh ${satkerName}, bersama ini kami mengajukan permohonan:`,
        isiParagraf2: 'Kegiatan: ................................................\nKebutuhan: ...............................................\nWaktu Pelaksanaan: .......................................',
        isiParagraf3: 'Besar harapan kami permohonan ini dapat dikabulkan. Atas bantuan dan perkenan yang diberikan, kami sampaikan terima kasih jazakumullah khairan.',
        salamPenutup: 'Wassalamu\'alaikum Wr. Wb.',
      };

    case 'edaran':
      return {
        ...base,
        perihal: 'Pemberitahuan Internal',
        lampiranKeterangan: '-',
        tujuanNama: 'Bapak / Ibu di Lingkungan Satuan Kerja',
        tujuanJabatanInstansi: targetSatker,
        tujuanAlamatKota: 'di Tempat',
        salamPembuka: 'Assalamu\'alaikum Wr. Wb.',
        isiParagraf1: 'Sehubungan dengan ................................................, bersama ini kami sampaikan pemberitahuan sebagai berikut:',
        isiParagraf2: 'Ketentuan / informasi: ....................................\nBerlaku mulai: ............................................\nHal yang perlu ditindaklanjuti: ...........................',
        isiParagraf3: 'Demikian edaran ini disampaikan untuk diketahui dan dilaksanakan sebagaimana mestinya. Atas perhatian dan kerja samanya, kami ucapkan terima kasih.',
        salamPenutup: 'Wassalamu\'alaikum Wr. Wb.',
      };

    case 'rekomendasi':
      return {
        ...base,
        perihal: 'Surat Rekomendasi',
        lampiranKeterangan: '-',
        tujuanNama: 'Pihak yang Berkepentingan',
        tujuanJabatanInstansi: '',
        tujuanAlamatKota: 'di Tempat',
        salamPembuka: 'Assalamu\'alaikum Wr. Wb.',
        isiParagraf1: `Yang bertanda tangan di bawah ini, ${base.penandatanganJabatan}, dengan ini memberikan rekomendasi kepada:`,
        isiParagraf2: 'Nama: ....................................................\nNIPY / NIM: ..............................................\nJabatan / Unit: ..........................................\nUntuk keperluan: .........................................\nDasar pertimbangan: ......................................',
        isiParagraf3: 'Demikian surat rekomendasi ini diberikan untuk dipergunakan sesuai dengan keperluan tersebut. Atas perhatian dan kerja samanya, kami ucapkan terima kasih.',
        salamPenutup: 'Wassalamu\'alaikum Wr. Wb.',
      };

    case 'balasan':
      return {
        ...base,
        perihal: 'Tanggapan atas Surat',
        lampiranKeterangan: '-',
        tujuanNama: 'Bapak / Ibu Pimpinan',
        tujuanJabatanInstansi: 'Instansi Pengirim',
        tujuanAlamatKota: 'di Tempat',
        salamPembuka: 'Assalamu\'alaikum Wr. Wb.',
        isiParagraf1: 'Menindaklanjuti surat Bapak/Ibu nomor ................................ tanggal ................................ perihal ................................, bersama ini kami sampaikan tanggapan sebagai berikut:',
        isiParagraf2: 'Tanggapan: ...............................................\nTindak lanjut: ...........................................',
        isiParagraf3: 'Demikian tanggapan ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.',
        salamPenutup: 'Wassalamu\'alaikum Wr. Wb.',
      };

    case 'custom':
    default:
      return {
        ...base,
        perihal: 'Surat Resmi',
        lampiranKeterangan: '-',
        salamPembuka: 'Assalamu\'alaikum Wr. Wb.',
        isiParagraf1: 'Dengan hormat, kami sampaikan hal-hal sebagai berikut:',
        isiParagraf2: 'Tulis isi surat di sini...',
        isiParagraf3: 'Demikian surat ini kami sampaikan, atas perhatian dan kerjasamanya kami ucapkan terima kasih.',
        salamPenutup: 'Wassalamu\'alaikum Wr. Wb.',
      };
  }
}
