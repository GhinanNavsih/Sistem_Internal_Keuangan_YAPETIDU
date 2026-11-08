export interface PayrollSavingsPolicy {
  startPeriod: string;
  initialPeriod: string;
  initialPaid: boolean;
}

export interface KoperasiSavingsMember {
  membershipStatus?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  iuranPokok?: number | null;
  iuranWajib?: number | null;
  payrollSavings?: PayrollSavingsPolicy | null;
}

export interface KoperasiSavingsPlan extends PayrollSavingsPolicy {
  memberId: string;
  uid: string;
  membershipStatus: string | null;
  paymentStatus: string | null;
  iuranPokok: number;
  iuranWajib: number;
  initial: number;
  monthly: number;
  total: number;
}

export function koperasiSavingsAmounts(member: KoperasiSavingsMember, period: string) {
  const approved = (member.membershipStatus ?? member.status) === 'approved';
  const policy = member.payrollSavings;
  if (!approved || member.paymentStatus !== 'Payroll Deduction' || (policy && period < policy.startPeriod)) {
    return { initial: 0, monthly: 0 };
  }
  const money = (value: unknown, fallback: number) => {
    const amount = Number(value) || fallback;
    return Number.isSafeInteger(amount) && amount >= 0 && amount <= 10_000_000 ? amount : 0;
  };
  return {
    initial: policy && !policy.initialPaid && policy.initialPeriod === period ? money(member.iuranPokok, 250_000) : 0,
    monthly: money(member.iuranWajib, 25_000),
  };
}
