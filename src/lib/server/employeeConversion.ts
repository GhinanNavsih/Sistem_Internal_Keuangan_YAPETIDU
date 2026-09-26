import { createHash } from 'node:crypto';
import admin, { adminDb } from '@/lib/firebase-admin';
import { normalizeNipy } from '@/lib/payroll/attendance';
import {
  buildLoyalisEmployeeDocument,
  collectConversionIssues,
  conversionEffectivePeriod,
  EMPLOYEE_CONVERSION_REASON_MAX_LENGTH,
  EMPLOYEE_CONVERSION_REASON_MIN_LENGTH,
  EmployeeConversionFacts,
  EmployeeConversionIssue,
  isConvertedAway,
  lastDayBeforePeriod,
  LoyalisConversionInput,
  nextLoyalisEmployeeId,
  normalizeConversionPeriod,
  parseLoyalisConversionInput,
  prefillLoyalisConversionInput,
  shiftConversionPeriod,
  validateLoyalisConversionInput,
} from '@/lib/employeeConversion';
import {
  ATTENDANCE_IDENTITIES_COLLECTION,
  attendanceIdentityDocumentId,
  loadAttendanceEmployeeIdentities,
} from './attendanceStore';
import { ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION } from './annualPaidLeave';
import { buildFinancialAuditRecord, newFinancialAuditRef } from './audit';
import { AuthenticatedProfile, HttpError } from './auth';
import { isPeriodClosed, jakartaToday } from './payrollPeriod';
import { PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION } from './pekaryaOfficialLeave';
import { SATPAM_ABSENCE_REQUESTS_COLLECTION } from './satpamDutyPlan';

type Snapshot = FirebaseFirestore.DocumentSnapshot;
type QuerySnapshot = FirebaseFirestore.QuerySnapshot;
type Reader = {
  doc(ref: FirebaseFirestore.DocumentReference): Promise<Snapshot>;
  query(query: FirebaseFirestore.Query): Promise<QuerySnapshot>;
};

const directReader: Reader = {
  doc: (ref) => ref.get(),
  query: (query) => query.get(),
};

function transactionReader(transaction: FirebaseFirestore.Transaction): Reader {
  return {
    doc: (ref) => transaction.get(ref),
    query: (query) => transaction.get(query),
  };
}

const ACTIVITY_PENDING_STATUSES = new Set([
  'pending',
  'pending_review',
  'under_review',
  'submitted',
]);
const ACTIVITY_VOID_STATUSES = new Set([
  'declined',
  'rejected',
  'withdrawn',
  'deleted',
  'voided',
  'cancelled',
]);
const JOURNEY_OPEN_STATUSES = new Set(['assigned', 'claimed', 'submitted']);
const JOURNEY_VOID_STATUSES = new Set(['deleted', 'declined', 'cancelled', 'unassigned', 'open']);

export function assertBlueCollarEmployeeId(value: unknown): string {
  const employeeId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(employeeId)) {
    throw new HttpError(400, 'ID pegawai tidak valid.');
  }
  return employeeId;
}

function isBlueCollarActive(data: FirebaseFirestore.DocumentData): boolean {
  return (
    data.employment?.status === 'active' &&
    data.flags?.isActive !== false &&
    data.flags?.isPayrollEligible !== false
  );
}

function hasNonZeroValue(values: unknown): boolean {
  if (!values || typeof values !== 'object') return false;
  return Object.values(values as Record<string, unknown>).some(
    (value) => Number(value) !== 0 && Number.isFinite(Number(value)),
  );
}

interface GatheredFacts {
  facts: EmployeeConversionFacts;
  linkedAccountSnapshot: Snapshot | null;
}

/**
 * Reads everything a conversion could strand. Used for the dialog's preview
 * and again inside the conversion transaction, so a request filed between the
 * two is still caught.
 */
async function gatherFacts(
  reader: Reader,
  employeeId: string,
  employee: FirebaseFirestore.DocumentData,
  today: string,
  options: { levelCodeProvided: boolean; nipyOwnedElsewhere: string | null },
): Promise<GatheredFacts> {
  const effectivePeriod = conversionEffectivePeriod(today);
  const previousPeriod = shiftConversionPeriod(effectivePeriod, -1);
  const periodStart = `${effectivePeriod}-01`;
  const jobCategory = String(employee.employment?.jobCategory || '')
    .trim()
    .toUpperCase();
  const uraianRef = jobCategory
    ? adminDb
        .collection('UraianGaji')
        .doc(`${effectivePeriod.replace('-', '_')}_${jobCategory}`)
    : null;

  const [
    previousPeriodSnapshot,
    effectivePeriodSnapshot,
    uraianSnapshot,
    slipsSnapshot,
    activitySnapshot,
    ownJourneySnapshot,
    assignedJourneySnapshot,
    piketSnapshot,
    spjSnapshot,
    officialLeaveSnapshot,
    satpamAbsenceSnapshot,
    annualLeaveSnapshot,
    teamsSnapshot,
    accountsSnapshot,
  ] = await Promise.all([
    reader.doc(adminDb.collection('PayrollPeriods').doc(previousPeriod)),
    reader.doc(adminDb.collection('PayrollPeriods').doc(effectivePeriod)),
    uraianRef ? reader.doc(uraianRef) : Promise.resolve(null),
    reader.query(adminDb.collection('PayrollSlipStates').where('employeeId', '==', employeeId)),
    reader.query(adminDb.collection('ActivityReports').where('employeeId', '==', employeeId)),
    reader.query(adminDb.collection('DriverJourneys').where('employeeId', '==', employeeId)),
    reader.query(adminDb.collection('DriverJourneys').where('assignedTo', '==', employeeId)),
    reader.query(adminDb.collection('DriverPiketSchedules').where('driverId', '==', employeeId)),
    reader.query(adminDb.collection('KegiatanSpj').where('period', '==', effectivePeriod)),
    reader.query(
      adminDb
        .collection(PEKARYA_OFFICIAL_LEAVE_REQUESTS_COLLECTION)
        .where('employeeId', '==', employeeId),
    ),
    reader.query(
      adminDb.collection(SATPAM_ABSENCE_REQUESTS_COLLECTION).where('employeeId', '==', employeeId),
    ),
    reader.query(
      adminDb
        .collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION)
        .where('employeeId', '==', employeeId),
    ),
    reader.query(adminDb.collection('SatpamShiftTeams')),
    reader.query(adminDb.collection('users').where('linkedEmployeeId', '==', employeeId)),
  ]);

  const slipPeriodsFromEffective = Array.from(
    new Set(
      slipsSnapshot.docs
        .map((snapshot) =>
          normalizeConversionPeriod(
            snapshot.data().period || snapshot.id.slice(0, 7),
          ),
        )
        .filter((period) => period && period >= effectivePeriod),
    ),
  ).sort();

  let pendingActivityReports = 0;
  let activityReportsInEffectivePeriod = 0;
  for (const snapshot of activitySnapshot.docs) {
    const data = snapshot.data();
    const status = String(data.status || '');
    if (ACTIVITY_PENDING_STATUSES.has(status)) {
      pendingActivityReports += 1;
      continue;
    }
    const period = normalizeConversionPeriod(data.payrollPeriod || data.period);
    if (period && period >= effectivePeriod && !ACTIVITY_VOID_STATUSES.has(status)) {
      activityReportsInEffectivePeriod += 1;
    }
  }

  const journeys = new Map<string, FirebaseFirestore.DocumentData>();
  for (const snapshot of [...ownJourneySnapshot.docs, ...assignedJourneySnapshot.docs]) {
    journeys.set(snapshot.id, snapshot.data());
  }
  let openDriverJourneys = 0;
  let driverJourneysInEffectivePeriod = 0;
  for (const data of journeys.values()) {
    const status = String(data.status || '');
    if (JOURNEY_OPEN_STATUSES.has(status)) {
      openDriverJourneys += 1;
      continue;
    }
    const date = String(data.activityDate || data.journeyDate || '');
    if (date >= periodStart && !JOURNEY_VOID_STATUSES.has(status)) {
      driverJourneysInEffectivePeriod += 1;
    }
  }

  const upcomingDriverPiket = piketSnapshot.docs.filter(
    (snapshot) => String(snapshot.data().date || '') >= today,
  ).length;
  const spjEventsInEffectivePeriod = spjSnapshot.docs.filter((snapshot) => {
    const workers = snapshot.data().eventWorkers;
    return Boolean(workers && typeof workers === 'object' && workers[employeeId]);
  }).length;
  const uraianEntry = uraianSnapshot?.exists
    ? uraianSnapshot.data()?.entries?.[employeeId]
    : null;
  const countPending = (snapshot: QuerySnapshot) =>
    snapshot.docs.filter((doc) => doc.data().status === 'pending').length;
  const satpamTeamNames = teamsSnapshot.docs
    .filter((snapshot) => {
      const data = snapshot.data();
      return (
        data.ketuaShiftId === employeeId ||
        (Array.isArray(data.memberEmployeeIds) &&
          data.memberEmployeeIds.includes(employeeId))
      );
    })
    .map((snapshot) => snapshot.id);

  const facts: EmployeeConversionFacts = {
    today,
    effectivePeriod,
    previousPeriodClosed: isPeriodClosed(previousPeriodSnapshot.data()),
    effectivePeriodClosed: isPeriodClosed(effectivePeriodSnapshot.data()),
    employeeActive: isBlueCollarActive(employee),
    alreadyConverted: isConvertedAway(employee),
    nipy: normalizeNipy(employee.nipy),
    slipPeriodsFromEffective,
    pendingActivityReports,
    activityReportsInEffectivePeriod,
    openDriverJourneys,
    driverJourneysInEffectivePeriod,
    upcomingDriverPiket,
    spjEventsInEffectivePeriod,
    uraianPaidInEffectivePeriod: hasNonZeroValue(uraianEntry?.values),
    pendingOfficialLeave: countPending(officialLeaveSnapshot),
    pendingSatpamAbsences: countPending(satpamAbsenceSnapshot),
    pendingAnnualLeave: countPending(annualLeaveSnapshot),
    satpamTeamNames,
    linkedAccounts: accountsSnapshot.docs.map((snapshot) => ({
      uid: snapshot.id,
      role: String(snapshot.data().role || ''),
      disabled: snapshot.data().disabled === true,
    })),
    nipyOwnedElsewhere: options.nipyOwnedElsewhere,
    levelCodeProvided: options.levelCodeProvided,
  };
  return {
    facts,
    linkedAccountSnapshot: accountsSnapshot.docs[0] || null,
  };
}

/** Who else holds this NIPY, as a label, scanning all three employee collections. */
async function findOtherNipyOwner(employeeId: string, nipy: string): Promise<string | null> {
  if (!nipy) return null;
  const { byNipy } = await loadAttendanceEmployeeIdentities();
  const other = (byNipy.get(nipy) || []).find(
    (identity) =>
      identity.employeeId !== employeeId ||
      identity.employeeCollection !== 'Employees_BlueCollar',
  );
  return other ? `${other.name || other.employeeId} (${other.employeeId})` : null;
}

async function loadBlueCollar(employeeId: string, reader: Reader) {
  const snapshot = await reader.doc(
    adminDb.collection('Employees_BlueCollar').doc(employeeId),
  );
  if (!snapshot.exists) {
    throw new HttpError(404, 'Data Pekarya tidak ditemukan.');
  }
  return snapshot.data()!;
}

export interface EmployeeConversionPreview {
  employee: { id: string; name: string; jobCategory: string; nipy: string };
  effectivePeriod: string;
  blockers: EmployeeConversionIssue[];
  warnings: EmployeeConversionIssue[];
  linkedAccount: { uid: string; email: string | null; displayName: string; role: string } | null;
  prefill: LoyalisConversionInput;
  canSetLevelCode: boolean;
  /** The Pekarya BPJS allowance, so the admin can split it into TK and Kesehatan. */
  pekaryaBpjsAllowance: number;
}

export async function previewEmployeeConversion(
  actor: AuthenticatedProfile,
  employeeId: string,
): Promise<EmployeeConversionPreview> {
  const employee = await loadBlueCollar(employeeId, directReader);
  const nipy = normalizeNipy(employee.nipy);
  const nipyOwnedElsewhere = await findOtherNipyOwner(employeeId, nipy);
  const { facts, linkedAccountSnapshot } = await gatherFacts(
    directReader,
    employeeId,
    employee,
    jakartaToday(),
    { levelCodeProvided: false, nipyOwnedElsewhere },
  );
  const { blockers, warnings } = collectConversionIssues(facts);
  const account = linkedAccountSnapshot?.data();
  return {
    employee: {
      id: employeeId,
      name: String(employee.name || ''),
      jobCategory: String(employee.employment?.jobCategory || ''),
      nipy,
    },
    effectivePeriod: facts.effectivePeriod,
    blockers,
    warnings,
    linkedAccount: linkedAccountSnapshot
      ? {
          uid: linkedAccountSnapshot.id,
          email: typeof account?.email === 'string' ? account.email : null,
          displayName: String(account?.displayName || ''),
          role: String(account?.role || ''),
        }
      : null,
    prefill: prefillLoyalisConversionInput(employee),
    canSetLevelCode: actor.role === 'super_admin',
    pekaryaBpjsAllowance: Math.max(0, Math.round(Number(employee.bpjs?.allowanceAmount) || 0)),
  };
}

export interface EmployeeConversionCommand {
  employeeId: string;
  input: LoyalisConversionInput;
  reason: string;
  requestId: string;
}

export function parseEmployeeConversionCommand(
  value: unknown,
  actor: AuthenticatedProfile,
): EmployeeConversionCommand {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'Payload pengalihan tidak valid.');
  }
  const body = value as Record<string, unknown>;
  const employeeId = assertBlueCollarEmployeeId(body.employeeId);
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
    throw new HttpError(400, 'requestId tidak valid.');
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (
    reason.length < EMPLOYEE_CONVERSION_REASON_MIN_LENGTH ||
    reason.length > EMPLOYEE_CONVERSION_REASON_MAX_LENGTH
  ) {
    throw new HttpError(
      400,
      `Alasan wajib diisi antara ${EMPLOYEE_CONVERSION_REASON_MIN_LENGTH} dan ${EMPLOYEE_CONVERSION_REASON_MAX_LENGTH} karakter.`,
    );
  }
  const input = parseLoyalisConversionInput(body.input);
  const errors = validateLoyalisConversionInput(input, {
    canSetLevelCode: actor.role === 'super_admin',
  });
  const firstError = Object.values(errors)[0];
  if (firstError) throw new HttpError(400, firstError);
  return { employeeId, input, reason, requestId };
}

export interface EmployeeConversionResult {
  loyalisEmployeeId: string;
  effectivePeriod: string;
  linkedAccountUid: string | null;
  idempotent: boolean;
}

/**
 * Converts one Pekarya into a new Loyalis record in a single transaction: the
 * new record, the closed old one, the NIPY index, the login account, two audit
 * rows and the idempotency key either all land or none do.
 */
export async function convertEmployeeToLoyalis(
  actor: AuthenticatedProfile,
  command: EmployeeConversionCommand,
): Promise<EmployeeConversionResult> {
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        employeeId: command.employeeId,
        input: command.input,
        reason: command.reason,
      }),
    )
    .digest('hex');
  const idempotencyRef = adminDb
    .collection('FinancialIdempotencyKeys')
    .doc(`${actor.uid}__${command.requestId}`);
  const blueRef = adminDb.collection('Employees_BlueCollar').doc(command.employeeId);

  // The cross-collection NIPY scan is too wide for the transaction; the index
  // document for the NIPY is re-checked inside it instead.
  const preEmployee = await loadBlueCollar(command.employeeId, directReader).catch(() => null);
  const nipyOwnedElsewhere = preEmployee
    ? await findOtherNipyOwner(command.employeeId, normalizeNipy(preEmployee.nipy))
    : null;

  return adminDb.runTransaction(async (transaction) => {
    const reader = transactionReader(transaction);
    const idempotencySnapshot = await transaction.get(idempotencyRef);
    if (idempotencySnapshot.exists) {
      const previous = idempotencySnapshot.data()!;
      if (previous.requestHash !== requestHash || previous.entityId !== command.employeeId) {
        throw new HttpError(409, 'requestId sudah digunakan untuk perintah berbeda.');
      }
      return {
        loyalisEmployeeId: String(previous.loyalisEmployeeId || ''),
        effectivePeriod: String(previous.effectivePeriod || ''),
        linkedAccountUid: previous.linkedAccountUid ? String(previous.linkedAccountUid) : null,
        idempotent: true,
      };
    }

    const employee = await loadBlueCollar(command.employeeId, reader);
    const nipy = normalizeNipy(employee.nipy);
    const indexRef = nipy
      ? adminDb.collection(ATTENDANCE_IDENTITIES_COLLECTION).doc(attendanceIdentityDocumentId(nipy))
      : null;
    const [gathered, loyalisIdsSnapshot, indexSnapshot] = await Promise.all([
      gatherFacts(reader, command.employeeId, employee, jakartaToday(), {
        levelCodeProvided: Boolean(command.input.levelCode),
        nipyOwnedElsewhere,
      }),
      transaction.get(adminDb.collection('Employees_Loyalis').select()),
      indexRef ? transaction.get(indexRef) : Promise.resolve(null),
    ]);
    const { facts, linkedAccountSnapshot } = gathered;
    if (
      indexSnapshot?.exists &&
      (indexSnapshot.data()?.employeeId !== command.employeeId ||
        indexSnapshot.data()?.employeeCollection !== 'Employees_BlueCollar')
    ) {
      facts.nipyOwnedElsewhere = `${indexSnapshot.data()?.employeeId || 'pegawai lain'}`;
    }
    const { blockers } = collectConversionIssues(facts);
    if (blockers.length > 0) {
      throw new HttpError(409, blockers.map((issue) => issue.message).join(' '));
    }

    const loyalisEmployeeId = nextLoyalisEmployeeId(
      loyalisIdsSnapshot.docs.map((snapshot) => snapshot.id),
    );
    const loyalisRef = adminDb.collection('Employees_Loyalis').doc(loyalisEmployeeId);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const effectivePeriod = facts.effectivePeriod;
    const loyalisDocument = buildLoyalisEmployeeDocument(employee, command.input);

    transaction.create(loyalisRef, {
      ...loyalisDocument,
      conversion: {
        fromCollection: 'Employees_BlueCollar',
        fromEmployeeId: command.employeeId,
        effectivePeriod,
        convertedAt: now,
        convertedByUid: actor.uid,
        requestId: command.requestId,
      },
      audit: {
        createdAt: now,
        updatedAt: now,
        updatedBy: actor.uid,
        sourceFile: 'Pengalihan dari Pekarya',
      },
    });

    const endDate = lastDayBeforePeriod(effectivePeriod);
    transaction.update(blueRef, {
      'employment.status': 'inactive',
      'employment.endDate': endDate,
      'flags.isActive': false,
      'flags.isPayrollEligible': false,
      nipy: admin.firestore.FieldValue.delete(),
      conversion: {
        toCollection: 'Employees_Loyalis',
        toEmployeeId: loyalisEmployeeId,
        effectivePeriod,
        previousNipy: nipy || null,
        convertedAt: now,
        convertedByUid: actor.uid,
        requestId: command.requestId,
      },
      'audit.updatedAt': now,
      'audit.updatedBy': actor.uid,
    });

    if (indexRef) {
      transaction.set(indexRef, {
        nipy,
        employeeId: loyalisEmployeeId,
        employeeCollection: 'Employees_Loyalis',
        updatedAt: now,
        updatedBy: actor.uid,
        schemaVersion: 1,
      });
    }

    const account = linkedAccountSnapshot?.data();
    const departmentUnit = command.input.departmentUnit;
    if (linkedAccountSnapshot) {
      transaction.update(linkedAccountSnapshot.ref, {
        role: 'loyalis',
        linkedEmployeeId: loyalisEmployeeId,
        permittedCategories: [departmentUnit],
        updatedAt: now,
        updatedByUid: actor.uid,
      });
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'USER_PROFILE_UPDATED',
          entityType: 'User',
          entityId: linkedAccountSnapshot.id,
          reason: command.reason,
          requestId: command.requestId,
          before: {
            email: account?.email || null,
            role: account?.role || null,
            linkedEmployeeId: account?.linkedEmployeeId || null,
          },
          after: {
            email: account?.email || null,
            role: 'loyalis',
            linkedEmployeeId: loyalisEmployeeId,
          },
          metadata: { source: 'employee_conversion' },
        }),
      );
    }

    transaction.create(
      newFinancialAuditRef(),
      buildFinancialAuditRecord(actor, {
        action: 'EMPLOYEE_CONVERTED_TO_LOYALIS',
        entityType: 'Employees_BlueCollar',
        entityId: command.employeeId,
        reason: command.reason,
        requestId: command.requestId,
        before: {
          employeeId: command.employeeId,
          collection: 'Employees_BlueCollar',
          name: employee.name || null,
          jobCategory: employee.employment?.jobCategory || null,
          employmentStatus: employee.employment?.status || null,
          nipy: nipy || null,
          koperasiAuthUid: employee.koperasiAuthUid || null,
        },
        after: {
          employeeId: loyalisEmployeeId,
          collection: 'Employees_Loyalis',
          name: command.input.name,
          departmentUnit,
          loyalisType: command.input.loyalisType,
          levelCode: command.input.levelCode || null,
          dateOfHire: command.input.dateOfHire,
          dateRecognized: command.input.dateRecognized || null,
          nipy: nipy || null,
          effectivePeriod,
          blueCollarEndDate: endDate,
        },
        metadata: { linkedAccountUid: linkedAccountSnapshot?.id || null },
      }),
    );

    transaction.create(idempotencyRef, {
      requestHash,
      entityType: 'EmployeeConversion',
      entityId: command.employeeId,
      loyalisEmployeeId,
      effectivePeriod,
      linkedAccountUid: linkedAccountSnapshot?.id || null,
      createdAt: now,
    });

    return {
      loyalisEmployeeId,
      effectivePeriod,
      linkedAccountUid: linkedAccountSnapshot?.id || null,
      idempotent: false,
    };
  });
}
