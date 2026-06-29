rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // ─── HELPER FUNCTIONS ────────────────────────────────────────────────────
    
    // Checks if the requester is authenticated
    function isAuthenticated() {
      return request.auth != null;
    }

    // Checks if the requester has a registered profile document in Firestore
    function hasProfile() {
      return isAuthenticated() && exists(/databases/$(database)/documents/users/$(request.auth.uid));
    }

    // Retrieves the requester's profile data
    function getUserData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    // Checks if the requester is a Super Administrator (BAK)
    function isSuperAdmin() {
      return hasProfile() && getUserData().role == 'super_admin';
    }

    // Checks if the requester is an Employee Administrator
    function isEmployeeAdmin() {
      return hasProfile() && getUserData().role == 'employee_admin';
    }

    // Retrieves the list of permitted SatKers (categories) for standard users
    function getPermittedCategories() {
      return getUserData().permittedCategories;
    }

    // ─── RULES ───────────────────────────────────────────────────────────────

    // 1. User Profiles
    match /users/{uid} {
      // Any authenticated user can read their own profile to verify their role/permissions during login
      allow read: if isAuthenticated() && (request.auth.uid == uid || isSuperAdmin());
      // Only Super Admins can register, edit, or delete user accounts
      allow write: if isSuperAdmin();
    }

    // 2. Employees (Blue Collar)
    match /Employees_BlueCollar/{employeeId} {
      // Standard users can view the employee directory to populate category lists and select dropdowns
      allow read: if isSuperAdmin() || isEmployeeAdmin() || hasProfile();
      // Only Super Admins or Employee Admins can add or edit employee records
      allow write: if isSuperAdmin() || isEmployeeAdmin();
    }

    // 3. Employees (White Collar - Legacy)
    match /Employees_WhiteCollar/{employeeId} {
      // Standard users can view the employee directory
      allow read: if isSuperAdmin() || isEmployeeAdmin() || hasProfile();
      // Only Super Admins or Employee Admins can add or edit employee records
      allow write: if isSuperAdmin() || isEmployeeAdmin();
    }

    // 3b. Employees (White Collar - Loyalis)
    match /Employees_Loyalis/{employeeId} {
      // Standard users can view the employee directory
      allow read: if isSuperAdmin() || isEmployeeAdmin() || hasProfile();
      // Only Super Admins or Employee Admins can add or edit employee records
      allow write: if isSuperAdmin() || isEmployeeAdmin();
    }

    // 4. Salary Matrix — Blue Collar (Base Wages configuration)
    match /SalaryMatrix/{version} {
      // Super Admins can manage, any profile user can read
      allow read: if hasProfile();
      allow write: if isSuperAdmin();
      
      match /rows/{rowId} {
        allow read: if hasProfile();
        allow write: if isSuperAdmin();
      }
    }

    // 4b. Salary Matrix — White Collar (Base Wages configuration)
    match /SalaryMatrix_WhiteCollar/{version} {
      // Super Admins can manage, any profile user can read
      allow read: if hasProfile();
      allow write: if isSuperAdmin();
      
      match /rows/{rowId} {
        allow read: if hasProfile();
        allow write: if isSuperAdmin();
      }
    }

    // 4c. Salary Matrix — Functional (Workload and education allowance configuration)
    match /SalaryMatrix_Functional/{version} {
      // Super Admins can manage, any profile user can read
      allow read: if hasProfile();
      allow write: if isSuperAdmin();
      
      match /rows/{rowId} {
        allow read: if hasProfile();
        allow write: if isSuperAdmin();
      }
    }

    // 4d. Salary Matrix — Kepangkatan (Credit score allowance configuration)
    match /SalaryMatrix_Kepangkatan/{version} {
      // Super Admins can manage, any profile user can read
      allow read: if hasProfile();
      allow write: if isSuperAdmin();
      
      match /rows/{rowId} {
        allow read: if hasProfile();
        allow write: if isSuperAdmin();
      }
    }

    // 5. Uraian Gaji (Attendance and Presensi Rekap Entries)
    match /UraianGaji/{docId} {
      // Standard users can only read presensi rekap for their assigned SatKers
      allow read: if isSuperAdmin() || (
        hasProfile() && 
        (resource == null || resource.data.jobCategory in getPermittedCategories())
      );
      
      // Standard users can only write (create/update) data for their assigned SatKers
      allow write: if isSuperAdmin() || (
        hasProfile() && 
        (
          (request.resource != null && request.resource.data.jobCategory in getPermittedCategories()) ||
          (resource != null && resource.data.jobCategory in getPermittedCategories())
        )
      );
    }

    // 5b. Vakasi Tambahan (Variable Payout Event Entries for Loyalis)
    match /VakasiTambahan/{docId} {
      // Authenticated users with a registered profile (Super Admin and SatKer Loyalis) can read and write variable payouts
      allow read, write: if isSuperAdmin() || hasProfile();
    }

    // 5c. Payroll Slip States (Persisted verified states of employee payslips)
    match /PayrollSlipStates/{docId} {
      // Authenticated users with a registered profile can read and write payslip states
      allow read, write: if isSuperAdmin() || hasProfile();
    }

    // 5d. Kegiatan SPJ (Variable Payout Event Entries for Blue Collar / Pekarya)
    match /KegiatanSpj/{docId} {
      // Authenticated users with a registered profile can read and write variable payouts
      allow read, write: if isSuperAdmin() || hasProfile();
    }

    // 5e. Loyalis Presence (Calculated stratum presence inputs for Loyalis)
    match /LoyalisPresence/{docId} {
      // Authenticated users with a registered profile (Super Admin and SatKer Loyalis) can read and write presence calculations
      allow read, write: if isSuperAdmin() || hasProfile();
    }

    // 5f. Pelaporan Kegiatan (Activity Reports for Loyalis)
    match /PelaporanKegiatan/{docId} {
      // Authenticated users with a registered profile (Super Admin and SatKer Loyalis) can read and write
      allow read, write: if isSuperAdmin() || hasProfile();
    }

    // 6. EmpEditLog (Employee Edit / Change Audit Logs)
    match /EmpEditLog/{docId} {
      // Only Super Admins can view change logs
      allow read: if isSuperAdmin();
      // Super Admins or Employee Admins can write logs
      allow write: if isSuperAdmin() || isEmployeeAdmin();
    }

    // 7. Activity Reports (Daily Activity submissions for Honorer)
    match /ActivityReports/{reportId} {
      // Super Admins can read all.
      // SatKer Heads can read if the report is in their permitted job categories.
      // Honorer employees can read their own reported activities.
      allow read: if isSuperAdmin() || (
        hasProfile() && (
          (getUserData().role == 'satker_head' && resource.data.jobCategory in getPermittedCategories()) ||
          (getUserData().role == 'honorer' && resource.data.employeeId == getUserData().linkedEmployeeId)
        )
      );

      // Honorer employees can create a report for themselves.
      // Must start with 'pending' status and 0 fee.
      allow create: if isSuperAdmin() || (
        hasProfile() && 
        getUserData().role == 'honorer' && 
        request.resource.data.employeeId == getUserData().linkedEmployeeId &&
        request.resource.data.status == 'pending' &&
        request.resource.data.fee == 0
      );

      // Super Admins can update all.
      // SatKer Heads can approve (assign fee) or decline reports for their category.
      // Honorer employees can edit/resubmit their own pending or declined reports.
      allow update: if isSuperAdmin() || (
        hasProfile() && (
          (
            getUserData().role == 'satker_head' &&
            resource.data.jobCategory in getPermittedCategories() &&
            request.resource.data.jobCategory == resource.data.jobCategory &&
            request.resource.data.employeeId == resource.data.employeeId &&
            request.resource.data.activityName == resource.data.activityName &&
            request.resource.data.activityDate == resource.data.activityDate &&
            request.resource.data.timeStart == resource.data.timeStart &&
            request.resource.data.timeEnd == resource.data.timeEnd &&
            (request.resource.data.status == 'approved' || request.resource.data.status == 'declined')
          ) ||
          (
            getUserData().role == 'honorer' &&
            resource.data.employeeId == getUserData().linkedEmployeeId &&
            (resource.data.status == 'pending' || resource.data.status == 'declined') &&
            request.resource.data.employeeId == getUserData().linkedEmployeeId &&
            request.resource.data.status == 'pending' &&
            request.resource.data.fee == 0
          )
        )
      );

      // Only Super Admins can delete reports.
      allow delete: if isSuperAdmin();
    }

    // 8. Predefined Structural Positions configuration
    match /JabatanStruktural/{docId} {
      // Any authenticated user with a profile can read the structural positions list
      allow read: if isSuperAdmin() || isEmployeeAdmin() || hasProfile();
      // Only Super Admins can edit or manage the structural positions master data
      allow write: if isSuperAdmin();
    }

    // 9. Settings and configurations (e.g. department lists)
    match /Settings/{docId} {
      // Any authenticated user with a profile can read the settings documents
      allow read: if hasProfile();
      // Only Super Admins or Employee Admins can create or update settings
      allow create, update: if (isSuperAdmin() || isEmployeeAdmin()) &&
                            (docId != 'departments' || (
                              request.resource.data.keys().hasOnly(['list']) &&
                              request.resource.data.list is list &&
                              request.resource.data.list.size() <= 100
                            ));
      // Only Super Admins can delete settings documents
      allow delete: if isSuperAdmin();
    }
  }
}