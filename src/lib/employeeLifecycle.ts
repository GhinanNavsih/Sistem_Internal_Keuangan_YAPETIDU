type Data = Record<string, unknown>;

function record(value: unknown): Data {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
}

export function employeeIsActive(collection: string, value: unknown): boolean {
  const data = record(value);
  if (collection === 'Employees_Loyalis') return record(data.personal_info).status === 'AKTIF';
  return record(data.employment).status === 'active' && record(data.flags).isActive !== false &&
    record(data.flags).isPayrollEligible !== false;
}

/** Called inside the same transaction as a profile save, using its latest stored audit. */
export function employeeLifecycleAudit(input: {
  collection: string;
  before?: Data;
  patch: Data;
  timestamp: unknown;
  actorUid: string;
  eventId: string;
}): Data {
  const { collection, before, patch, timestamp, actorUid, eventId } = input;
  const previousAudit = record(before?.audit);
  const audit: Data = { ...previousAudit, ...record(patch.audit), updatedAt: timestamp };
  // A form opened before another status change must not erase that history.
  for (const field of ['createdAt', 'statusChangedAt', 'lastActivatedAt', 'lastDeactivatedAt', 'employmentStatusHistory']) {
    delete audit[field];
    if (field in previousAudit) audit[field] = previousAudit[field];
  }
  if (!before) audit.createdAt = timestamp;
  const after: Data = { ...before, ...patch };
  for (const field of ['personal_info', 'employment', 'flags']) {
    after[field] = { ...record(before?.[field]), ...record(patch[field]) };
  }
  const fromActive = before ? employeeIsActive(collection, before) : null;
  const toActive = employeeIsActive(collection, after);
  if (!before || fromActive !== toActive) {
    audit.statusChangedAt = timestamp;
    if (before || toActive) audit[toActive ? 'lastActivatedAt' : 'lastDeactivatedAt'] = timestamp;
    audit.employmentStatusHistory = {
      ...record(previousAudit.employmentStatusHistory),
      [eventId]: {
        action: !before ? 'created' : toActive ? 'activated' : 'deactivated',
        fromActive,
        toActive,
        occurredAt: timestamp,
        actorUid,
      },
    };
  }
  return audit;
}
