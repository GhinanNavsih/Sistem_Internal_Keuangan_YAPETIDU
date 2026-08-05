import { createHash, createHmac } from 'node:crypto';
import { MoneyField } from '@/lib/payroll/domain';

export interface KoperasiInstallmentPlanItem {
  loanId: string;
  borrowerUserId: string | null;
  installmentAmount: number;
  paidBefore: number;
  paidAfter: number;
  tenor: number;
  balanceBefore: number;
  balanceAfter: number;
  willPayOff: boolean;
}

export interface KoperasiInstallmentPlan {
  schemaVersion: 1;
  payrollPeriod: string;
  matchType: 'uid' | 'name' | 'none';
  resolvedUserId: string | null;
  expectedDeduction: number;
  loans: KoperasiInstallmentPlanItem[];
  planHash: string;
}

export interface KoperasiProgressionReceiptItem {
  loanId: string;
  outcome: 'advanced' | 'paid_off' | 'already_applied';
  installmentAmount: number;
  paidBefore: number;
  paidAfter: number;
  tenor: number;
  balanceBefore: number;
  balanceAfter: number;
}

export interface KoperasiProgressionReceipt {
  schemaVersion: 1;
  operationId: string;
  payrollPeriod: string;
  planHash: string;
  status: 'applied' | 'not_applicable';
  loans: KoperasiProgressionReceiptItem[];
}

export interface KoperasiBridgeEmployee {
  id: string;
  name: string;
  koperasiAuthUid: string | null;
}

export class KoperasiBridgeError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'KoperasiBridgeError';
  }
}

export function hashKoperasiInstallmentPlan(
  plan: Omit<KoperasiInstallmentPlan, 'planHash'> | KoperasiInstallmentPlan,
): string {
  const payload = {
    schemaVersion: plan.schemaVersion,
    payrollPeriod: plan.payrollPeriod,
    matchType: plan.matchType,
    resolvedUserId: plan.resolvedUserId,
    expectedDeduction: plan.expectedDeduction,
    loans: plan.loans,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const KOPERASI_LOAN_LABELS = new Set([
  'PINJAMAN KOP. UNIPDU',
  'PINJAMAN KOP UNIPDU',
  'PINJAMAN KOPERASI',
  'PINJAMAN KOPERASI UNIPDU',
]);

export function koperasiLoanDeduction(deductions: readonly MoneyField[]): number {
  return deductions.reduce((total, field) => {
    const label = field.label.trim().replace(/\s+/g, ' ').toUpperCase();
    return KOPERASI_LOAN_LABELS.has(label) ? total + field.amount : total;
  }, 0);
}

function bridgeConfig(): { url: string; secret: string } {
  const url = process.env.KOPERASI_PAYROLL_BRIDGE_URL?.trim() || '';
  const secret = process.env.KOPERASI_PAYROLL_HMAC_SECRET || '';
  if (!url || !/^https:\/\//.test(url) || secret.length < 32) {
    throw new KoperasiBridgeError(
      503,
      'BRIDGE_NOT_CONFIGURED',
      'Integrasi Simpan Pinjam belum dikonfigurasi. Slip tetap berstatus draf.',
    );
  }
  return { url, secret };
}

async function callBridge<T>(payload: Record<string, unknown>): Promise<T> {
  const { url, secret } = bridgeConfig();
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payroll-timestamp': timestamp,
        'x-payroll-signature': signature,
      },
      body,
      cache: 'no-store',
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({})) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (!response.ok) {
      throw new KoperasiBridgeError(
        response.status,
        result.error?.code || 'KOPERASI_REJECTED',
        result.error?.message || 'Koperasi menolak progres cicilan.',
        result.error?.details,
      );
    }
    return result as T;
  } catch (error) {
    if (error instanceof KoperasiBridgeError) throw error;
    const timedOut = error instanceof Error && error.name === 'AbortError';
    throw new KoperasiBridgeError(
      503,
      timedOut ? 'KOPERASI_TIMEOUT' : 'KOPERASI_UNAVAILABLE',
      timedOut
        ? 'Koperasi tidak merespons tepat waktu. Slip tetap berstatus draf dan dapat dicoba lagi.'
        : 'Koperasi tidak dapat dihubungi. Slip tetap berstatus draf dan dapat dicoba lagi.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

interface CommonBridgeInput {
  operationId: string;
  slipId: string;
  payrollPeriod: string;
  employee: KoperasiBridgeEmployee;
  expectedDeduction: number;
  actor: { uid: string; name: string; role: string };
}

export async function previewKoperasiInstallmentPlan(
  input: CommonBridgeInput,
): Promise<KoperasiInstallmentPlan> {
  const plan = await callBridge<KoperasiInstallmentPlan>({
    schemaVersion: 1,
    action: 'preview',
    ...input,
  });
  if (
    !plan ||
    plan.schemaVersion !== 1 ||
    !Array.isArray(plan.loans) ||
    typeof plan.planHash !== 'string' ||
    hashKoperasiInstallmentPlan(plan) !== plan.planHash
  ) {
    throw new KoperasiBridgeError(
      502,
      'INVALID_PLAN_RESPONSE',
      'Koperasi mengembalikan rencana cicilan yang tidak valid.',
    );
  }
  return plan;
}

export function applyKoperasiInstallmentPlan(
  input: CommonBridgeInput & { plan: KoperasiInstallmentPlan },
): Promise<KoperasiProgressionReceipt> {
  return callBridge<KoperasiProgressionReceipt>({
    schemaVersion: 1,
    action: 'apply',
    ...input,
  });
}
