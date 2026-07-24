rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function hasProfile() {
      return signedIn() &&
        exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.disabled != true;
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
      allow read: if signedIn() && (request.auth.uid == uid || isSuperAdmin());
      allow create, update, delete: if false;
    }

    // Employee documents contain bank and salary data. Employees can read only
    // their own record. Ketua Shift receives a redacted directory from the API.
    match /Employees_BlueCollar/{employeeId} {
      allow read: if isFinanceRole() || isEmployeeAdmin() ||
        (roleIs('satker_head') &&
          hasCategory(resource.data.employment.jobCategory)) ||
        ownsEmployee(employeeId);
      allow create, update: if isSuperAdmin() || isEmployeeAdmin();
      allow delete: if false;
    }

    match /Employees_WhiteCollar/{employeeId} {
      allow read: if isFinanceRole() || isEmployeeAdmin() || ownsEmployee(employeeId);
      allow create, update: if isSuperAdmin() || isEmployeeAdmin();
      allow delete: if false;
    }

    match /Employees_Loyalis/{employeeId} {
      allow read: if isFinanceRole() || isEmployeeAdmin() ||
        roleIs('satker_head_loyalis') || ownsEmployee(employeeId);
      allow create, update: if isSuperAdmin() || isEmployeeAdmin();
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
      allow read: if isFinanceRole() ||
        (isSatkerRole() && hasCategory(resource.data.jobCategory));
      allow create: if isFinanceVerifier() || isSuperAdmin() ||
        (roleIs('satker_head') && hasCategory(request.resource.data.jobCategory));
      allow update: if isFinanceVerifier() || isSuperAdmin() ||
        (
          roleIs('satker_head') &&
          hasCategory(resource.data.jobCategory) &&
          request.resource.data.jobCategory == resource.data.jobCategory &&
          request.resource.data.period == resource.data.period
        );
      allow delete: if false;
    }

    match /VakasiTambahan/{docId} {
      allow read: if isFinanceRole() || roleIs('satker_head_loyalis');
      allow create, update: if isFinanceVerifier() || isSuperAdmin() ||
        roleIs('satker_head_loyalis');
      allow delete: if false;
    }

    match /KegiatanSpj/{docId} {
      allow read: if isFinanceRole() ||
        (roleIs('satker_head') && hasCategory(resource.data.jobCategory));
      // Financial event mutations are validated, audited, and made idempotent
      // by /api/pekarya/spj-events.
      allow create, update, delete: if false;
    }

    match /PayrollSlipStates/{docId} {
      allow read: if isFinanceRole() ||
        (ownsEmployee(resource.data.employeeId) && isFinalSlipStatus(resource.data.status));
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

    match /ShiftOccurrences/{occurrenceId} {
      allow read: if isFinanceRole() ||
        (roleIs('ketua_shift_satpam') &&
          resource.data.ketuaShiftId == profile().linkedEmployeeId);
      allow write: if false;
    }

    match /GuardDutyIndexes/{indexId} {
      allow read: if isFinanceRole();
      allow write: if false;
    }

    match /DriverJourneys/{journeyId} {
      allow read: if isFinanceRole() ||
        (roleIs('satker_head') && hasCategory('SOPIR')) ||
        (resource.data.employeeId is string && ownsEmployee(resource.data.employeeId));
      allow create, update: if isSuperAdmin() ||
        (roleIs('satker_head') && hasCategory('SOPIR')) ||
        (
          request.resource.data.employeeId is string &&
          ownsEmployee(request.resource.data.employeeId) &&
          request.resource.data.status in ['available', 'claimed', 'submitted']
        );
      allow delete: if false;
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
      allow read: if isFinanceRole();
      allow write: if false;
    }

    // Everything not explicitly listed is denied.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
