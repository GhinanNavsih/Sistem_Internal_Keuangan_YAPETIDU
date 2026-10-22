import { adminDb } from '@/lib/firebase-admin';
import { referralPayrollReceiptSchema, type ReferralPayrollReceipt } from '@/lib/loyalis-referral-contract';
import { REFERRAL_BONUSES, REFERRAL_RECOVERIES } from './loyalisReferralPayroll';
import { HttpError } from './auth';

export const REFERRAL_RECEIPTS = 'LoyalisReferralReceipts';

// Read the ledger, recovery and locked slip together. A receipt revision changes
// only when the public payroll projection changes, including Finance actions.
export async function referralPayrollReceipt(claimId: string): Promise<ReferralPayrollReceipt> {
  return adminDb.runTransaction(async tx => {
    const receiptRef = adminDb.collection(REFERRAL_RECEIPTS).doc(claimId);
    const [bonus, recovery, previous] = await tx.getAll(adminDb.collection(REFERRAL_BONUSES).doc(claimId), adminDb.collection(REFERRAL_RECOVERIES).doc(claimId), receiptRef);
    if (!bonus.exists) throw new HttpError(404, 'Klaim bonus belum diterima.');
    const data = bonus.data()!;
    const slip = data.postedPeriod ? await tx.get(adminDb.collection('PayrollSlipStates').doc(`${data.postedPeriod.replace('-', '_')}_${data.employeeId}`)) : null;
    const projection = {
      protocolVersion: 1, claimId, letterId: data.letterId, applicationId: data.applicationId, employeeId: data.employeeId,
      version: data.version, state: data.state, status: data.status, postedPeriod: data.postedPeriod || null,
      payrollFinalized: slip?.get('status') === 'locked', recoveryStatus: recovery.get('status') || null, recoveryPeriod: recovery.get('targetPeriod') || null,
    };
    const fingerprint = JSON.stringify(projection);
    const statusRevision = Number(previous.get('statusRevision') || 0) + (previous.get('fingerprint') === fingerprint ? 0 : 1);
    const receipt = referralPayrollReceiptSchema.parse({ ...projection, statusRevision });
    if (previous.get('fingerprint') !== fingerprint) tx.set(receiptRef, { ...receipt, fingerprint });
    return receipt;
  });
}
