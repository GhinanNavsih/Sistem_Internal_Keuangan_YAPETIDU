// ─── Blue Collar ────────────────────────────────────────────────────────────

export interface BlueCollarEmployee {
  employeeId: string;        // e.g. "BC_001"
  nik: string | null;        // National ID (NIK)
  name: string;
  phoneNumber?: string;
  email?: string;
  collarType: 'blue_collar';
  employment: {
    status: 'active' | 'inactive';
    jobCategory: 'SOPIR' | 'SATPAM' | 'TEKNISI' | 'KEBERSIHAN' | 'KEBERSIHAN_IC' | string;
    startDate: string | null; // ISO "YYYY-MM-DD"
    endDate: string | null;
  };
  salaryProfile: {
    salaryGradeCode: string | null; // e.g. "D", "F", "K"
    baseSalaryAmount: number;
    salaryMatrixVersion: string;
    tunjanganBeras?: number;
  };
  bankAccount: {
    bankName: string | null;
    accountNumber: string | null;
    accountHolderName: string;
  };
  bpjs: {
    allowanceAmount: number;
    deductionAmount: number;
  };
  deductions: {
    koperasiRochmad: number;
    kodeKopRochmad?: number;
  };
  flags: {
    isActive: boolean;
    isPayrollEligible: boolean;
  };
}

// ─── White Collar (schema TBD when data is available) ───────────────────────

export interface WhiteCollarEmployee {
  employeeId: string;        // e.g. "WC_001"
  niy: string | null;        // Foundation ID (NIY)
  name: string;
  collarType: 'white_collar';
  employment: {
    status: 'active' | 'inactive';
    employmentType: string;
    unit: string;
    jobCategory: string;
    position: string;
    startDate: string | null;
    endDate: string | null;
  };
  bankAccount: {
    bankName: string | null;
    accountNumber: string | null;
    accountHolderName: string;
  };
  cooperative: {
    koperasiCode: string | null;
  };
  flags: {
    isActive: boolean;
    isPayrollEligible: boolean;
  };
}

// ─── Salary Matrix ───────────────────────────────────────────────────────────

export type SalaryMatrix = {
  [gradeLevel: string]: {
    [yearsOfService: number]: number;
  };
};

// ─── Legacy type (kept for payroll calculation utility) ──────────────────────

export interface Employee {
  id: string;
  name: string;
  role: string;
  gradeLevel: string;
  joinDate: Date;
  isActive: boolean;
  phoneNumber?: string;
  email?: string;
}

// ─── Rekap Presensi / Uraian Gaji ────────────────────────────────────────────

export interface RekapColumn {
  key: string;
  label: string;
  type: 'count' | 'currency';
  multiplier?: number;   // for 'count' types: value × multiplier = computed amount
  slipLabel?: string;    // corresponding label in the pay slip
}

export interface UraianEntry {
  employeeId: string;
  name: string;
  values: Record<string, number>; // column key → monetary nominal (count cols are multiplied)
  counts?: Record<string, number>; // column key → raw count (e.g. harian: 18, jumatLibur: 10)
}

export interface UraianGajiDocument {
  period: string;              // "2026-04"
  periodLabel: string;         // "April 2026"
  jobCategory: string;         // "KEBERSIHAN"
  workingDaysInMonth: number;
  entries: Record<string, UraianEntry>; // employeeId → entry
  customColumns?: RekapColumn[];
  createdAt?: any;
  updatedAt?: any;
}
