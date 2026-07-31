rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function hasProfile() {
      return signedIn() &&
        exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
        // Existing profiles may predate the disabled flag. Map.get keeps those
        // accounts enabled while still failing closed when disabled is true.
        get(/databases/$(database)/documents/users/$(request.auth.uid))
          .data.get('disabled', false) == false;
    }

    function profile() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function roleIs(role) {
      return hasProfile() && profile().role == role;
    }

    function isSuperAdmin() {
      return roleIs('super_admin');
    }

    function isEmployeeAdmin() {
      return roleIs('employee_admin');
    }

    function isFinanceVerifier() {
      return roleIs('finance_verifier');
    }

    function isPayrollAuthorizer() {
      return roleIs('payroll_authorizer');
    }

    function isFinanceRole() {
      return isSuperAdmin() || isFinanceVerifier() || isPayrollAuthorizer();
    }

    function isSatkerRole() {
      return roleIs('satker_head') || roleIs('satker_head_loyalis');
    }

    function ownsEmployee(employeeId) {
      return hasProfile() &&
        profile().linkedEmployeeId is string &&
        profile().linkedEmployeeId == employeeId;
    }

    function hasCategory(category) {
      return hasProfile() &&
        profile().permittedCategories is list &&
        category in profile().permittedCategories;
    }

    function isFinalSlipStatus(status) {
      return status in ['confirmed', 'locked', 'payment_created', 'paid'];
    }

    match /users/{uid} {
      // Profile bootstrap must not depend on hasProfile(), otherwise the first
      // profile read after Firebase Authentication becomes circular. A user can
      // fetch only their own document; listing profiles remains super-admin only.
      allow get: if signedIn() && (request.auth.uid == uid || isSuperAdmin());
      allow list: if isSuperAdmin();
      allow create, update, delete: if false;
    }

    // Read-only compatibility for historical employee references. New records
    // belong in the typed employee collections below.
    match /Employees/{employeeId} {
      allow read: if signedIn();
      allow write: if false;
    }

    // Employee documents contain bank and salary data. Employees can read only
    // their own record. Ketua Shift receives a redacted directory from the API.
    match /Employees_BlueCollar/{employeeId} {
      allow read: if signedIn();
      allow create: if (isSuperAdmin() || isEmployeeAdmin()) &&
        !request.resource.data.keys().hasAny(['nipy', 'nipyAssignment']);
      allow update: if (isSuperAdmin() || isEmployeeAdmin()) &&
        request.resource.data.get('nipy', null) == resource.data.get('nipy', null) &&
        request.resource.data.get('nipyAssignment', null) ==
          resource.data.get('nipyAssignment', null);
      allow delete: if false;
    }

    match /Employees_WhiteCollar/{employeeId} {
      allow read: if signedIn();
      allow create: if (isSuperAdmin() || isEmployeeAdmin()) &&
        !request.resource.data.keys().hasAny(['nipy']);
      allow update: if (isSuperAdmin() || isEmployeeAdmin()) &&
        request.resource.data.get('nipy', null) == resource.data.get('nipy', null);
      allow delete: if false;
    }

    match /Employees_Loyalis/{employeeId} {
      allow read: if signedIn();
      allow create: if (isSuperAdmin() || isEmployeeAdmin()) &&
        !request.resource.data.keys().hasAny(['nipy']) &&
        request.resource.data.get('personal_info', {})
          .get('employee_id_niy', null) == null;
      allow update: if (isSuperAdmin() || isEmployeeAdmin()) &&
        request.resource.data.get('nipy', null) == resource.data.get('nipy', null) &&
        request.resource.data.get('personal_info', {})
          .get('employee_id_niy', null) ==
          resource.data.get('personal_info', {}).get('employee_id_niy', null);
      allow delete: if false;
    }

    match /SalaryMatrix/{version} {
      allow read: if isFinanceRole() || isEmployeeAdmin() || isSatkerRole();
      allow create, update: if isSuperAdmin();
      allow delete: if false;
      match /rows/{rowId} {
        allow read: if isFinanceRole() || isEmployeeAdmin() || isSatkerRole();
        allow create, update: if isSuperAdmin();
        allow delete: if false;
      }
    }

    match /SalaryMatrix_WhiteCollar/{version} {
      allow read: if isFinanceRole() || isEmployeeAdmin() || roleIs('satker_head_loyalis');
      allow create, update: if isSuperAdmin();
      allow delete: if false;
      match /rows/{rowId} {
        allow read: if isFinanceRole() || isEmployeeAdmin() || roleIs('satker_head_loyalis');
        allow create, update: if isSuperAdmin();
        allow delete: if false;
      }
    }

    match /SalaryMatrix_Functional/{version} {
      allow read: if isFinanceRole() || isEmployeeAdmin() || roleIs('satker_head_loyalis');
      allow create, update: if isSuperAdmin();
      allow delete: if false;
      match /rows/{rowId} {
        allow read: if isFinanceRole() || isEmployeeAdmin() || roleIs('satker_head_loyalis');
        allow create, update: if isSuperAdmin();
        allow delete: if false;
      }
    }

    match /SalaryMatrix_Kepangkatan/{version} {
      allow read: if isFinanceRole() || isEmployeeAdmin() || roleIs('satker_head_loyalis');
      allow create, update: if isSuperAdmin();
      allow delete: if false;
      match /rows/{rowId} {
        allow read: if isFinanceRole() || isEmployeeAdmin() || roleIs('satker_head_loyalis');
        allow create, update: if isSuperAdmin();
        allow delete: if false;
      }
    }

    // Rekap inputs remain editable only before payslip verification. Final
    // payslips never inherit later changes because they contain a hashed snapshot.
    match /UraianGaji/{docId} {
      allow read: if signedIn();
      allow create, update: if isFinanceVerifier() || isSuperAdmin() || isSatkerRole();
      allow delete: if false;
    }

    match /VakasiTambahan/{docId} {
      allow read: if isFinanceRole() || roleIs('satker_head_loyalis');
      allow create, update: if isFinanceVerifier() || isSuperAdmin() ||
        roleIs('satker_head_loyalis');
      allow delete: if false;
    }

    match /KegiatanSpj/{docId} {
      allow read: if signedIn();
      // Financial event mutations are validated, audited, and made idempotent
      // by /api/pekarya/spj-events.
      allow create, update, delete: if false;
    }

    match /PayrollSlipStates/{docId} {
      allow read: if signedIn();
      // All mutations go through /api/payroll/slips and Firebase Admin.
      allow create, update, delete: if false;
    }

    match /PayrollPayments/{docId} {
      allow read: if isFinanceRole();
      allow write: if false;
    }

    match /PayrollCorrectionRequests/{docId} {
      allow read: if isFinanceRole();
      allow write: if false;
    }

    match /PayrollLedgerEntries/{docId} {
      allow read: if isFinanceRole();
      allow write: if false;
    }

    match /FinancialAuditLogs/{docId} {
      allow read: if isFinanceRole();
      allow write: if false;
    }

    match /FinancialIdempotencyKeys/{docId} {
      allow read, write: if false;
    }

    match /PayrollDeliveryEvents/{docId} {
      allow read: if isFinanceRole();
      allow write: if false;
    }

    match /PayrollPeriods/{period} {
      allow read: if isFinanceRole();
      allow write: if false;
    }

    match /PayrollHolidayCalendars/{year} {
      allow read: if isFinanceRole();
      allow write: if false;
    }

    // Shared attendance state is exposed through scoped APIs. Detailed scan
    // rows and correction overlays are never mutated directly by a browser.
    match /AttendanceImports/{period} {
      allow read: if isFinanceRole() || roleIs('loyalis_presence_admin');
      allow write: if false;
    }

    match /AttendanceImportRevisions/{revisionId} {
      allow read: if isFinanceRole() || roleIs('loyalis_presence_admin');
      allow write: if false;
    }

    match /AttendanceImportRows/{rowId} {
      allow read, write: if false;
    }

    match /AttendanceIdentityIndex/{identityId} {
      allow read, write: if false;
    }

    match /PekaryaNipySequences/{prefixCode} {
      allow read, write: if false;
    }

    match /PekaryaAttendanceCorrections/{correctionId} {
      allow read, write: if false;
    }

    match /PekaryaAttendanceCorrectionHeads/{headId} {
      allow read, write: if false;
    }

    match /PekaryaAttendancePublications/{publicationId} {
      allow read, write: if false;
    }

    // Shift audit state (pending_review -> reviewed) is written only by
    // /api/satpam/shifts/review through the Admin SDK, so the Kepala SatKer's
    // verdict, the per-post fees, and the ledger postings cannot be forged.
    match /ShiftOccurrences/{occurrenceId} {
      allow read: if isFinanceRole() ||
        (roleIs('satker_head') && hasCategory('SATPAM')) ||
        (roleIs('ketua_shift_satpam') &&
          resource.data.ketuaShiftId == profile().linkedEmployeeId);
      allow write: if false;
    }

    match /GuardDutyIndexes/{indexId} {
      allow read: if isFinanceRole();
      allow write: if false;
    }

    match /DriverJourneys/{journeyId} {
      // Journey mutations are server-only. The API re-checks role, ownership,
      // payroll period, and the journey state inside Admin-SDK transactions.
      function canReadDriverJourney() {
        return isFinanceRole() ||
          (roleIs('satker_head') && hasCategory('SOPIR')) ||
          (
            roleIs('honorer') &&
            hasCategory('SOPIR') &&
            (
              ownsEmployee(resource.data.get('employeeId', '')) ||
              ownsEmployee(resource.data.get('assignedTo', '')) ||
              resource.data.get('status', '') in ['unassigned', 'open']
            )
          );
      }

      allow read: if canReadDriverJourney();
      allow create, update, delete: if false;
    }

    match /DriverPiketSchedules/{piketId} {
      allow read: if signedIn();
      allow create, update, delete: if isSuperAdmin() ||
        (roleIs('satker_head') && hasCategory('SOPIR'));
    }

    match /LoyalisPresence/{docId} {
      allow read: if isFinanceRole() || roleIs('satker_head_loyalis') ||
        roleIs('loyalis_presence_admin');
      allow create, update: if isFinanceVerifier() || isSuperAdmin() ||
        roleIs('loyalis_presence_admin');
      allow delete: if false;
    }

    match /PelaporanKegiatan/{docId} {
      allow read: if isFinanceRole() || roleIs('satker_head_loyalis');
      allow create, update: if isFinanceVerifier() || isSuperAdmin() ||
        roleIs('satker_head_loyalis');
      allow delete: if false;
    }

    match /ProposalKegiatan/{docId} {
      allow read: if isFinanceRole() || roleIs('satker_head_loyalis');
      allow create, update: if isFinanceVerifier() || isSuperAdmin() ||
        roleIs('satker_head_loyalis');
      allow delete: if false;
    }

    match /EmpEditLog/{docId} {
      allow read: if isSuperAdmin() || isEmployeeAdmin();
      allow create: if isSuperAdmin() || isEmployeeAdmin();
      allow update, delete: if false;
    }

    match /ActivityReports/{reportId} {
      allow read: if isFinanceRole() ||
        (roleIs('satker_head') && hasCategory(resource.data.jobCategory)) ||
        ownsEmployee(resource.data.employeeId) ||
        (
          roleIs('ketua_shift_satpam') &&
          resource.data.ketuaShiftId == profile().linkedEmployeeId
        );

      // Submission/resubmission and SatKer review are server-only so employee
      // identity, category, period, fee, status, and audit data cannot be forged.
      allow create, update, delete: if false;
    }

    match /ActivityReportRevisions/{revisionId} {
      allow read: if isFinanceRole() ||
        (roleIs('satker_head') && hasCategory(resource.data.snapshot.jobCategory)) ||
        ownsEmployee(resource.data.employeeId);
      // Every revision is created once by the submission API and is immutable.
      allow create, update, delete: if false;
    }

    match /PekaryaActivityIndexes/{indexId} {
      allow read, write: if false;
    }

    match /LoyalisPresenceCorrections/{requestId} {
      allow read: if isFinanceRole() || roleIs('loyalis_presence_admin') ||
        ownsEmployee(resource.data.employeeId);
      allow create: if roleIs('loyalis') &&
        ownsEmployee(request.resource.data.employeeId) &&
        request.resource.data.status == 'pending';
      allow update: if
        (
          roleIs('loyalis_presence_admin') &&
          resource.data.status == 'pending' &&
          request.resource.data.status in ['approved', 'rejected']
        ) ||
        (
          ownsEmployee(resource.data.employeeId) &&
          resource.data.status in ['pending', 'rejected'] &&
          request.resource.data.employeeId == resource.data.employeeId &&
          request.resource.data.status == 'pending'
        );
      allow delete: if false;
    }

    match /JabatanStruktural/{docId} {
      allow read: if isFinanceRole() || isEmployeeAdmin();
      allow create, update: if isSuperAdmin();
      allow delete: if false;
    }

    match /Settings/{docId} {
      allow read: if isFinanceRole() || isEmployeeAdmin() || isSatkerRole() ||
        roleIs('loyalis_presence_admin');
      allow create, update: if isSuperAdmin() || isEmployeeAdmin();
      allow delete: if false;
    }

    match /SatpamShiftTeams/{teamId} {
      allow read: if isFinanceRole() || isEmployeeAdmin() || isSatkerRole();
      allow write: if false;
    }

    // Monthly Satpam plans, absence decisions, entitlements, and bonus
    // reconciliation are exposed only through revision-checked server APIs.
    match /SatpamDutyPlans/{planId} {
      allow read, write: if false;
    }

    match /SatpamDutyPlanRevisions/{revisionId} {
      allow read, write: if false;
    }

    match /SatpamAbsenceRequests/{requestId} {
      allow read, write: if false;
    }

    match /SatpamAbsenceRequestRevisions/{revisionId} {
      allow read, write: if false;
    }

    match /SatpamAbsenceEntitlements/{entitlementId} {
      allow read, write: if false;
    }

    match /SatpamDutyReconciliations/{reconciliationId} {
      allow read, write: if false;
    }

    // Everything not explicitly listed is denied.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
