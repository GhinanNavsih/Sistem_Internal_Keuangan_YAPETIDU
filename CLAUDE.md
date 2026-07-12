# Internal-BAK — Project Knowledge

## Stack

- **Framework**: Next.js 16.2.5 (App Router, Turbopack)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4
- **Database**: Firebase Firestore & Storage (client SDK v12.12.1 + `firebase-admin` v13.8.0)
- **Auth**: Firebase Authentication (email/password)
- **OCR/AI Scanning**: Gemini API + Python OCR (`scripts/parse_rekap.py` with `easyocr`) + `tesseract.js` + `pdfjs-dist`
- **PDF Generation**: jsPDF 4 + jspdf-autotable 5
- **Excel Utilities**: XLSX (SheetJS) for spreadsheet imports/seeds

---

## Project Structure

```text
src/
├── app/                        # Next.js App Router (Pages & API Routes)
│   ├── api/                    # API Endpoints (AI Scan, etc.)
│   ├── dashboard/              # Halaman Dashboard Admin & Payroll
│   │   ├── payroll/
│   │   │   └── uraian/         # Modul Uraian & Kalkulator Presensi
│   │   └── page.tsx            # Admin dashboard landing
│   ├── employee/               # Portal Khusus Pegawai (Slip Gaji & Kegiatan)
│   ├── globals.css             # Tailwind v4 globals
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Landing redirection
├── components/                 # Shared React Components
│   ├── Sidebar.tsx             # Slide-in main dashboard navigation
│   ├── ProtectedRoute.tsx      # Auth routing protection
│   └── PaySlipDialog.tsx       # Modal displays individual pay slips
├── lib/                        # Firebase & Context Providers
│   ├── firebase.ts             # Firebase config (handles primary and secondary App)
│   ├── AuthContext.tsx         # User Auth session context
│   └── DashboardDataContext.tsx# Dashboard states
├── types/                      # TypeScript definitions (index.ts)
└── utils/                      # Helper & Logika Kalkulasi
    ├── ocrParser.ts            # Frontend-facing file rendering & OCR wrappers
    ├── payrollLogic.ts         # Core salary calculations and name overrides
    ├── rekapConfig.ts          # Configurations for Uraian column mapping
    └── generatePaySlipPdf.ts   # jsPDF engine for rendering slip documents
scripts/                        # Seeding, parsing, and migration files
```

---

## Authentication & RBAC

Access control is gated on Firebase Auth user roles. 

### Roles:
- `super_admin`: Full management rights over databases, scripts, settings, and approvals.
- `satker_head`: Department head for blue collar (Pekarya) operations.
- `satker_head_loyalis`: Department head for loyalis operations.
- `employee`: Regular employee view for payslips and activities.

---

## Database Collections (Firestore)

Primary database handles configuration, employee master lists, and transactions:

### Key Collections:
- `Employees_WhiteCollar` / `Employees_BlueCollar` / `Employees_Loyalis`: Collection of profiles per employee type.
- `SalaryMatrix`: Contains `_config` pointing to `activeVersion`, and nested rows mappings under specific versions (e.g., `rows/year_{tahun}` containing `salaries[grade_level]`).
- `VakasiTambahan`: Dynamic allocations for Loyalis events, filtered by `period` (`YYYY-MM`) and approved status.
- `Koperasi Unipdu` (Secondary Firebase App): Handled via `secondaryApp` / `secondaryDb` to pull simpan-pinjam and koperasi balances.

---

## Payroll Calculation Logic

Located in [payrollLogic.ts](file:///Users/ghinannavsih/Documents/Internal-BAK/src/utils/payrollLogic.ts).

1. **Gaji Pokok (Base Salary)**:
   - Extracted using `calculateGapok()`.
   - Years of service is determined using `joinDate` or `dateRecognized`, adjusting forward to the 5th of the month of the target payslip period.
   - Maps adjusted years to active version of `SalaryMatrix_WhiteCollar` with lower-bound clamping.
2. **Tunjangan Keluarga (Family Allowance)**:
   - Spouse: 5% of Gaji Pokok.
   - Children: SD (5%), SLTP (7.5%), SLTA (10%), PT (12.5%).
3. **Tunjangan Fungsional**:
   - Matches a 6-character standardized prefix of `educationLevel` in the active `SalaryMatrix_Functional` collection.
4. **Tunjangan Struktural**:
   - Multi-position tier system: highest structural position paid at 100%, subsequent structural positions stacked at 50% each.
5. **Tunjangan Hari Tua (Pension)**:
   - Flat 10% of Gaji Pokok.
6. **Tunjangan BPJS**:
   - Subsidy retrieved from `bpjs.t_bpjs_tk` and `bpjs.t_bpjs_kes`.
7. **Beras (Rice Allowance)**:
   - Stored under `salaryProfile.tunjanganBeras`.
8. **Presensi Penalty**:
   - Calculated harian base: `Working Days * Expected Hours * Rp 1,650` under Penerimaan (Earnings), shortfalls are deducted under Potongan: `Round(Absence Minutes / 60 * Rp 1,650)`.

---

## Name Matching & Overrides

Since names in raw spreadsheet imports often mismatch with official Firestore user documents:
- **`normalizeName(fullName)`**: Normalizes name structures by removing trailing academic degrees, prepended title tokens (KH, Hj, Ust, Prof, etc.), and lowercase trims.
- **`MANUAL_OVERRIDES`**: Hardcoded exact-match dictionary for edge-cases (e.g. `Siti Rofiah` to `Siti Rofi'ah, A. Md.`).

---

## OCR Processing Pipeline (Uraian)

A two-step processing model parses physical presence printouts:
1. **Geometric Row/Lane Analysis ([parse_rekap.py](file:///Users/ghinannavsih/Documents/Internal-BAK/scripts/parse_rekap.py))**:
   - Translates lines to "Vertical Lanes" mapping header positions.
   - Groups text lines via mathematical baseline clustering (`avg_h * 0.8` tolerance) to retain lines even with weak grid scans.
   - Uses fragment stitching to glue split numbers (e.g., `125.` + `000` -> `125000`).
   - Filters out phantom OCR noise based on narrow text shapes and heavy overlaps.
2. **Frontend UI Sync**:
   - Flows outputs to the `UraianTable` components matching [rekapConfig.ts](file:///Users/ghinannavsih/Documents/Internal-BAK/src/utils/rekapConfig.ts) indices.

---

## Key Scripts & Commands

Manage database seeding and imports via the following commands:
- **Run dev environment**: `npm run dev`
- **Build application**: `npm run build`
- **Import/Seeding scripts**:
  - `npm run migrate:salary-matrix`
  - `npm run migrate:employees`
  - `npm run migrate:employees-master`
  - `npm run migrate:blue-collar`
  - `npm run seed:white-collar-matrix`
  - `npm run update:tunjangan-beras`
