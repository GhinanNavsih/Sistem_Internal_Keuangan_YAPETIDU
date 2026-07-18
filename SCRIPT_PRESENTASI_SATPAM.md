# Script Presentasi: Transformasi Sistem Pelaporan Shift & Payroll Satpam Pekarya

Script ini dirancang untuk dipresentasikan kepada seluruh anggota Satpam Pekarya dan Manajemen Biro Umum/Keuangan guna memperkenalkan keunggulan sistem payroll digital baru yang transparan, instan, dan akurat.

---

## Slide 1: Pembuka & Selamat Tinggal Era Tebak-Tebakan!
* **Judul Slide:** Revolusi Payroll Satpam: Transparansi Penuh di Tangan Anda!
* **Visual Screen:** Mockup halaman Portal Karyawan di handphone, menampilkan grafik akumulasi hari kerja dan nominal rupiah berjalan yang terus bertambah.
* **Script Presenter:**
  > "Selamat pagi/siang rekan-rekan sekalian.
  > 
  > Mari kita mulai dengan sebuah pertanyaan sederhana: Setiap akhir bulan menjelang gajian, apakah Anda sering merasa cemas? Apakah Anda sering harus mencatat manual di buku saku, lalu berdoa dan berharap agar hitungan lembur, cover shift, atau tugas hari libur Anda tidak ada yang terlewat oleh admin keuangan?
  > 
  > Mulai hari ini, kita tinggalkan kecemasan itu. Selamat tinggal era lembaran kertas fisik yang rentan terselip atau hilang! Kami mempersembahkan **Portal Keuangan Digital Satpam YAPETIDU**—sistem baru yang memindahkan kendali penuh atas keringat dan hak Anda langsung ke genggaman Anda sendiri!"

---

## Slide 2: Kerja Hari Ini, Lihat Hasilnya Hari Ini! (Bukan Lagi "Pray and Hope")
* **Judul Slide:** Transparansi Real-Time: Pantau Rupiah Anda Setiap Hari
* **Visual Screen:** Tangkapan layar dashboard menu **Payslip** ([payslip/page.tsx](file:///Users/ghinannavsih/Documents/Internal-BAK/src/app/employee/payslip/page.tsx)) yang menunjukkan pertambahan saldo berjalan secara dinamis.
* **Script Presenter:**
  > "Di sistem lama, Anda baru tahu berapa gaji dan lembur Anda setelah menerima kertas slip fisik di hari gajian—sering kali dengan rasa terkejut karena hitungannya tidak pas. Anda harus 'pray and hope' (berdoa dan berharap) sepanjang bulan.
  > 
  > Di sistem baru, konsep itu kita hapus total! Setiap kali Anda menyelesaikan shift dan laporan aktivitas Anda disetujui, nominal uangnya **langsung muncul secara real-time** di portal Anda. Hari ini Anda bekerja, besok Anda bisa lihat saldo akumulasi bulan ini bertambah secara transparan. Tidak ada tebak-tebakan, tidak ada yang disembunyikan!"

---

## Slide 3: Konversi Shift ke Uang Secara Instan
* **Judul Slide:** Otomatisasi Tarif Shift & Lembur Satpam
* **Visual Screen:** Kartu tarif interaktif:
  * **Shift Harian:** Rp 12.500
  * **Jumat & Hari Libur:** Rp 25.000 *(Auto-double)*
  * **Lembur Mandiri:** Rp 30.000 *(Hari Libur Kelompok)*
  * **Lembur Cover:** Rp 50.000 *(Menggantikan Rekan)*
* **Script Presenter:**
  > "Bagaimana sistem ini mengonversi kinerja Anda menjadi rupiah secara instan? 
  > 
  > Begitu Anda menginput laporan di Portal Karyawan ([activities/page.tsx](file:///Users/ghinannavsih/Documents/Internal-BAK/src/app/employee/activities/page.tsx)), sistem cerdas kita langsung mencocokkan laporan tersebut dengan database jadwal rotasi kelompok ([satpamRotation.ts](file:///Users/ghinannavsih/Documents/Internal-BAK/src/utils/satpamRotation.ts)).
  > 
  > Sistem akan tahu secara otomatis: Apakah Anda sedang bertugas di shift biasa, bertugas di hari libur/Jumat, melakukan lembur mandiri di hari libur kelompok Anda, atau sedang mengcover shift rekan lain yang berhalangan hadir. 
  > 
  > Nilai rupiah untuk masing-masing tipe shift tersebut langsung terkunci ke akun Anda secara otomatis tanpa perlu dihitung manual oleh sekretaris!"

---

## Slide 4: Akumulasi Dinamis Tanpa Batas Akhir Bulan
* **Judul Slide:** Rekapitulasi Berjalan Instan (Instant Accumulation)
* **Visual Screen:** Alur data dari input HP Satpam ➔ Persetujuan Digital ➔ Akumulasi Rekap Bulanan.
* **Script Presenter:**
  > "Kita tidak perlu lagi menunggu sampai akhir bulan untuk menumpuk 90 lembar kertas laporan harian dari pos-pos penjagaan. 
  > 
  > Sistem ini melakukan akumulasi secara dinamis setiap detiknya. Begitu laporan harian disetujui oleh verifikator (Majlis Kamtib / Kepala Biro Umum) di dashboard mereka ([activity-review/page.tsx](file:///Users/ghinannavsih/Documents/Internal-BAK/src/app/dashboard/payroll/activity-review/page.tsx)), data tersebut langsung tersinkronisasi. 
  > 
  > Anda bisa melihat grafik akumulasi shift Anda meningkat. Hari pertama terkumpul 1 shift harian, hari kedua bertambah 1 lembur cover, hari ketiga bertambah shift Jumat—semuanya terjumlah secara instan dan otomatis!"

---

## Slide 5: Bebas Salah Ketik & Bebas Bureaucracy
* **Judul Slide:** Akurasi 100% — Langsung Terintegrasi ke Payroll
* **Visual Screen:** Ilustrasi data yang mengalir langsung ke kalkulator payroll ([payrollLogic.ts](file:///Users/ghinannavsih/Documents/Internal-BAK/src/utils/payrollLogic.ts)), melewati tahapan pengetikan ulang.
* **Script Presenter:**
  > "Salah satu penyebab utama keterlambatan atau salah hitung gaji di masa lalu adalah proses input ulang manual oleh petugas keuangan. Manusia bisa lelah dan salah ketik angka.
  > 
  > Sekarang, birokrasi lambat itu dipotong habis! Karena data dilaporkan secara digital dan disetujui secara digital, bagian Keuangan cukup menekan satu tombol sinkronisasi. 
  > 
  > Angka-angka shift yang sudah terakumulasi di akun Anda langsung mengalir ke sistem master payroll untuk dikalikan dengan gaji pokok dan tunjangan keluarga rekan-rekan. Hasilnya? Gaji terbayarkan dengan akurasi 100% tepat waktu!"

---

## Slide 6: Penutup & Demo Singkat
* **Judul Slide:** Pegang Kendali Rincian Gaji Anda Sekarang!
* **Visual Screen:** Tampilan antarmuka login karyawan beserta petunjuk langkah demi langkah pengisian aktivitas harian.
* **Script Presenter:**
  > "Rekan-rekan sekalian, sistem ini dibuat untuk memberikan keadilan, transparansi, dan kecepatan akses informasi bagi Anda yang bertugas menjaga keamanan instansi kita setiap hari. 
  > 
  > Mulai hari ini, mari kita biasakan mengisi laporan aktivitas secara rutin di handphone masing-masing setiap selesai bertugas. Pantau nominal rupiah Anda tumbuh setiap hari, dan mari kita ganti rasa cemas menunggu gajian dengan kepastian sistem digital yang andal!
  > 
  > Mari kita lakukan demo singkat bagaimana cara mengisi laporan pertamanya. Terima kasih!"
