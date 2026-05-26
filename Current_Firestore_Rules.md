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
      // Standard users can only view employees in their assigned job categories (SatKers)
      allow read: if isSuperAdmin() || isEmployeeAdmin() || (
        hasProfile() && 
        resource.data.employment.jobCategory in getPermittedCategories()
      );
      // Only Super Admins or Employee Admins can add or edit employee records
      allow write: if isSuperAdmin() || isEmployeeAdmin();
    }

    // 3. Employees (White Collar - Legacy)
    match /Employees_WhiteCollar/{employeeId} {
      // Standard users can only view employees in their assigned job categories (SatKers)
      allow read: if isSuperAdmin() || isEmployeeAdmin() || (
        hasProfile() && 
        resource.data.employment.jobCategory in getPermittedCategories()
      );
      // Only Super Admins or Employee Admins can add or edit employee records
      allow write: if isSuperAdmin() || isEmployeeAdmin();
    }

    // 3b. Employees (White Collar - Loyalis)
    match /Employees_Loyalis/{employeeId} {
      // Standard users can only view employees in their assigned job roles (SatKers)
      allow read: if isSuperAdmin() || isEmployeeAdmin() || (
        hasProfile() && (
          resource.data.employment_profile.job_role in getPermittedCategories() ||
          resource.data.employment_profile.job_role.upper() in getPermittedCategories() ||
          resource.data.employment.jobCategory in getPermittedCategories()
        )
      );
      // Only Super Admins or Employee Admins can add or edit employee records
      allow write: if isSuperAdmin() || isEmployeeAdmin();
    }

    // 4. Salary Matrix — Blue Collar (Base Wages configuration)
    match /SalaryMatrix/{version} {
      // Only Super Admins can read or write the master salary configuration
      allow read, write: if isSuperAdmin();
      
      match /rows/{rowId} {
        allow read, write: if isSuperAdmin();
      }
    }

    // 4b. Salary Matrix — White Collar (Base Wages configuration)
    match /SalaryMatrix_WhiteCollar/{version} {
      // Only Super Admins can read or write the white collar salary configuration
      allow read, write: if isSuperAdmin();
      
      match /rows/{rowId} {
        allow read, write: if isSuperAdmin();
      }
    }

    // 4c. Salary Matrix — Functional (Workload and education allowance configuration)
    match /SalaryMatrix_Functional/{version} {
      // Only Super Admins can read or write the functional salary configuration
      allow read, write: if isSuperAdmin();
      
      match /rows/{rowId} {
        allow read, write: if isSuperAdmin();
      }
    }

    // 5. Uraian Gaji (Attendance and Presensi Rekap Entries)
    match /UraianGaji/{docId} {
      // Standard users can only read presensi rekap for their assigned SatKers
      allow read: if isSuperAdmin() || (
        hasProfile() && 
        resource.data.jobCategory in getPermittedCategories()
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
      // Authenticated users with a registered profile can read and write variable payouts
      allow read, write: if isSuperAdmin() || hasProfile();
    }

    // 5c. Payroll Slip States (Persisted verified states of employee payslips)
    match /PayrollSlipStates/{docId} {
      // Authenticated users with a registered profile can read and write payslip states
      allow read, write: if isSuperAdmin() || hasProfile();
    }

    // 6. EmpEditLog (Employee Edit / Change Audit Logs)
    match /EmpEditLog/{docId} {
      // Only Super Admins can view change logs
      allow read: if isSuperAdmin();
      // Super Admins or Employee Admins can write logs
      allow write: if isSuperAdmin() || isEmployeeAdmin();
    }
  }
}