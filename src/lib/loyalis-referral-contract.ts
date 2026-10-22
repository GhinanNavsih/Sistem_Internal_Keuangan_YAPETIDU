// This contract is mirrored in Internal-BAK/src/lib/loyalis-referral-contract.ts.
// HMAC covers the destination as well as the unmodified wire body.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const REFERRAL_AMOUNT = 12345;
export const REFERRAL_LIMIT = 5;
export const REFERRAL_SOURCE = "loyalis_referral";
export const REFERRAL_LABEL = "Bonus Rekommendasi";
export type LoyalisSnapshot = { employeeId: string; name: string; nipy: string; job: string; unit: string };
// `id` keys the letter, its claim and the bonus ledger. `code` is what PMB's admin types: four characters, unique
// within the letter's Admission cycle only. Letters issued before codes existed have none.
export type ReferralLetter = {
  id: string; code?: string; token: string; cycleId: string; cycleLabel: string; prospectName: string;
  owner: LoyalisSnapshot; issuedAt: string; status: "issued" | "claimed" | "revoked";
  testOnly?: boolean; payrollTest?: true; claimId: string | null; qualifiedAt: string | null; revokedAt: string | null;
};
export type ReferralDelivery = {
  claimId: string; letterId: string; applicationId: string; employeeId: string;
  employeeName: string; prospectName: string; cycleId: string; version: number;
  state: "qualified" | "cancelled"; amount: number; qualifiedAt: string | null;
  occurredAt: string; reason: string; payable: boolean; payrollTest?: true;
};

// A deliberate local test may post real earnings. Never infer this from an
// emulator, and never enable it in a production build or for a remote peer.
export function localReferralPayrollTestEnabled(env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV !== "development" || env.LOYALIS_REFERRAL_LOCAL_PAYROLL_TEST !== "true") return false;
  const loopback = (value: string | undefined) => {
    try { const url = new URL(value || ""); return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname); } catch { return false; }
  };
  if (!loopback(env.PMB_REFERRAL_ORIGIN || env.APP_ORIGIN) || !loopback(env.INTERNAL_BAK_ORIGIN || "http://localhost:3000")) return false;
  if (env.FIRESTORE_EMULATOR_HOST) return /^127\.0\.0\.1:\d+$/.test(env.FIRESTORE_EMULATOR_HOST) && (env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").startsWith("demo-");
  return !!env.PMB_REFERRAL_ORIGIN && env.LOYALIS_REFERRAL_LOCAL_PREVIEW === "true";
}

export function referralPayrollEligibility(letter: { production?: boolean; payrollTest?: true }, application: { referralProductionEligible?: boolean; referralPayrollTestEligible?: boolean }, localTestEnabled: boolean) {
  return (letter.production === true && application.referralProductionEligible === true)
    || (localTestEnabled && letter.payrollTest === true && application.referralPayrollTestEligible === true);
}
const signature = (secret: string, method: string, path: string, body: string, timestamp: string) =>
  createHmac("sha256", secret).update(`${timestamp}\n${method}\n${path}\n${body}`).digest("hex");
export function bridgeHeaders(secret: string, method: string, path: string, body: string, now = Date.now()) {
  if (secret.length < 32) throw new Error("Kunci integrasi rekomendasi belum dikonfigurasi.");
  const timestamp = String(now);
  return { "Content-Type": "application/json", "X-Referral-Time": timestamp, "X-Referral-Signature": signature(secret, method, path, body, timestamp) };
}
export function verifyBridge(secret: string, method: string, path: string, body: string, headers: Headers, now = Date.now()) {
  const timestamp = headers.get("X-Referral-Time") || "", supplied = headers.get("X-Referral-Signature") || "";
  if (secret.length < 32 || !/^\d{10,16}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300000 || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(signature(secret, method, path, body, timestamp), "hex"));
}

// PMB owns claim versions; Internal-BAK owns payroll status revisions.
// The separate counters prevent delayed responses from rolling either side back.
export const referralDeliverySchema = z.object({
  claimId: z.string().regex(/^RL-\d{4}-[A-F0-9]{16}$/), letterId: z.string().regex(/^RL-\d{4}-[A-F0-9]{16}$/),
  applicationId: z.string().min(1).max(128), employeeId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  employeeName: z.string().min(1).max(180), prospectName: z.string().min(1).max(160), cycleId: z.string().regex(/^\d{4}-\d{4}$/),
  version: z.number().int().positive(), state: z.enum(['qualified', 'cancelled']), amount: z.literal(12345),
  qualifiedAt: z.string().datetime().nullable(), occurredAt: z.string().datetime(), reason: z.string().max(1000), payable: z.boolean(), payrollTest: z.literal(true).optional(),
});
export const referralPayrollReceiptSchema = z.object({
  protocolVersion: z.literal(1), claimId: z.string(), letterId: z.string(), applicationId: z.string(), employeeId: z.string(),
  version: z.number().int().positive(), statusRevision: z.number().int().positive(), state: z.enum(['qualified', 'cancelled']),
  status: z.enum(['posted', 'finance_review', 'cancelled', 'recovery_required', 'recovery_applied', 'recovered', 'manual_settled', 'test_skipped']),
  postedPeriod: z.string().regex(/^\d{4}-\d{2}$/).nullable(), payrollFinalized: z.boolean(),
  recoveryStatus: z.enum(['pending', 'applied', 'settled', 'manual_settled']).nullable(),
  recoveryPeriod: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
});
export type ReferralPayrollReceipt = z.infer<typeof referralPayrollReceiptSchema>;
