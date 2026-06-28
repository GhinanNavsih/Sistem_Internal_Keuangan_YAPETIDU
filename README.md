# Sistem Internal Keuangan YAPETIDU (Internal-BAK)

Sistem Internal Keuangan YAPETIDU (Internal-BAK) adalah aplikasi berbasis web modern yang dirancang untuk mengelola penggajian (payroll), presensi, dan kegiatan operasional keuangan internal di lingkungan Yayasan Pendidikan Teknologi dan Industri Darul Ulum (YAPETIDU).

Aplikasi ini dibangun menggunakan **Next.js 16 (App Router)**, **React 19**, **Tailwind CSS v4**, dan **Firebase (Firestore & Storage)**.

---

## ✨ Fitur Utama

### 📊 1. Dashboard & Analitik
- Dashboard interaktif bagi Admin dan Super Admin untuk melihat ringkasan pengeluaran gaji, jumlah pegawai, dan statistik bulanan menggunakan grafik interaktif (**Recharts**).

### 💵 2. Manajemen Uraian & Payroll
Sistem penggajian dibagi menjadi beberapa modul utama:
- **Rekap Uraian Pekarya (Blue Collar)**:
  - Dukungan pemindaian otomatis berbasis AI (**Gemini API**) untuk membaca dokumen rekap presensi (PDF/Gambar) dan menginput data secara otomatis ke dalam tabel.
  - Perhitungan otomatis untuk berbagai komponen (gaji harian, lembur, piket, potongan BPJS, koperasi, dll.).
- **Vakasi Tambahan (Loyalis)**:
  - Pengelolaan pembayaran kegiatan variabel bulanan bagi pegawai Loyalis.
  - Alur kerja persetujuan terintegrasi (SatKer Loyalis mengunggah laporan resmi yang ditandatangani untuk ditinjau oleh Super Admin).
  - *Baru*: Filter unit kerja (department) untuk mempermudah Super Admin memantau daftar kegiatan.
- **Kegiatan SPJ (Pekarya)**:
  - Pencatatan dan kalkulasi kegiatan SPJ bagi pekerja operasional.
- **Kalkulator Presensi**:
  - Penghitung strata dan bonus presensi bagi pegawai Loyalis & Pekarya secara otomatis.

### 📄 3. Ekspor Laporan & PDF
- Pembuatan dokumen slip gaji (payslip) dan laporan rekapitulasi keuangan secara dinamis dalam format PDF menggunakan **jsPDF** dan **jsPDF-autotable**.
- Dukungan ekspor templat kosong untuk kebutuhan darurat.
- Konfigurasi tanda tangan digital dinamis per kategori pekerjaan.

### 🔒 4. Keamanan & Alur Kerja Persetujuan (Approval Workflow)
- **Role-Based Access Control (RBAC)**: Pembatasan hak akses berdasarkan peran pengguna (`super_admin`, `satker_head`, `satker_head_loyalis`, `employee`).
- Alur verifikasi berlapis untuk pengajuan anggaran kegiatan variabel.

---

## 🛠️ Teknologi yang Digunakan

- **Core**: [Next.js 16.2](https://nextjs.org/) (App Router), [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Database & Storage**: [Firebase Firestore](https://firebase.google.com/docs/firestore) & [Firebase Storage](https://firebase.google.com/docs/storage)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) & [Lucide React](https://lucide.dev/) (Icons)
- **AI Scan & OCR**: [Google Generative AI SDK (Gemini)](https://ai.google.dev/), [Tesseract.js](https://github.com/naptha/tesseract.js), [pdfjs-dist](https://github.com/mozilla/pdf.js)
- **PDF Generation**: [jsPDF](https://github.com/parallax/jsPDF) & [jsPDF-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable)
- **Excel Utilities**: [XLSX (SheetJS)](https://sheetjs.com/) for importing and parsing spreadsheets.

---

## 📁 Struktur Direktori Penting

```text
├── src/
│   ├── app/                    # Next.js App Router (Pages & API Routes)
│   │   ├── api/                # API Endpoints (AI Scan, etc.)
│   │   ├── dashboard/          # Halaman Dashboard Admin & Payroll
│   │   │   └── payroll/
│   │   │       └── uraian/     # Modul Uraian & Kalkulator Presensi
│   │   └── employee/           # Portal Khusus Pegawai (Slip Gaji & Kegiatan)
│   ├── components/             # Reusable UI Components
│   ├── lib/                    # Firebase Config, Auth Context, dsb.
│   ├── types/                  # TypeScript Type Definitions
│   └── utils/                  # Helper & Logika Kalkulasi (PDF, OCR, Payroll)
├── scripts/                    # Skrip Migrasi & Seeding Data Excel ke Firestore
└── public/                     # Aset Statis (Logo, Gambar)
```

---

## 🚀 Memulai Pengembangan

### 1. Prasyarat
Pastikan Anda sudah menginstal **Node.js** (versi 18+) dan **npm**.

### 2. Kloning & Instalasi Dependensi
```bash
git clone <repository-url>
cd Internal-BAK
npm install
```

### 3. Konfigurasi Environment Variables
Buat berkas `.env.local` di direktori root dan isi dengan kredensial Firebase dan Gemini API Anda:
```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
GEMINI_API_KEY=your_gemini_api_key
```

### 4. Menjalankan Server Lokal
```bash
npm run dev
```
Buka [http://localhost:3000](http://localhost:3000) pada peramban Anda untuk melihat hasilnya.

---

## ⚙️ Skrip Migrasi & Seeding Data

Projek ini menyediakan berbagai skrip utilitas untuk melakukan migrasi atau *seed* data awal dari file Excel (`.xlsx`) ke Firebase Firestore. Jalankan menggunakan perintah berikut:

- **Migrasi Matriks Gaji**:
  ```bash
  npm run migrate:salary-matrix
  ```
- **Migrasi Data Pegawai**:
  ```bash
  npm run migrate:employees
  ```
- **Migrasi Master Pegawai**:
  ```bash
  npm run migrate:employees-master
  ```
- **Migrasi Data Pekarya (Blue Collar)**:
  ```bash
  npm run migrate:blue-collar
  ```
- **Seed Matriks Gaji White Collar**:
  ```bash
  npm run seed:white-collar-matrix
  ```
- **Update Tunjangan Beras**:
  ```bash
  npm run update:tunjangan-beras
  ```
