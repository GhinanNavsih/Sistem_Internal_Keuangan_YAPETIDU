const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = '/Users/ghinannavsih/Documents/Internal-BAK';
const logoPath = path.join(projectRoot, 'public/Logo UNIPDU.png');
const logoBase64 = fs.existsSync(logoPath)
  ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
  : '';

function renderStyles() {
  return `
    <style>
      @page {
        size: A4;
        margin: 10mm 12mm 10mm 12mm;
      }
      * {
        box-sizing: border-box;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #1e293b;
        background: #ffffff;
        margin: 0;
        padding: 0;
        font-size: 8.8pt;
        line-height: 1.38;
      }

      /* Header Kop Surat */
      .kop-wrapper {
        display: flex;
        align-items: center;
        gap: 12px;
        border-bottom: 2.5px double #1e293b;
        padding-bottom: 6px;
        margin-bottom: 8px;
      }
      .kop-logo {
        width: 60px;
        height: auto;
        object-fit: contain;
      }
      .kop-text {
        flex: 1;
        text-align: center;
      }
      .kop-univ {
        font-size: 9.5pt;
        font-weight: 700;
        text-transform: uppercase;
        color: #0f172a;
        margin: 0;
      }
      .kop-fakultas {
        font-size: 11.5pt;
        font-weight: 800;
        text-transform: uppercase;
        color: #1e3a8a;
        margin: 1px 0;
      }
      .kop-sub {
        font-size: 8.5pt;
        font-weight: 600;
        color: #334155;
        margin: 0;
      }
      .kop-address {
        font-size: 7.2pt;
        color: #64748b;
        margin-top: 2px;
        font-style: italic;
      }

      /* Running Header on subsequent pages */
      .running-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #cbd5e1;
        padding-bottom: 4px;
        margin-bottom: 8px;
        font-size: 7.8pt;
        color: #64748b;
      }
      .running-header strong {
        color: #1e3a8a;
        font-weight: 700;
      }

      /* Title */
      .title-box {
        text-align: center;
        margin-bottom: 8px;
      }
      .test-title {
        font-size: 11.5pt;
        font-weight: 800;
        text-transform: uppercase;
        color: #0f172a;
        margin: 0;
        letter-spacing: 0.3px;
      }
      .test-subtitle {
        font-size: 8.5pt;
        font-weight: 600;
        color: #2563eb;
        margin: 2px 0 0 0;
      }

      /* Candidate Metadata Table */
      .meta-box {
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        border-radius: 5px;
        padding: 6px 10px;
        margin-bottom: 8px;
        display: grid;
        grid-template-columns: 2.2fr 1fr;
        gap: 10px;
        font-size: 8.2pt;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: 110px auto;
        row-gap: 3px;
      }
      .meta-label {
        font-weight: 600;
        color: #475569;
      }
      .meta-dots {
        border-bottom: 1px dotted #94a3b8;
        min-height: 12px;
      }
      .score-box {
        border: 1.5px dashed #94a3b8;
        border-radius: 5px;
        background: #ffffff;
        padding: 4px 8px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
      }
      .score-title {
        font-size: 7.5pt;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
      }
      .score-value {
        font-size: 14pt;
        font-weight: 800;
        color: #0f172a;
        margin: 1px 0;
      }
      .score-sub {
        font-size: 7pt;
        color: #94a3b8;
      }

      /* Instructions Box */
      .instructions-card {
        background: #eff6ff;
        border-left: 3.5px solid #2563eb;
        padding: 5px 9px;
        border-radius: 0 5px 5px 0;
        margin-bottom: 8px;
        font-size: 7.8pt;
        color: #1e3a8a;
      }
      .instructions-list {
        margin: 2px 0 0 14px;
        padding: 0;
      }
      .instructions-list li {
        margin-bottom: 1.5px;
      }

      /* Section Header */
      .section-header {
        background: #0f172a;
        color: #ffffff;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 8.5pt;
        font-weight: 700;
        margin: 8px 0 6px 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        page-break-after: avoid;
        break-after: avoid;
      }
      .section-tag {
        font-size: 7.2pt;
        font-weight: 600;
        background: #334155;
        padding: 1.5px 6px;
        border-radius: 3px;
      }

      /* Question Card */
      .question-card {
        border: 1px solid #e2e8f0;
        border-radius: 5px;
        padding: 7px 9px;
        margin-bottom: 7px;
        background: #ffffff;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .q-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 3px;
      }
      .q-num {
        font-weight: 700;
        font-size: 8.8pt;
        color: #0f172a;
      }
      .q-badge {
        font-size: 7pt;
        font-weight: 700;
        padding: 1.5px 6px;
        border-radius: 10px;
        text-transform: uppercase;
      }
      .badge-level-1 { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
      .badge-level-2 { background: #dbeafe; color: #1d4ed8; border: 1px solid #93c5fd; }
      .badge-level-3 { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
      .badge-level-4 { background: #f3e8ff; color: #7e22ce; border: 1px solid #d8b4fe; }

      .q-text {
        font-size: 8.4pt;
        color: #334155;
        margin: 3px 0 5px 0;
      }

      /* Tables */
      .answer-grid {
        width: 100%;
        border-collapse: collapse;
        margin-top: 4px;
        font-size: 7.8pt;
      }
      .answer-grid th, .answer-grid td {
        border: 1px solid #cbd5e1;
        padding: 3.5px 6px;
        text-align: left;
      }
      .answer-grid th {
        background: #f1f5f9;
        font-weight: 600;
        color: #475569;
      }
      .journal-table {
        width: 100%;
        border-collapse: collapse;
        margin: 4px 0;
        font-size: 7.8pt;
      }
      .journal-table th, .journal-table td {
        border: 1px solid #94a3b8;
        padding: 3px 6px;
      }
      .journal-table th {
        background: #e2e8f0;
        font-weight: 700;
        color: #1e293b;
        text-align: center;
      }
      .blank-row {
        height: 20px;
      }

      .write-box {
        border: 1px dashed #cbd5e1;
        border-radius: 4px;
        background: #fafafa;
        min-height: 26px;
        padding: 4px 6px;
        margin-top: 4px;
        font-size: 7.8pt;
        color: #94a3b8;
        font-style: italic;
      }

      /* Page Break Helpers */
      .page-break {
        page-break-before: always;
        break-before: always;
      }

      /* Guide & Rubric Styles */
      .guide-header {
        background: #1e3a8a;
        color: white;
        padding: 8px 12px;
        border-radius: 5px;
        margin-bottom: 8px;
      }
      .guide-title {
        font-size: 11.5pt;
        font-weight: 800;
        text-transform: uppercase;
        margin: 0;
      }
      .guide-sub {
        font-size: 8pt;
        color: #93c5fd;
        margin: 1px 0 0 0;
      }

      .rubric-table {
        width: 100%;
        border-collapse: collapse;
        margin: 6px 0 10px 0;
        font-size: 7.8pt;
      }
      .rubric-table th, .rubric-table td {
        border: 1px solid #cbd5e1;
        padding: 4.5px 6px;
        vertical-align: top;
      }
      .rubric-table th {
        background: #f1f5f9;
        font-weight: 700;
        color: #0f172a;
        text-align: left;
      }

      .solution-card {
        border: 1px solid #cbd5e1;
        border-left: 3.5px solid #10b981;
        background: #f8fafc;
        border-radius: 0 5px 5px 0;
        padding: 6px 9px;
        margin-bottom: 7px;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .solution-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2px;
      }
      .solution-title {
        font-weight: 700;
        font-size: 8.5pt;
        color: #0f172a;
      }
      .solution-points {
        font-weight: 700;
        font-size: 7pt;
        background: #d1fae5;
        color: #065f46;
        padding: 1.5px 5px;
        border-radius: 3px;
      }
      .journal-code {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        padding: 4px 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 7.8pt;
        margin: 3px 0;
        color: #0f172a;
        line-height: 1.4;
      }
      .journal-line-d {
        color: #0284c7;
        font-weight: 600;
      }
      .journal-line-c {
        color: #059669;
        font-weight: 600;
        padding-left: 14px;
      }
      .solution-notes {
        font-size: 7.8pt;
        color: #475569;
        margin-top: 3px;
        line-height: 1.35;
      }

      .footer-note {
        font-size: 7.2pt;
        color: #94a3b8;
        text-align: center;
        margin-top: 6px;
        border-top: 1px solid #e2e8f0;
        padding-top: 4px;
      }
    </style>
  `;
}

function renderKop() {
  return `
    <div class="kop-wrapper">
      ${logoBase64 ? `<img src="${logoBase64}" alt="Logo UNIPDU" class="kop-logo" />` : ''}
      <div class="kop-text">
        <div class="kop-univ">Yayasan Pondok Pesantren Tinggi Darul 'Ulum</div>
        <div class="kop-fakultas">Universitas Pesantren Tinggi Darul Ulum (UNIPDU) Jombang</div>
        <div class="kop-sub">BADAN ADMINISTRASI KEUANGAN (BAK) — UNIT SISTEM SATKER FINANCE</div>
        <div class="kop-address">Kompleks PP. Darul 'Ulum Peterongan, Jombang 61481 · Telp: (0321) 873655 · Website: www.unipdu.ac.id</div>
      </div>
    </div>
    <div class="title-box">
      <div class="test-title">PRE-TEST KOMPETENSI AKUNTANSI & PENJURNALAN SATKER</div>
      <div class="test-subtitle">Evaluasi & Pemetaan Kemampuan Calon Pemagang (Intern) Pendamping Satker</div>
    </div>
  `;
}

function renderRunningHeader(pageNumber, title) {
  return `
    <div class="running-header">
      <div><strong>UNIPDU / BAK</strong> — ${title}</div>
      <div>Halaman ${pageNumber} dari 4 · Nama Peserta: ..............................................................</div>
    </div>
  `;
}

function renderMetaBox() {
  return `
    <div class="meta-box">
      <div class="meta-grid">
        <div class="meta-label">Nama Peserta</div>
        <div class="meta-dots">: ........................................................................................</div>
        <div class="meta-label">Asal Kampus / Prodi</div>
        <div class="meta-dots">: ........................................................................................</div>
        <div class="meta-label">Satker Penempatan</div>
        <div class="meta-dots">: ........................................................................................</div>
        <div class="meta-label">Tanggal Pelaksanaan</div>
        <div class="meta-dots">: ........................................................................................</div>
        <div class="meta-label">Nama Mentor / Satker</div>
        <div class="meta-dots">: ........................................................................................</div>
      </div>
      <div class="score-box">
        <div class="score-title">Nilai Akhir</div>
        <div class="score-value">___ / 100</div>
        <div class="score-sub">Paraf Penguji: .................</div>
      </div>
    </div>
  `;
}

function renderInstructions() {
  return `
    <div class="instructions-card">
      <strong>PETUNJUK PENGERJAAN:</strong>
      <ol class="instructions-list">
        <li>Waktu pengerjaan: <strong>45 s.d. 60 menit</strong>. Kerjakan secara mandiri dan cermat.</li>
        <li>Terdapat <strong>10 soal kasus</strong> berjenjang (Level 1: Dasar s/d Level 4: Mahir/Sistem BAK).</li>
        <li>Tuliskan ayat jurnal berpasangan (<em>double-entry</em>) lengkap: <strong>Kode/Nama Akun, Posisi Debet/Kredit, dan Nilai Rupiah</strong>.</li>
        <li>Perhatikan prinsip keseimbangan (<em>balancing</em>), akun pengurang (<em>contra</em>), klasifikasi arus kas, dan kontrol periode terkunci.</li>
      </ol>
    </div>
  `;
}

// HALAMAN 1: KOP + META + PETUNJUK + BAGIAN I (SOAL 1 & SOAL 2)
function renderPage1() {
  return `
    <div>
      ${renderKop()}
      ${renderMetaBox()}
      ${renderInstructions()}

      <div class="section-header">
        <span>BAGIAN I: FONDAKSI AKUNTANSI & SALDO NORMAL</span>
        <span class="section-tag">Tingkat: Dasar (Total 10 Poin)</span>
      </div>

      <!-- SOAL 1 -->
      <div class="question-card">
        <div class="q-head">
          <span class="q-num">Soal 1. Klasifikasi Akun & Saldo Normal</span>
          <span class="q-badge badge-level-1">Level 1 · Bobot 5 Poin</span>
        </div>
        <div class="q-text">
          Tentukan Saldo Normal penambahan (<strong>Debet</strong> atau <strong>Kredit</strong>) pada akun-akun standar Satker berikut, dan jawab pertanyaan singkat di bawah tabel:
        </div>
        <table class="answer-grid">
          <thead>
            <tr>
              <th style="width: 15%;">Kode Akun</th>
              <th style="width: 35%;">Nama Akun</th>
              <th style="width: 25%;">Kelompok Akun</th>
              <th style="width: 25%;">Saldo Normal (Debet/Kredit)</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>10000</td><td>KAS / 11001 - Bank Mandiri</td><td>AKTIVA</td><td>................................................</td></tr>
            <tr><td>13014</td><td>Akumulasi Penyusutan Alat Lab</td><td>AKTIVA (KONTRA)</td><td>................................................</td></tr>
            <tr><td>20001</td><td>Hutang Lain-Lain</td><td>HUTANG</td><td>................................................</td></tr>
            <tr><td>41000</td><td>Droping Universitas</td><td>TERIMA (PENDAPATAN)</td><td>................................................</td></tr>
            <tr><td>51101</td><td>Vakasi Tutor Pelatihan</td><td>KELUAR (BIAYA)</td><td>................................................</td></tr>
          </tbody>
        </table>
        <div style="font-size: 7.8pt; color: #475569; margin-top: 4px;">
          <em>Mengapa Akumulasi Penyusutan (13014) memiliki saldo normal yang berkebalikan dari akun kelompok Aktiva lainnya?</em>
          <div class="write-box" style="min-height: 22px;"></div>
        </div>
      </div>

      <!-- SOAL 2 -->
      <div class="question-card">
        <div class="q-head">
          <span class="q-num">Soal 2. Validitas Voucher Jurnal & Akun Postable</span>
          <span class="q-badge badge-level-1">Level 1 · Bobot 5 Poin</span>
        </div>
        <div class="q-text">
          Pada sistem pembukuan Satker Finance:
          <ol style="margin: 2px 0 0 14px; padding: 0;">
            <li>Mengapa sebuah draf jurnal ditolak oleh sistem jika total Debet tidak sama dengan total Kredit, atau jika satu baris diisi Debet sekaligus Kredit?</li>
            <li>Mengapa bendahara satker <strong>dilarang</strong> menjurnal langsung ke akun kepala <code>50000 - PENGELUARAN</code> dan diwajibkan memilih sub-akun seperti <code>51101</code>?</li>
          </ol>
        </div>
        <div class="write-box" style="min-height: 38px;"></div>
      </div>

      <div class="footer-note">Halaman 1 dari 4 — Pre-Test Akuntansi Satker UNIPDU</div>
    </div>
  `;
}

// HALAMAN 2: BAGIAN II: TRANSAKSI OPERASIONAL RUTIN (SOAL 3, 4, 5)
function renderPage2() {
  return `
    <div class="page-break">
      ${renderRunningHeader(2, 'Bagian II: Transaksi Operasional Rutin Satker')}

      <div class="section-header">
        <span>BAGIAN II: TRANSAKSI OPERASIONAL RUTIN SATKER</span>
        <span class="section-tag">Tingkat: Menengah-Bawah (Total 30 Poin)</span>
      </div>

      <!-- SOAL 3 -->
      <div class="question-card">
        <div class="q-head">
          <span class="q-num">Soal 3. Penerimaan Dana Droping dari Universitas</span>
          <span class="q-badge badge-level-2">Level 2 · Bobot 10 Poin</span>
        </div>
        <div class="q-text">
          Pada tanggal 05 September, Satker menerima transfer dana droping operasional semester ganjil dari rekening Rektorat/BAK ke rekening <strong>Bank Mandiri Satker</strong> sebesar <strong>Rp 20.000.000</strong>.
          <br><strong>Instruksi:</strong> Tuliskan ayat jurnalnya pada tabel di bawah, serta tentukan dampaknya terhadap Laporan Arus Kas (Aktivitas Operasi, Investasi, atau Pendanaan).
        </div>
        <table class="journal-table">
          <thead>
            <tr><th style="width: 15%;">Kode Akun</th><th style="width: 45%;">Nama Akun / Uraian</th><th style="width: 20%;">Debet (Rp)</th><th style="width: 20%;">Kredit (Rp)</th></tr>
          </thead>
          <tbody>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
        <div style="font-size: 7.8pt; color: #475569; margin-top: 3px;">
          Klasifikasi Arus Kas: <strong>................................................</strong> — Alasan: <span style="border-bottom: 1px dotted #94a3b8; display: inline-block; width: 60%;"></span>
        </div>
      </div>

      <!-- SOAL 4 -->
      <div class="question-card">
        <div class="q-head">
          <span class="q-num">Soal 4. Pembayaran Beban Honorarium / Vakasi Tutor</span>
          <span class="q-badge badge-level-2">Level 2 · Bobot 10 Poin</span>
        </div>
        <div class="q-text">
          Satker menyelenggarakan kegiatan workshop dan membayar honorarium tutor sebesar <strong>Rp 1.500.000</strong> secara tunai melalui <strong>Kas Kecil Satker</strong> (Kode: 10000).
          <br><strong>Instruksi:</strong> Buat ayat jurnalnya dan sebutkan minimal 2 dokumen fisik pendukung yang wajib difoto/diunggah (receipt) ke aplikasi sebelum posting.
        </div>
        <table class="journal-table">
          <thead>
            <tr><th style="width: 15%;">Kode Akun</th><th style="width: 45%;">Nama Akun / Uraian</th><th style="width: 20%;">Debet (Rp)</th><th style="width: 20%;">Kredit (Rp)</th></tr>
          </thead>
          <tbody>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
        <div style="font-size: 7.8pt; color: #475569; margin-top: 3px;">
          Dokumen bukti fisik pendukung wajib:
          <div class="write-box" style="min-height: 22px;"></div>
        </div>
      </div>

      <!-- SOAL 5 -->
      <div class="question-card">
        <div class="q-head">
          <span class="q-num">Soal 5. Belanja Barang Habis Pakai (ATK & Konsumsi)</span>
          <span class="q-badge badge-level-2">Level 2 · Bobot 10 Poin</span>
        </div>
        <div class="q-text">
          Satker membeli perlengkapan ATK printer dan konsumsi rapat dinas senilai <strong>Rp 450.000</strong> menggunakan saldo Bank Mandiri Satker.
          <br><strong>Instruksi:</strong> Buat ayat jurnalnya. Mengapa pengeluaran ini langsung dibebankan ke pos Beban dan bukan dicatat sebagai Aktiva Tetap?
        </div>
        <table class="journal-table">
          <thead>
            <tr><th style="width: 15%;">Kode Akun</th><th style="width: 45%;">Nama Akun / Uraian</th><th style="width: 20%;">Debet (Rp)</th><th style="width: 20%;">Kredit (Rp)</th></tr>
          </thead>
          <tbody>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
        <div class="write-box" style="min-height: 22px;">Alasan perlakuan beban operasional langsung:</div>
      </div>

      <div class="footer-note">Halaman 2 dari 4 — Pre-Test Akuntansi Satker UNIPDU</div>
    </div>
  `;
}

// HALAMAN 3: BAGIAN III: ASET TETAP, UTANG, & ARUS KAS (SOAL 6, 7, 8)
function renderPage3() {
  return `
    <div class="page-break">
      ${renderRunningHeader(3, 'Bagian III: Aset Tetap, Utang, & Arus Kas')}

      <div class="section-header">
        <span>BAGIAN III: ASET TETAP, UTANG, & ARUS KAS</span>
        <span class="section-tag">Tingkat: Menengah-Atas (Total 30 Poin)</span>
      </div>

      <!-- SOAL 6 -->
      <div class="question-card">
        <div class="q-head">
          <span class="q-num">Soal 6. Pengadaan Aset Tetap & Klasifikasi Arus Kas</span>
          <span class="q-badge badge-level-3">Level 3 · Bobot 10 Poin</span>
        </div>
        <div class="q-text">
          Satker membeli 1 unit PC Server / Alat Laboratorium seharga <strong>Rp 8.000.000</strong> melalui transfer <strong>Bank Mandiri</strong>.
          <br><strong>Instruksi:</strong> Buat ayat jurnalnya. Sistem Satker Finance secara otomatis menetapkan bagian arus kas dari akun lawannya; jelaskan mengapa transaksi ini tergolong <strong>Arus Kas Investasi</strong> (kaitkan dengan kode akun <code>13xxx</code>)!
        </div>
        <table class="journal-table">
          <thead>
            <tr><th style="width: 15%;">Kode Akun</th><th style="width: 45%;">Nama Akun / Uraian</th><th style="width: 20%;">Debet (Rp)</th><th style="width: 20%;">Kredit (Rp)</th></tr>
          </thead>
          <tbody>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
        <div class="write-box" style="min-height: 22px;">Penjelasan Arus Kas Investasi:</div>
      </div>

      <!-- SOAL 7 -->
      <div class="question-card">
        <div class="q-head">
          <span class="q-num">Soal 7. Transaksi Majemuk: Pembayaran Uang Muka & Hutang</span>
          <span class="q-badge badge-level-3">Level 3 · Bobot 10 Poin</span>
        </div>
        <div class="q-text">
          Satker memesan pengadaan perlengkapan sarana satker senilai <strong>Rp 5.000.000</strong>. Pada tanggal 10 Oktober, Satker membayar DP <strong>Rp 2.000.000</strong> via Bank Mandiri, dan sisanya dicatat sebagai hutang yang akan dilunasi bulan berikutnya.
          <br><strong>Instruksi:</strong> Catat jurnal majemuk saat pengadaan (10 Oktober) dan jurnal saat pelunasan sisa tagihan pada bulan berikutnya.
        </div>
        <div style="font-size: 7.8pt; font-weight: 700; color: #1e293b; margin-top: 3px;">A. Jurnal Tanggal 10 Oktober (Pengadaan & Pengakuan Hutang):</div>
        <table class="journal-table">
          <thead>
            <tr><th style="width: 15%;">Kode Akun</th><th style="width: 45%;">Nama Akun / Uraian</th><th style="width: 20%;">Debet (Rp)</th><th style="width: 20%;">Kredit (Rp)</th></tr>
          </thead>
          <tbody>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
        <div style="font-size: 7.8pt; font-weight: 700; color: #1e293b; margin-top: 3px;">B. Jurnal Saat Pelunasan Sisa Tagihan (Bulan Berikutnya):</div>
        <table class="journal-table">
          <thead>
            <tr><th style="width: 15%;">Kode Akun</th><th style="width: 45%;">Nama Akun / Uraian</th><th style="width: 20%;">Debet (Rp)</th><th style="width: 20%;">Kredit (Rp)</th></tr>
          </thead>
          <tbody>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
      </div>

      <!-- SOAL 8 -->
      <div class="question-card">
        <div class="q-head">
          <span class="q-num">Soal 8. Jurnal Penyesuaian Penyusutan Bulanan (Non-Cash)</span>
          <span class="q-badge badge-level-3">Level 3 · Bobot 10 Poin</span>
        </div>
        <div class="q-text">
          Pada akhir bulan September, daftar aset tetap satker menghasilkan beban penyusutan kendaraan operasional sebesar <strong>Rp 250.000</strong>.
          <br><strong>Instruksi:</strong> Buat ayat jurnal penyesuaiannya. Mengapa jurnal ini sama sekali <strong>tidak mengurangi saldo kas</strong> pada Laporan Arus Kas?
        </div>
        <table class="journal-table">
          <thead>
            <tr><th style="width: 15%;">Kode Akun</th><th style="width: 45%;">Nama Akun / Uraian</th><th style="width: 20%;">Debet (Rp)</th><th style="width: 20%;">Kredit (Rp)</th></tr>
          </thead>
          <tbody>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
        <div class="write-box" style="min-height: 22px;">Penjelasan pengaruh kas:</div>
      </div>

      <div class="footer-note">Halaman 3 dari 4 — Pre-Test Akuntansi Satker UNIPDU</div>
    </div>
  `;
}

// HALAMAN 4: BAGIAN IV: PENGENDALIAN, REKONSILIASI, & KOREKSI SISTEM (SOAL 9 & 10)
function renderPage4() {
  return `
    <div class="page-break">
      ${renderRunningHeader(4, 'Bagian IV: Pengendalian, Rekonsiliasi, & Koreksi Sistem')}

      <div class="section-header">
        <span>BAGIAN IV: PENGENDALIAN, REKONSILIASI, & KOREKSI SISTEM</span>
        <span class="section-tag">Tingkat: Mahir (Total 30 Poin)</span>
      </div>

      <!-- SOAL 9 -->
      <div class="question-card">
        <div class="q-head">
          <span class="q-num">Soal 9. Rekonsiliasi Bank & Selisih Saldo</span>
          <span class="q-badge badge-level-4">Level 4 · Bobot 15 Poin</span>
        </div>
        <div class="q-text">
          Pada penutupan buku akhir bulan, buku kas <code>11001 - Bank Mandiri</code> menunjukkan saldo <strong>Rp 35.400.000</strong>. Namun rekening koran dari bank mencatat saldo akhir <strong>Rp 35.485.000</strong>.
          <br>Ditemukan dua pos bank yang belum dibukukan satker:
          <br>• Pendapatan bunga / jasa giro bank: <strong>+ Rp 100.000</strong> &nbsp;|&nbsp; • Biaya administrasi bank bulanan: <strong>- Rp 15.000</strong>
          <br><strong>Instruksi:</strong> Tunjukkan perhitungan rekonsiliasi saldo akhir, lalu buatkan jurnal penyesuaian yang harus diinput ke sistem Satker!
        </div>
        <div class="write-box" style="min-height: 22px; margin-bottom: 4px;">Perhitungan rekonsiliasi saldo:</div>
        <table class="journal-table">
          <thead>
            <tr><th style="width: 15%;">Kode Akun</th><th style="width: 45%;">Nama Akun / Uraian Penyesuaian Rekonsiliasi</th><th style="width: 20%;">Debet (Rp)</th><th style="width: 20%;">Kredit (Rp)</th></tr>
          </thead>
          <tbody>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
      </div>

      <!-- SOAL 10 -->
      <div class="question-card">
        <div class="q-head">
          <span class="q-num">Soal 10. Studi Kasus: Periode Terkunci & Jurnal Pembalik (Reversal)</span>
          <span class="q-badge badge-level-4">Level 4 · Bobot 15 Poin</span>
        </div>
        <div class="q-text">
          Pada tanggal 15 November, intern menemukan kesalahan pencatatan transaksi tanggal 12 Oktober: Pembelian meja rapat (Sarana & Perlengkapan) senilai <strong>Rp 1.200.000</strong> keliru dicatat sebagai <code>51101 - Vakasi Tutor Pelatihan</code>.
          <br>Saat tombol edit ditekan, sistem menolak dengan pesan: <em>"Jurnal ini terkunci: laporan bulan ini atau bulan sesudahnya sudah dikirim ke BAK (Status: BAK_APPROVED)."</em>
          <br><strong>Instruksi Analisis & Solusi:</strong>
          <ol style="margin: 2px 0 0 14px; padding: 0;">
            <li>Mengapa sistem melarang keras pengeditan atau penghapusan langsung transaksi di bulan yang sudah disetujui BAK?</li>
            <li>Bagaimana prosedur perbaikan yang sah di sistem? Buatkan ayat jurnal koreksi yang diinput pada bulan berjalan (November)!</li>
          </ol>
        </div>
        <div class="write-box" style="min-height: 30px; margin-bottom: 4px;">Alasan integritas audit / sistem mengunci periode:</div>
        <table class="journal-table">
          <thead>
            <tr><th style="width: 15%;">Kode Akun</th><th style="width: 45%;">Nama Akun / Uraian Jurnal Koreksi (Bulan November)</th><th style="width: 20%;">Debet (Rp)</th><th style="width: 20%;">Kredit (Rp)</th></tr>
          </thead>
          <tbody>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
            <tr class="blank-row"><td></td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
      </div>

      <div class="footer-note">Halaman 4 dari 4 — Selesai Pengerjaan Lembar Soal Pre-Test Akuntansi Satker</div>
    </div>
  `;
}

// HALAMAN 5: PANDUAN SUPERVISOR + MATRIKS EVALUASI + KUNCI JAWABAN BAGIAN I & II (SOAL 1 - 5)
function renderPage5() {
  return `
    <div class="page-break">
      <div class="guide-header">
        <div class="guide-title">PANDUAN SUPERVISOR, KUNCI JAWABAN & MATRIKS PENILAIAN</div>
        <div class="guide-sub">Dokumen Pegangan Khusus Kepala Satker & Tim Verifikasi Keuangan BAK UNIPDU</div>
      </div>

      <div style="font-size: 9.5pt; font-weight: 700; color: #0f172a; margin-bottom: 3px;">
        1. Matriks Evaluasi & Pemetaan Kompetensi Calon Pemagang
      </div>

      <table class="rubric-table">
        <thead>
          <tr>
            <th style="width: 13%;">Skor</th>
            <th style="width: 20%;">Level Kompetensi</th>
            <th style="width: 37%;">Karakteristik Penguasaan</th>
            <th style="width: 30%;">Rekomendasi Wewenang Input Satker</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-weight: 700; color: #dc2626;">0 – 49</td>
            <td><strong>Level 1: Novice</strong><br><span style="font-size: 7pt; color: #64748b;">(Perlu Bimbingan)</span></td>
            <td>Paham istilah akuntansi namun sering keliru meletakkan posisi Debet/Kredit pada akun nominal/riil; belum memahami konsep akun kontra dan kontrol sistem.</td>
            <td><strong>Bimbingan penuh.</strong> Diberikan tugas verifikasi fisik nota/kwitansi. Belum diizinkan input jurnal tanpa didampingi langsung.</td>
          </tr>
          <tr>
            <td style="font-weight: 700; color: #d97706;">50 – 74</td>
            <td><strong>Level 2: Intermediate</strong><br><span style="font-size: 7pt; color: #64748b;">(Siap Input Rutin)</span></td>
            <td>Menguasai transaksi harian kas/bank (droping, belanja habis pakai, honor/vakasi). Memahami syarat bukti fisik dan akun postable.</td>
            <td><strong>Diberikan akses input jurnal harian.</strong> Kepala Satker mereviu dan memvalidasi sebelum submit laporan bulanan ke BAK.</td>
          </tr>
          <tr>
            <td style="font-weight: 700; color: #2563eb;">75 – 89</td>
            <td><strong>Level 3: Advanced</strong><br><span style="font-size: 7pt; color: #64748b;">(Mandiri & Analitis)</span></td>
            <td>Menguasai transaksi majemuk, kapitalisasi aset tetap, logika klasifikasi arus kas (Operasi vs Investasi), dan rekonsiliasi kas/bank.</td>
            <td><strong>Asisten utama bendahara satker.</strong> Mandiri menyusun draf laporan bulanan dan menyiapkan bahan rekonsiliasi bank.</td>
          </tr>
          <tr>
            <td style="font-weight: 700; color: #16a34a;">90 – 100</td>
            <td><strong>Level 4: Expert</strong><br><span style="font-size: 7pt; color: #64748b;">(Controller Ready)</span></td>
            <td>Memahami integritas audit trail, mekanisme <em>reversing entry</em> pada bulan terkunci, rekonsiliasi selisih, dan koreksi kesalahan sesuai PSAK/sistem.</td>
            <td><strong>Delegasi penuh operasional pembukuan.</strong> Mampu mengidentifikasi anomali saldo neraca dan membimbing pemagang lainnya.</td>
          </tr>
        </tbody>
      </table>

      <div style="font-size: 9.5pt; font-weight: 700; color: #0f172a; margin: 8px 0 4px 0;">
        2. Kunci Jawaban Lengkap & Pedoman Pensekoran (Soal 1 s.d. 5)
      </div>

      <!-- SOLUSI 1 -->
      <div class="solution-card">
        <div class="solution-head">
          <span class="solution-title">Soal 1 — Klasifikasi & Saldo Normal Akun</span>
          <span class="solution-points">Bobot: 5 Poin</span>
        </div>
        <div class="solution-notes">
          • Kas/Bank: <strong>DEBET</strong> | Akum. Dep: <strong>KREDIT</strong> | Hutang: <strong>KREDIT</strong> | Droping: <strong>KREDIT</strong> | Vakasi: <strong>DEBET</strong> (1 poin per akun benar).<br>
          • <strong>Alasan Akun Kontra:</strong> Akumulasi penyusutan adalah akun kontra-aktiva yang berfungsi mengurangi nilai buku aset tetap secara kumulatif, sehingga saldo normalnya di sisi Kredit.
        </div>
      </div>

      <!-- SOLUSI 2 -->
      <div class="solution-card">
        <div class="solution-head">
          <span class="solution-title">Soal 2 — Validitas Voucher & Akun Postable</span>
          <span class="solution-points">Bobot: 5 Poin</span>
        </div>
        <div class="solution-notes">
          • <strong>Balancing & One-Sided:</strong> Menjaga prinsip <em>double-entry</em> (Total Debet = Total Kredit). Baris harus <em>one-sided</em> agar mutasi buku besar per akun tidak rancu.<br>
          • <strong>Akun Header vs Postable:</strong> Akun kepala <code>50000</code> hanya rekapitulasi kelompok (non-postable). Transaksi wajib ke akun teknis (<code>postable = true</code>) agar belanja teralokasi spesifik.
        </div>
      </div>

      <!-- SOLUSI 3 -->
      <div class="solution-card">
        <div class="solution-head">
          <span class="solution-title">Soal 3 — Penerimaan Dana Droping Universitas</span>
          <span class="solution-points">Bobot: 10 Poin</span>
        </div>
        <div class="journal-code">
          <span class="journal-line-d">(D) 11001 - Bank Mandiri ...................................... Rp 20.000.000</span><br>
          <span class="journal-line-c">(K) 41000 - Droping Universitas ....................................... Rp 20.000.000</span>
        </div>
        <div class="solution-notes">
          • <strong>Arus Kas:</strong> <strong>Aktivitas Operasi (Operating)</strong> karena merupakan penerimaan rutin operasional satker dari universitas.
        </div>
      </div>

      <!-- SOLUSI 4 -->
      <div class="solution-card">
        <div class="solution-head">
          <span class="solution-title">Soal 4 — Beban Vakasi / Honorarium Tutor</span>
          <span class="solution-points">Bobot: 10 Poin</span>
        </div>
        <div class="journal-code">
          <span class="journal-line-d">(D) 51101 - Vakasi Tutor Pelatihan ............................ Rp 1.500.000</span><br>
          <span class="journal-line-c">(K) 10000 - KAS ....................................................... Rp 1.500.000</span>
        </div>
        <div class="solution-notes">
          • <strong>Bukti Pendukung:</strong> Kwitansi/tanda terima bermaterai, daftar hadir/surat tugas tutor, dan bukti bayar (ukuran file max 2MB di sistem).
        </div>
      </div>

      <!-- SOLUSI 5 -->
      <div class="solution-card">
        <div class="solution-head">
          <span class="solution-title">Soal 5 — Belanja Barang Habis Pakai (ATK & Konsumsi)</span>
          <span class="solution-points">Bobot: 10 Poin</span>
        </div>
        <div class="journal-code">
          <span class="journal-line-d">(D) Beban Operasional / Sarpras / ATK ......................... Rp 450.000</span><br>
          <span class="journal-line-c">(K) 11001 - Bank Mandiri .............................................. Rp 450.000</span>
        </div>
        <div class="solution-notes">
          • <strong>Alasan:</strong> Masa manfaat kurang dari 1 tahun dan nilainya di bawah ambang kapitalisasi aset tetap, sehingga langsung dibebankan pada periode berjalan.
        </div>
      </div>

      <div class="footer-note">Halaman 5 dari 6 — Panduan Supervisor Satker Finance UNIPDU</div>
    </div>
  `;
}

// HALAMAN 6: KUNCI JAWABAN BAGIAN III & IV (SOAL 6 - 10) + REKOMENDASI PEMBINAAN
function renderPage6() {
  return `
    <div class="page-break">
      <div class="running-header">
        <div><strong>UNIPDU / BAK</strong> — Kunci Jawaban Bagian III & IV (Soal 6 s.d. 10)</div>
        <div>Halaman 6 dari 6 · Dokumen Pegangan Kepala Satker</div>
      </div>

      <!-- SOLUSI 6 -->
      <div class="solution-card">
        <div class="solution-head">
          <span class="solution-title">Soal 6 — Pengadaan Aset Tetap & Arus Kas Investasi</span>
          <span class="solution-points">Bobot: 10 Poin</span>
        </div>
        <div class="journal-code">
          <span class="journal-line-d">(D) 13004 - Sarana & Perlengkapan (atau 13005) ................ Rp 8.000.000</span><br>
          <span class="journal-line-c">(K) 11001 - Bank Mandiri .............................................. Rp 8.000.000</span>
        </div>
        <div class="solution-notes">
          • <strong>Logika Arus Kas:</strong> Akun kelompok <code>13xxx</code> (Aktiva Tetap) di katalog sistem memiliki klasifikasi <code>cashFlowSection = 'INVESTING'</code>. Oleh karena itu, kas keluar ini otomatis masuk ke <strong>Arus Kas Aktivitas Investasi</strong>.
        </div>
      </div>

      <!-- SOLUSI 7 -->
      <div class="solution-card">
        <div class="solution-head">
          <span class="solution-title">Soal 7 — Transaksi Majemuk & Utang</span>
          <span class="solution-points">Bobot: 10 Poin</span>
        </div>
        <div class="journal-code">
          <strong>A. Tanggal 10 Oktober (Pengadaan & Hutang):</strong><br>
          <span class="journal-line-d">(D) 13004 - Sarana & Perlengkapan ............................. Rp 5.000.000</span><br>
          <span class="journal-line-c">(K) 11001 - Bank Mandiri .............................................. Rp 2.000.000</span><br>
          <span class="journal-line-c">(K) 20001 - Hutang Lain-Lain .......................................... Rp 3.000.000</span><br>
          <strong>B. Bulan Berikutnya (Pelunasan Hutang):</strong><br>
          <span class="journal-line-d">(D) 20001 - Hutang Lain-Lain .................................. Rp 3.000.000</span><br>
          <span class="journal-line-c">(K) 11001 - Bank Mandiri .............................................. Rp 3.000.000</span>
        </div>
        <div class="solution-notes">
          • Menunjukkan penguasaan konsep akrual dan pemisahan pengakuan aset secara utuh dengan arus kas bertahap.
        </div>
      </div>

      <!-- SOLUSI 8 -->
      <div class="solution-card">
        <div class="solution-head">
          <span class="solution-title">Soal 8 — Jurnal Penyesuaian Penyusutan Bulanan</span>
          <span class="solution-points">Bobot: 10 Poin</span>
        </div>
        <div class="journal-code">
          <span class="journal-line-d">(D) Beban Penyusutan Kendaraan ................................ Rp 250.000</span><br>
          <span class="journal-line-c">(K) 13012 - Akum. Dep Kendaraan ....................................... Rp 250.000</span>
        </div>
        <div class="solution-notes">
          • <strong>Pengaruh ke Kas:</strong> Tidak ada perubahan kas karena transaksi non-kas. Saldo kas akhir pada arus kas tetap sinkron dengan neraca.
        </div>
      </div>

      <!-- SOLUSI 9 -->
      <div class="solution-card">
        <div class="solution-head">
          <span class="solution-title">Soal 9 — Rekonsiliasi Bank & Selisih Saldo</span>
          <span class="solution-points">Bobot: 15 Poin</span>
        </div>
        <div class="solution-notes">
          • <strong>Perhitungan:</strong> Saldo Buku Rp 35.400.000 + Jasa Giro Rp 100.000 - Adm Rp 15.000 = <strong>Rp 35.485.000</strong> (Tepat cocok).
        </div>
        <div class="journal-code">
          <span class="journal-line-d">(D) 11001 - Bank Mandiri ...................................... Rp 85.000</span><br>
          <span class="journal-line-d">(D) Beban Administrasi Bank ................................... Rp 15.000</span><br>
          <span class="journal-line-c">(K) 42000 - Pendapatan Jasa Giro / Lain-lain .......................... Rp 100.000</span>
        </div>
      </div>

      <!-- SOLUSI 10 -->
      <div class="solution-card">
        <div class="solution-head">
          <span class="solution-title">Soal 10 — Periode Terkunci & Jurnal Koreksi / Pembalik</span>
          <span class="solution-points">Bobot: 15 Poin</span>
        </div>
        <div class="solution-notes">
          • <strong>1. Alasan Penguncian:</strong> Integritas jejak audit (*audit trail*). Laporan Oktober sudah disahkan BAK. Mengubah data langsung akan merusak konsistensi saldo yang sudah diverifikasi.<br>
          • <strong>2. Prosedur Koreksi:</strong> Dicatat pada <strong>bulan berjalan yang masih terbuka (November)</strong> via Jurnal Koreksi Reklasifikasi:
        </div>
        <div class="journal-code">
          <span class="journal-line-d">(D) 13004 - Sarana & Perlengkapan ............................. Rp 1.200.000</span><br>
          <span class="journal-line-c">(K) 51101 - Vakasi Tutor Pelatihan .................................... Rp 1.200.000</span><br>
          <span style="color: #64748b; font-size: 7.2pt;">Uraian: "Koreksi reklasifikasi salah debet pembelian meja kantor voucher tgl 12/10"</span>
        </div>
      </div>

      <!-- REKOMENDASI UNTUK KEPALA SATKER -->
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 5px; padding: 7px 10px; margin-top: 8px;">
        <div style="font-weight: 700; font-size: 8.5pt; color: #1e40af; margin-bottom: 2px;">
          Rekomendasi Langkah Pembimbingan Kepala Satker Loyalis:
        </div>
        <ol style="margin: 0 0 0 14px; padding: 0; font-size: 7.8pt; color: #1e3a8a; line-height: 1.35;">
          <li>Lakukan pembahasan bersama intern setelah tes selesai, khususnya pada Soal 6 (arus kas otomatis), Soal 9 (rekonsiliasi bank), dan Soal 10 (aturan penguncian periode BAK).</li>
          <li>Sebelum intern diberi akses akun operator di sistem dashboard Satker Finance, pastikan intern paham bahwa tombol <strong>"Posting Jurnal"</strong> hanya aktif jika debet-kredit seimbang dan bukti fisik terunggah.</li>
          <li>Setiap akhir pekan, lakukan reviu bersama atas daftar jurnal draf sebelum diajukan pada verifikasi bulanan BAK.</li>
        </ol>
      </div>

      <div class="footer-note">Halaman 6 dari 6 — Dokumen Penilaian Pre-Test Satker Finance BAK UNIPDU</div>
    </div>
  `;
}

function generateMasterHtml() {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Pre-Test Akuntansi & Penjurnalan Satker — UNIPDU</title>
  ${renderStyles()}
</head>
<body>
  ${renderPage1()}
  ${renderPage2()}
  ${renderPage3()}
  ${renderPage4()}
  ${renderPage5()}
  ${renderPage6()}
</body>
</html>`;
}

function generateExamOnlyHtml() {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Lembar Soal Pre-Test Akuntansi Satker — UNIPDU</title>
  ${renderStyles()}
</head>
<body>
  ${renderPage1()}
  ${renderPage2()}
  ${renderPage3()}
  ${renderPage4()}
</body>
</html>`;
}

const masterHtmlPath = path.join(projectRoot, 'Pre-Test_Master_Satker.html');
const examHtmlPath = path.join(projectRoot, 'Lembar_Soal_Satker.html');
const masterPdfPath = path.join(projectRoot, 'Pre-Test_Akuntansi_Satker_Intern.pdf');
const examPdfPath = path.join(projectRoot, 'Lembar_Soal_Pre-Test_Satker.pdf');

fs.writeFileSync(masterHtmlPath, generateMasterHtml(), 'utf-8');
fs.writeFileSync(examHtmlPath, generateExamOnlyHtml(), 'utf-8');

console.log('HTML files generated successfully.');

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

try {
  console.log('Generating Master PDF (Soal + Kunci Jawaban)...');
  execSync(`"${chromePath}" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="${masterPdfPath}" "${masterHtmlPath}"`, { stdio: 'inherit' });
  console.log(`Generated: ${masterPdfPath}`);

  console.log('Generating Exam-Only PDF (Khusus Lembar Soal Peserta)...');
  execSync(`"${chromePath}" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="${examPdfPath}" "${examHtmlPath}"`, { stdio: 'inherit' });
  console.log(`Generated: ${examPdfPath}`);
} catch (err) {
  console.error('Error generating PDF with Chrome:', err);
  process.exit(1);
}
