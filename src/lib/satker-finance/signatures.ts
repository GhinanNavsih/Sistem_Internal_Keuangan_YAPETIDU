/** The two people who sign the printed monthly Arus Kas report. */
export type CashFlowSignature = { name: string; title: string; employeeId?: string };
export type CashFlowSignatures = { ketuaSatker: CashFlowSignature; warku: CashFlowSignature };
export type SignatureEmployee = { id: string; name: string; role: string };
export const CASH_FLOW_SIGNER_SLOTS = [
  { key: 'ketuaSatker', label: 'Ketua SatKer', title: 'Ketua SatKer' },
  { key: 'warku', label: 'WarKu', title: 'Wakil Rektor Bid. Keuangan, SDM dan Umum' },
] as const;

export function defaultCashFlowSignatures(headName = '', employees: SignatureEmployee[] = []): CashFlowSignatures {
  const heads = employees.filter((employee) => employee.name.trim().toLocaleLowerCase('id') === headName.trim().toLocaleLowerCase('id'));
  const financeRectors = employees.filter((employee) => /wakil\s+rektor/i.test(employee.role) && /keuangan/i.test(employee.role));
  const head = heads.length === 1 ? heads[0] : undefined;
  const warku = financeRectors.length === 1 ? financeRectors[0] : undefined;
  return {
    ketuaSatker: { name: headName, title: CASH_FLOW_SIGNER_SLOTS[0].title, ...(head ? { employeeId: head.id } : {}) },
    warku: { name: warku?.name || '', title: warku?.role || CASH_FLOW_SIGNER_SLOTS[1].title, ...(warku ? { employeeId: warku.id } : {}) },
  };
}

/** Read legacy units without saving defaults or replacing an intentionally empty signer. */
export function cashFlowSignaturesFrom(value: unknown, fallback = defaultCashFlowSignatures()): CashFlowSignatures {
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const read = (key: keyof CashFlowSignatures): CashFlowSignature => {
    const slot = stored[key];
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return { ...fallback[key] };
    const fields = slot as Record<string, unknown>;
    return {
      name: typeof fields.name === 'string' ? fields.name : fallback[key].name,
      title: typeof fields.title === 'string' ? fields.title : fallback[key].title,
      ...(typeof fields.employeeId === 'string' && fields.employeeId ? { employeeId: fields.employeeId } : {}),
    };
  };
  return { ketuaSatker: read('ketuaSatker'), warku: read('warku') };
}

export function validateCashFlowSignatures(value: unknown): CashFlowSignatures {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Konfigurasi tanda tangan tidak valid.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || Object.keys(record).some((key) => !CASH_FLOW_SIGNER_SLOTS.some((slot) => slot.key === key))) {
    throw new Error('Tanda tangan Arus Kas hanya untuk Ketua SatKer dan WarKu.');
  }
  for (const { key } of CASH_FLOW_SIGNER_SLOTS) {
    const slot = record[key];
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) throw new Error('Penandatangan tidak valid.');
    const fields = slot as Record<string, unknown>;
    if (typeof fields.name !== 'string' || fields.name.trim().length > 180 || typeof fields.title !== 'string' || !fields.title.trim() || fields.title.trim().length > 180) {
      throw new Error('Nama maksimal 180 karakter dan jabatan wajib diisi (maksimal 180 karakter).');
    }
    if (fields.employeeId !== undefined && (typeof fields.employeeId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(fields.employeeId))) {
      throw new Error('Pegawai penandatangan tidak valid.');
    }
  }
  const signatures = cashFlowSignaturesFrom(record);
  for (const { key } of CASH_FLOW_SIGNER_SLOTS) {
    signatures[key].name = signatures[key].name.trim();
    signatures[key].title = signatures[key].title.trim();
  }
  return signatures;
}
