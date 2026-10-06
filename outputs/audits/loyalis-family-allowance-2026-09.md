# Audit Tunjangan Keluarga Loyalis September 2026

Database: internal-bak. Pemeriksaan: 2026-10-06 10:05:35 WIB. Semua akses database hanya baca.

Diperiksa 181 slip September yang dikunci dan 254 profil Loyalis. 176 slip sesuai profil terkini. Lima slip berbeda; riwayat edit membuktikan perubahan data tanggungan setelah slip dikunci.

Seluruh lima nilai tersimpan sesuai data sebelum perubahan setelah penguncian. Rumus persentase saat ini juga diverifikasi dengan perhitungan terpisah untuk seluruh 181 slip. Tidak ditemukan kesalahan perhitungan yang berlaku pada semua Loyalis.

Terdapat 73 profil tanpa slip September; statusnya: {"KELUAR":73}. Seluruh 181 Loyalis pada roster September memiliki slip. Tidak ada perbedaan nilai Gaji Pokok atau T. Keluarga antara lockedSnapshot dan earnings di dokumen slip.

## Perbedaan Dengan Profil Terkini

Nilai hitung ulang menggunakan kelayakan pada akhir September 2026. Selisih positif berarti nilai hitung ulang lebih besar. Selisih ini memerlukan peninjauan; laporan ini tidak mengubah slip atau mengesahkan koreksi.

| Pegawai | ID | Gaji Pokok | Persentase Tersimpan | Persentase Terkini | Tersimpan | Hitung Ulang | Selisih |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dr. Hj. Herin Mawarti, S.Kep., Ners., M.Biomed. | Loyalis_077 | Rp1.150.000 | 30% | 17.5% | Rp345.000 | Rp201.250 | -Rp143.750 |
| H. Yosi Agustiawan, S.T., M.MT., AFHEA, Ph.D. | Loyalis_042 | Rp1.370.000 | 27.5% | 15% | Rp376.750 | Rp205.500 | -Rp171.250 |
| Hj. Khotimah, S.Kep., Ns., M.Kes. | Loyalis_075 | Rp1.200.000 | 27.5% | 17.5% | Rp330.000 | Rp210.000 | -Rp120.000 |
| M. Ali Nawawi, S.E., M.M. | Loyalis_107 | Rp631.000 | 15% | 27.5% | Rp94.650 | Rp173.525 | +Rp78.875 |
| Siti Roudhatul Jannah, S.ST.Keb., M.Tr.Keb. | Loyalis_161 | Rp532.000 | 5% | 15% | Rp26.600 | Rp79.800 | +Rp53.200 |

## Verifikasi Riwayat

### Dr. Hj. Herin Mawarti, S.Kep., Ners., M.Biomed.

Slip 2026_09_Loyalis_077 dikunci 2026-10-04 11:52:47 WIB. Berdasarkan data sebelum perubahan berikut, kelayakan September adalah 30% atau Rp345.000, sesuai slip tersimpan. Audit penguncian: zhnsZBP2J1eP3MWCTkBm. Nilai sebelum dan sesudah penguncian sama.

Edit 2026-10-05 11:46:10 WIB; EmpEditLog kCvhm4nY7Y5jv7RTEZsM:

- family_allowance_metrics.dependents.legacy-PT-2: "Anak 2; PT; masuk belum dicatat; dihentikan 2026-10-01; ID anak legacy-PT-2" → "Anak 2; S1; masuk 2020-09-01; lulus 2024-09-01; dihentikan 2026-10-01; ID anak legacy-PT-2"

### H. Yosi Agustiawan, S.T., M.MT., AFHEA, Ph.D.

Slip 2026_09_Loyalis_042 dikunci 2026-10-04 11:53:41 WIB. Berdasarkan data sebelum perubahan berikut, kelayakan September adalah 27.5% atau Rp376.750, sesuai slip tersimpan. Audit penguncian: 67B97HXujvVphByO29bF. Nilai sebelum dan sesudah penguncian sama.

Edit 2026-10-05 12:34:37 WIB; EmpEditLog jaoNuV9nikkGeh2eRM5A:

- family_allowance_metrics.dependents.legacy-PT-1: "Anak 2; PT; masuk belum dicatat; dihentikan 2026-10-01; ID anak legacy-PT-1" → "Anak 2; S1; masuk 2022-04-01; lulus 2026-04-01; dihentikan 2026-10-01; ID anak legacy-PT-1"

### Hj. Khotimah, S.Kep., Ns., M.Kes.

Slip 2026_09_Loyalis_075 dikunci 2026-10-04 11:53:51 WIB. Berdasarkan data sebelum perubahan berikut, kelayakan September adalah 27.5% atau Rp330.000, sesuai slip tersimpan. Audit penguncian: mjjKQ9UamsctOpPSRcPu. Nilai sebelum dan sesudah penguncian sama.

Edit 2026-10-05 12:18:53 WIB; EmpEditLog ZwrwxC5Of0YisHtza48D:

- family_allowance_metrics.dependents.legacy-PT-1: "Anak 2; PT; masuk belum dicatat; dihentikan 2026-10-01; ID anak legacy-PT-1" → "Anak 2; S1; masuk 2022-08-01; lulus 2026-08-01; dihentikan 2026-10-01; ID anak legacy-PT-1"

Edit 2026-10-05 12:29:30 WIB; EmpEditLog dZviYWdUF4ANUYDTr8X9:

- family_allowance_metrics.children_pt: 0 → 1
- family_allowance_metrics.children_s1: 0 → 1
- family_allowance_metrics.children_slta: 1 → 0
- family_allowance_metrics.dependents.legacy-SLTA-1: "Anak 1; SLTA; masuk 2026-07-01; lulus 2029-07-01; ID anak legacy-SLTA-1" → "Anak 1; S1; masuk 2026-07-01; lulus 2030-07-01; ID anak legacy-SLTA-1"

### M. Ali Nawawi, S.E., M.M.

Slip 2026_09_Loyalis_107 dikunci 2026-10-04 11:54:44 WIB. Berdasarkan data sebelum perubahan berikut, kelayakan September adalah 15% atau Rp94.650, sesuai slip tersimpan. Audit penguncian: reXbe5eE3wOW0A5SAuQ4. Nilai sebelum dan sesudah penguncian sama.

Edit 2026-10-05 10:38:09 WIB; EmpEditLog zHI9AeXJNTnSWly9QzAx:

- family_allowance_metrics.children_pt: 0 → 1
- family_allowance_metrics.children_sd: 2 → 0
- family_allowance_metrics.children_slta: 0 → 1
- family_allowance_metrics.children_s1: null → 0
- family_allowance_metrics.children_s2: null → 1
- family_allowance_metrics.dependents.legacy-SD-1: "Anak 1; SD; masuk belum dicatat; ID anak legacy-SD-1" → "Anak 1; S2; masuk 2025-09-01; lulus 2027-09-01; ID anak legacy-SD-1"
- family_allowance_metrics.dependents.legacy-SD-2: "Anak 2; SD; masuk belum dicatat; ID anak legacy-SD-2" → "Anak 2; SLTA; masuk 2024-07-01; lulus 2027-07-01; ID anak legacy-SD-2"

### Siti Roudhatul Jannah, S.ST.Keb., M.Tr.Keb.

Slip 2026_09_Loyalis_161 dikunci 2026-10-04 11:56:17 WIB. Berdasarkan data sebelum perubahan berikut, kelayakan September adalah 5% atau Rp26.600, sesuai slip tersimpan. Audit penguncian: uOMNKVH31Kttcf3b2thu. Nilai sebelum dan sesudah penguncian sama.

Edit 2026-10-06 09:42:54 WIB; EmpEditLog IzA4BMhMEhz0NhiP1m2a:

- family_allowance_metrics.children_sd: 0 → 2
- family_allowance_metrics.children_s1: null → 0
- family_allowance_metrics.children_s2: null → 0
- family_allowance_metrics.dependents.c6eb11e6-777a-4212-ad88-21f6482095f9: null → "Anak 1; SD; lahir 2020-02-22; lulus 2033-02-22; ID anak c6eb11e6-777a-4212-ad88-21f6482095f9"
- family_allowance_metrics.dependents.97d81bd3-7d50-45af-9add-fdeee47350bc: null → "Anak 2; SD; lahir 2022-04-26; lulus 2035-04-26; ID anak 97d81bd3-7d50-45af-9add-fdeee47350bc"

## Semua Slip September

| Pegawai | ID | Gaji Pokok | T. Keluarga Tersimpan | Hitung Ulang Profil Terkini | Selisih |
| --- | --- | ---: | ---: | ---: | ---: |
| A. Khaerudin, S.Ag. | Loyalis_044 | Rp605.000 | Rp90.750 | Rp90.750 | Rp0 |
| Abdul Ghofar, S.Kep., Ners., M.Pd.I. | Loyalis_073 | Rp1.150.000 | Rp201.250 | Rp201.250 | Rp0 |
| Abdul Hamid, S.HI. | Loyalis_083 | Rp850.000 | Rp42.500 | Rp42.500 | Rp0 |
| Achmad Mundzir, S.HI. | Loyalis_137 | Rp507.000 | Rp25.350 | Rp25.350 | Rp0 |
| Achmat Rosid, S.Kom., M.Kom. | Loyalis_201 | Rp375.000 | Rp56.250 | Rp56.250 | Rp0 |
| Adi Yusuf, S.S., M.Pd. | Loyalis_126 | Rp575.000 | Rp28.750 | Rp28.750 | Rp0 |
| Afsah Novitasari, S.Si., M.Pd. | Loyalis_112 | Rp877.000 | Rp87.700 | Rp87.700 | Rp0 |
| Ahmad Arif, S.AB. | Loyalis_124 | Rp429.000 | Rp85.800 | Rp85.800 | Rp0 |
| Ahmad Farhan, S.Kom., M.M. | Loyalis_227 | Rp644.000 | Rp96.600 | Rp96.600 | Rp0 |
| Ahmad Izzul Iman, S.Kom. | Loyalis_092 | Rp590.000 | Rp59.000 | Rp59.000 | Rp0 |
| Ainun Ni'mah, S.S. | Loyalis_209 | Rp329.000 | Rp0 | Rp0 | Rp0 |
| Aizun Najih, S.Psi., M.I.Kom. | Loyalis_069 | Rp1.300.000 | Rp292.500 | Rp292.500 | Rp0 |
| Alief Arsalam Muharram, S.Kom. | Loyalis_223 | Rp365.000 | Rp18.250 | Rp18.250 | Rp0 |
| Alifah Nuriyati, S.Sos. | Loyalis_071 | Rp1.029.000 | Rp282.975 | Rp282.975 | Rp0 |
| Ana Farida Ulfa, S.Kep., Ners., M.Kep. | Loyalis_052 | Rp1.125.000 | Rp281.250 | Rp281.250 | Rp0 |
| Ana Rahmawati, M.Pd | Loyalis_151 | Rp760.000 | Rp76.000 | Rp76.000 | Rp0 |
| Andik Wahyun Muqoyyidin,M.PdI | Loyalis_103 | Rp713.000 | Rp35.650 | Rp35.650 | Rp0 |
| Andri Eko Zulfikar, S.Kom. | Loyalis_084 | Rp715.000 | Rp107.250 | Rp107.250 | Rp0 |
| Anisatul Barita, S.Sos. | Loyalis_091 | Rp549.000 | Rp82.350 | Rp82.350 | Rp0 |
| Arifa Retnowuni Dzulhilmi, S.Psi., M.Kes. | Loyalis_018 | Rp455.000 | Rp113.750 | Rp113.750 | Rp0 |
| Arifin, S.Ag., M.Pd.I. | Loyalis_029 | Rp950.000 | Rp95.000 | Rp95.000 | Rp0 |
| Ashlaha Baladina, S.I.Kom., M.A. | Loyalis_243 | Rp452.000 | Rp0 | Rp0 | Rp0 |
| Asna Malini, S.Kom. | Loyalis_023 | Rp1.050.000 | Rp315.000 | Rp315.000 | Rp0 |
| Athi' Linda Yani, S.Kep., Ners., M.Kep. | Loyalis_129 | Rp741.000 | Rp0 | Rp0 | Rp0 |
| Bakri, S.Pd.I., M.Pd. | Loyalis_110 | Rp590.000 | Rp147.500 | Rp147.500 | Rp0 |
| Bambang Setyobudi, S.E., M.M. | Loyalis_108 | Rp754.000 | Rp113.100 | Rp113.100 | Rp0 |
| Binti Qoni'ah, S.S., M.Hum. | Loyalis_089 | Rp767.000 | Rp191.750 | Rp191.750 | Rp0 |
| Chandra Sukma Anugrah, S.Kom. | Loyalis_144 | Rp663.000 | Rp99.450 | Rp99.450 | Rp0 |
| Choirin | Loyalis_250 | Rp489.000 | Rp97.800 | Rp97.800 | Rp0 |
| Ciptianingsari Ayu Vitantri, M.Pd. | Loyalis_176 | Rp760.000 | Rp133.000 | Rp133.000 | Rp0 |
| Cynthia Alvionita Ferima, S.Si., M.Si. | Loyalis_235 | Rp626.000 | Rp62.600 | Rp62.600 | Rp0 |
| Devin Prihar Ninuk, S.Kep., Ns., M.Kep. | Loyalis_167 | Rp608.000 | Rp91.200 | Rp91.200 | Rp0 |
| Dewi Triloka Wulandari, S.ST., M.Tr.Keb. | Loyalis_134 | Rp624.000 | Rp93.600 | Rp93.600 | Rp0 |
| Dhikrul Hakim,M.PdI | Loyalis_104 | Rp754.000 | Rp37.700 | Rp37.700 | Rp0 |
| Diah Ayu Fatmawati, S.Kep., Ners. | Loyalis_100 | Rp795.000 | Rp0 | Rp0 | Rp0 |
| Dian Novita Rohmatin, M.Pd | Loyalis_146 | Rp780.000 | Rp117.000 | Rp117.000 | Rp0 |
| Dian Puspita Yani, S.ST., M.Kes. | Loyalis_059 | Rp940.000 | Rp305.500 | Rp305.500 | Rp0 |
| Diema Hernyka Satyareni, S.Kom. M.Kom. | Loyalis_117 | Rp815.000 | Rp81.500 | Rp81.500 | Rp0 |
| Dina Eka Sofiana, S.E., M.A. | Loyalis_159 | Rp624.000 | Rp171.600 | Rp171.600 | Rp0 |
| Dr. Abid Datul Mukhoyaroh, S.Sos., M.A.B. | Loyalis_171 | Rp592.000 | Rp103.600 | Rp103.600 | Rp0 |
| Dr. Agus Mahfudin, M.Si. | Loyalis_105 | Rp713.000 | Rp178.250 | Rp178.250 | Rp0 |
| Dr. Amrulloh, Lc., M.Th.I. | Loyalis_254 | Rp0 | Rp0 | Rp0 | Rp0 |
| Dr. dr. H.M. Zulfikar As'ad, M.MR. | Loyalis_003 | Rp1.950.000 | Rp585.000 | Rp585.000 | Rp0 |
| Dr. Drs. H. Ali Muhsin, S.Ag., M.Pd.I. | Loyalis_025 | Rp1.321.000 | Rp66.050 | Rp66.050 | Rp0 |
| Dr. Endang Suciati, S.S., M.A. | Loyalis_034 | Rp742.000 | Rp166.950 | Rp166.950 | Rp0 |
| Dr. H. Achmad Fanani, S.S., M.Pd. | Loyalis_035 | Rp1.029.000 | Rp180.075 | Rp180.075 | Rp0 |
| Dr. H. Achmad Zakaria, S.KM., M.Kes. | Loyalis_049 | Rp1.550.000 | Rp426.250 | Rp426.250 | Rp0 |
| Dr. H. Moh. Yahya Ashari, M.Pd. | Loyalis_106 | Rp754.000 | Rp226.200 | Rp226.200 | Rp0 |
| Dr. H. Nasrudin, S.KM., M.Kes. | Loyalis_063 | Rp1.150.000 | Rp172.500 | Rp172.500 | Rp0 |
| Dr. Hj. Afifa S. Zulfikar, S.S., M.Sc. | Loyalis_097 | Rp1.250.000 | Rp0 | Rp0 | Rp0 |
| Dr. Hj. Herin Mawarti, S.Kep., Ners., M.Biomed. | Loyalis_077 | Rp1.150.000 | Rp345.000 | Rp201.250 | -Rp143.750 |
| Dr. Hj. Masruroh Hasyim, S.Kep., Ns., M.Kes. | Loyalis_053 | Rp1.350.000 | Rp236.250 | Rp236.250 | Rp0 |
| Dr. Mahmud Huda, S.HI., M.S.I. | Loyalis_121 | Rp735.000 | Rp128.625 | Rp128.625 | Rp0 |
| Dr. Miftakhul Ilmi, M.Pd | Loyalis_135 | Rp655.000 | Rp98.250 | Rp98.250 | Rp0 |
| Dr. Muhammad Qoimam Bilqisthi Zulfikar, M.Sc., M.P.H. | Loyalis_251 | Rp400.000 | Rp0 | Rp0 | Rp0 |
| Dr. Muhammad Syafii, M.Pd.I. | Loyalis_096 | Rp754.000 | Rp131.950 | Rp131.950 | Rp0 |
| Dr. Mujianto Sholichin, M.Pd.I. | Loyalis_027 | Rp815.000 | Rp142.625 | Rp142.625 | Rp0 |
| Dr. Mukhlisin, M.Pd.I. | Loyalis_024 | Rp1.150.000 | Rp345.000 | Rp345.000 | Rp0 |
| Dr. Mukhoirotin, S.Kep., Ners., M.Kep. | Loyalis_074 | Rp1.250.000 | Rp343.750 | Rp343.750 | Rp0 |
| Dr. Nuning Yudhi Prastyani, S.S., M.Hum. | Loyalis_032 | Rp1.200.000 | Rp360.000 | Rp360.000 | Rp0 |
| Dr. Nur Ulwiyah, M.PdI | Loyalis_118 | Rp735.000 | Rp0 | Rp0 | Rp0 |
| Dr. Wiwik Maryati, S.Sos., M.S.M. | Loyalis_039 | Rp1.150.000 | Rp115.000 | Rp115.000 | Rp0 |
| Dra. Hj. Niswah Qonita | Loyalis_221 | Rp0 | Rp0 | Rp0 | Rp0 |
| Dra. Hj. Umi Hasunah Zaim, M.Th.I. | Loyalis_085 | Rp1.050.000 | Rp0 | Rp0 | Rp0 |
| Drs. H.M. Zaimuddin W. As'ad, M.S. | Loyalis_002 | Rp1.800.000 | Rp315.000 | Rp315.000 | Rp0 |
| Dwi Nurcahyani, S.S., M.Pd.I. | Loyalis_036 | Rp605.000 | Rp121.000 | Rp121.000 | Rp0 |
| Eddy Kurniawan, S.Kom., M.M. | Loyalis_136 | Rp780.000 | Rp117.000 | Rp117.000 | Rp0 |
| Eka Nurjanah, M.Pd. | Loyalis_192 | Rp565.000 | Rp84.750 | Rp84.750 | Rp0 |
| Elly Megawati, S.IP. | Loyalis_217 | Rp365.000 | Rp36.500 | Rp36.500 | Rp0 |
| Fais Tanwirotul Fadhilah, S.AB. | Loyalis_244 | Rp307.000 | Rp30.700 | Rp30.700 | Rp0 |
| Fandy Ahmad, S.Sos., M.Ag. | Loyalis_241 | Rp484.000 | Rp24.200 | Rp24.200 | Rp0 |
| Fathmah Muthi'ah, S.Ag. | Loyalis_246 | Rp275.000 | Rp0 | Rp0 | Rp0 |
| Fenny Vitiasaridessy, S.ST. | Loyalis_156 | Rp608.000 | Rp91.200 | Rp91.200 | Rp0 |
| Galuh Tisna Widiana, M.Pd. | Loyalis_189 | Rp565.000 | Rp84.750 | Rp84.750 | Rp0 |
| H. Achmad Farid, S.S., M.A., Ph.D. | Loyalis_095 | Rp672.000 | Rp67.200 | Rp67.200 | Rp0 |
| H. Ahmad Haibat Kannaby Zaimuddin, S.I.P., M.Hub.Int. | Loyalis_197 | Rp637.000 | Rp95.550 | Rp95.550 | Rp0 |
| H. Ahmad Laroibafih Zulfikar, S.H. | Loyalis_242 | Rp329.000 | Rp0 | Rp0 | Rp0 |
| H. Andi Yudianto, S.Kep., Ners., M.Kes. | Loyalis_050 | Rp1.500.000 | Rp375.000 | Rp375.000 | Rp0 |
| H. Kusnan, S.Kom. | Loyalis_022 | Rp681.000 | Rp119.175 | Rp119.175 | Rp0 |
| H. M. Zahrul Azhar, S.IP., M.Kes. | Loyalis_020 | Rp1.223.000 | Rp336.325 | Rp336.325 | Rp0 |
| H. Moh Makmun Dr. M.HI | Loyalis_119 | Rp735.000 | Rp73.500 | Rp73.500 | Rp0 |
| H. Sufendi Hariyanto, S.Kep., Ns., M.MB. | Loyalis_111 | Rp655.000 | Rp32.750 | Rp32.750 | Rp0 |
| H. Yosi Agustiawan, S.T., M.MT., AFHEA, Ph.D. | Loyalis_042 | Rp1.370.000 | Rp376.750 | Rp205.500 | -Rp171.250 |
| H.M. Samsukadi, Lc., M.Th.I. | Loyalis_141 | Rp624.000 | Rp93.600 | Rp93.600 | Rp0 |
| H.M. Zahrul Jihad, S.H., M.Si. | Loyalis_203 | Rp1.050.000 | Rp157.500 | Rp157.500 | Rp0 |
| Haris Hidayatulloh, M.Hi | Loyalis_113 | Rp695.000 | Rp104.250 | Rp104.250 | Rp0 |
| Helmi Anuchasari, S.KM., M.KM. | Loyalis_060 | Rp681.000 | Rp136.200 | Rp136.200 | Rp0 |
| Hj. Anna Qomariana, S.E., M.Pd.I. | Loyalis_013 | Rp1.650.000 | Rp288.750 | Rp288.750 | Rp0 |
| Hj. Khotimah, S.Kep., Ns., M.Kes. | Loyalis_075 | Rp1.200.000 | Rp330.000 | Rp210.000 | -Rp120.000 |
| Hj. Kurniawati, S.Kep., Ners., M.Kep. | Loyalis_051 | Rp1.250.000 | Rp250.000 | Rp250.000 | Rp0 |
| Hj. Masadah Endang Susilowati, S.AB. | Loyalis_072 | Rp1.029.000 | Rp0 | Rp0 | Rp0 |
| Hj. Masrikah, S.AB. | Loyalis_067 | Rp1.450.000 | Rp217.500 | Rp217.500 | Rp0 |
| Hj. Sabrina Dwi Prihatini, S.KM., M.Kes. | Loyalis_055 | Rp0 | Rp0 | Rp0 | Rp0 |
| Hj. Suspa Hariati, S.Sos., M.M. | Loyalis_005 | Rp1.400.000 | Rp70.000 | Rp70.000 | Rp0 |
| Hj. Uswatun Qoyyimah, S.S., M.Ed., Ph.D. | Loyalis_031 | Rp1.700.000 | Rp0 | Rp0 | Rp0 |
| Hosnatul Hasanah, S.Kom. | Loyalis_163 | Rp407.000 | Rp61.050 | Rp61.050 | Rp0 |
| Hudzaifah, S.S. | Loyalis_065 | Rp1.100.000 | Rp247.500 | Rp247.500 | Rp0 |
| Ihwanus Sholihin, M.Pd. | Loyalis_245 | Rp350.000 | Rp17.500 | Rp17.500 | Rp0 |
| Ika Vita Sari, S.S. | Loyalis_139 | Rp418.000 | Rp62.700 | Rp62.700 | Rp0 |
| Imam Arifin, S.Pd.I., M.Pd. | Loyalis_046 | Rp850.000 | Rp212.500 | Rp212.500 | Rp0 |
| Imam Mutaqin, M.Pd.I. | Loyalis_166 | Rp608.000 | Rp91.200 | Rp91.200 | Rp0 |
| Indah Mukarromah, S.Kep., Ns., M.Kep. | Loyalis_064 | Rp815.000 | Rp122.250 | Rp122.250 | Rp0 |
| Indah Sumiyarsih, S.E. | Loyalis_014 | Rp1.300.000 | Rp357.500 | Rp357.500 | Rp0 |
| Indah Wahyuni, SS | Loyalis_114 | Rp575.000 | Rp0 | Rp0 | Rp0 |
| Indra Kusuma Wardani, S.Si., M.Pd. | Loyalis_120 | Rp735.000 | Rp110.250 | Rp110.250 | Rp0 |
| Irta Fitriana, S.S., M.Hum. | Loyalis_102 | Rp631.000 | Rp94.650 | Rp94.650 | Rp0 |
| Irva Arina Alawiyah, S.E. | Loyalis_040 | Rp760.000 | Rp171.000 | Rp171.000 | Rp0 |
| Irvan Sarifudin, S.Kom. | Loyalis_225 | Rp365.000 | Rp0 | Rp0 | Rp0 |
| Isbayu' Uliyah, S.Kom. | Loyalis_173 | Rp407.000 | Rp71.225 | Rp71.225 | Rp0 |
| Ita Fitria, S. Kom. | Loyalis_066 | Rp1.150.000 | Rp316.250 | Rp316.250 | Rp0 |
| Khamim Mansyur, S.AB. | Loyalis_070 | Rp1.350.000 | Rp236.250 | Rp236.250 | Rp0 |
| Khoiro Ummah, S.AB. | Loyalis_079 | Rp1.050.000 | Rp183.750 | Rp183.750 | Rp0 |
| Krisna Atikah Madjid, S.IP. | Loyalis_247 | Rp275.000 | Rp0 | Rp0 | Rp0 |
| Lilik Maftukhatin, S.Pd.I., M.Pd.I. | Loyalis_026 | Rp891.000 | Rp245.025 | Rp245.025 | Rp0 |
| Lilik Nur Azizah, S.E. | Loyalis_015 | Rp742.000 | Rp37.100 | Rp37.100 | Rp0 |
| Luluk Mahfiyah, S.P. | Loyalis_007 | Rp1.006.000 | Rp201.200 | Rp201.200 | Rp0 |
| Lulus Oktavia Kartikasari, S.Pd. | Loyalis_030 | Rp698.000 | Rp174.500 | Rp174.500 | Rp0 |
| M. Achyar, S.AB. | Loyalis_017 | Rp750.000 | Rp112.500 | Rp112.500 | Rp0 |
| M. Ali Nawawi, S.E., M.M. | Loyalis_107 | Rp631.000 | Rp94.650 | Rp173.525 | +Rp78.875 |
| M. Khoirul Abdillah, S.Kom. | Loyalis_199 | Rp375.000 | Rp18.750 | Rp18.750 | Rp0 |
| M. Masrur, S.Kom., M.Kom. | Loyalis_043 | Rp1.147.000 | Rp57.350 | Rp57.350 | Rp0 |
| M. Qomaruzzaman, S.Sos. | Loyalis_016 | Rp799.000 | Rp119.850 | Rp119.850 | Rp0 |
| Maisaroh, M.Si. | Loyalis_149 | Rp624.000 | Rp0 | Rp0 | Rp0 |
| Moh. Rajin, S.Kep., Ners., M.Kes. | Loyalis_061 | Rp1.400.000 | Rp140.000 | Rp140.000 | Rp0 |
| Moh. Shohibul Wafa, S.Kom., M.Kom. | Loyalis_238 | Rp626.000 | Rp62.600 | Rp62.600 | Rp0 |
| Mohammad Imsin, S.E., M.P. | Loyalis_093 | Rp0 | Rp0 | Rp0 | Rp0 |
| Mokhamad Dafid Andianto, S.Kep., Ners. | Loyalis_179 | Rp421.000 | Rp42.100 | Rp42.100 | Rp0 |
| Muh. Ali Murtadlo, M.Kom. | Loyalis_122 | Rp815.000 | Rp122.250 | Rp122.250 | Rp0 |
| Muhamad Iqbal Prasetya, S.Kom. | Loyalis_214 | Rp365.000 | Rp18.250 | Rp18.250 | Rp0 |
| Muhammad Al Himmy Rusydy, S.KM. | Loyalis_249 | Rp307.000 | Rp0 | Rp0 | Rp0 |
| Muhammad Fajrul Alam Ulin Nuha, S.Kom., M.Kom. | Loyalis_248 | Rp597.000 | Rp0 | Rp0 | Rp0 |
| Muhammad Ghinan Navsih, S.Si.D. | Loyalis_253 | Rp307.000 | Rp0 | Rp0 | Rp0 |
| Muhammad Miftakhul Syaikhuddin, S.Kom., M.Kom. | Loyalis_185 | Rp709.000 | Rp106.350 | Rp106.350 | Rp0 |
| Muhammad Saifuddin, M.Pd. | Loyalis_172 | Rp592.000 | Rp29.600 | Rp29.600 | Rp0 |
| Muhammad Wahyudi | Loyalis_255 | Rp375.000 | Rp37.500 | Rp37.500 | Rp0 |
| Muhammad Zaky, S.E., M.Pd. | Loyalis_009 | Rp1.150.000 | Rp201.250 | Rp201.250 | Rp0 |
| Muzayyaroh, S.ST., M.Keb. | Loyalis_058 | Rp1.120.000 | Rp168.000 | Rp168.000 | Rp0 |
| Nailul Fauziyah, S.Hum., M.Pd. | Loyalis_147 | Rp624.000 | Rp109.200 | Rp109.200 | Rp0 |
| Ninik Azizah, S.ST., M.Kes. | Loyalis_056 | Rp1.076.000 | Rp53.800 | Rp53.800 | Rp0 |
| Nufan Balafif, S.Kom., M.M. | Loyalis_133 | Rp780.000 | Rp78.000 | Rp78.000 | Rp0 |
| Nur Elizah, S.Pd.I. | Loyalis_087 | Rp549.000 | Rp96.075 | Rp96.075 | Rp0 |
| Nur Feri Setiono, S.AB. | Loyalis_115 | Rp508.000 | Rp76.200 | Rp76.200 | Rp0 |
| Nur Mulyawati, S.Sos. | Loyalis_008 | Rp715.000 | Rp107.250 | Rp107.250 | Rp0 |
| Nurdin Bramono, S.S., M.Hum. | Loyalis_081 | Rp978.000 | Rp97.800 | Rp97.800 | Rp0 |
| Nurul Laili, S.Pd. | Loyalis_109 | Rp549.000 | Rp54.900 | Rp54.900 | Rp0 |
| Nurul Lailiyah | Loyalis_178 | Rp407.000 | Rp61.050 | Rp61.050 | Rp0 |
| Prof. Dr. H. Ahmad Zahro, M.A. | Loyalis_001 | Rp0 | Rp0 | Rp0 | Rp0 |
| Pujiani, S.Kep., Ns., M.Kes. | Loyalis_054 | Rp1.350.000 | Rp236.250 | Rp236.250 | Rp0 |
| Purwanti, S.Pd.I. | Loyalis_090 | Rp670.000 | Rp33.500 | Rp33.500 | Rp0 |
| Puspa Mia Widiyaningsih, M.Pd. | Loyalis_236 | Rp498.000 | Rp74.700 | Rp74.700 | Rp0 |
| Ratna Wati, S.Kom. | Loyalis_153 | Rp418.000 | Rp62.700 | Rp62.700 | Rp0 |
| Ririn Susilowati, S.HI., M.E.I. | Loyalis_145 | Rp624.000 | Rp109.200 | Rp109.200 | Rp0 |
| Roikhatur Roisah, S.S. | Loyalis_152 | Rp418.000 | Rp73.150 | Rp73.150 | Rp0 |
| Royyan Amigo, S.Mat., M.Mat. | Loyalis_252 | Rp0 | Rp0 | Rp0 | Rp0 |
| Ryan Irwanda Pratama, S.Kom. | Loyalis_226 | Rp365.000 | Rp36.500 | Rp36.500 | Rp0 |
| Sholahuddin, S.Pd.I. | Loyalis_041 | Rp681.000 | Rp102.150 | Rp102.150 | Rp0 |
| Siti Asiah, M.Pd. | Loyalis_230 | Rp512.000 | Rp115.200 | Rp115.200 | Rp0 |
| Siti Nafiatul Azizah, S.S. | Loyalis_231 | Rp347.000 | Rp0 | Rp0 | Rp0 |
| Siti Rofi'ah, S.Ptk. | Loyalis_080 | Rp959.000 | Rp263.725 | Rp263.725 | Rp0 |
| Siti Roudhatul Jannah, S.ST.Keb., M.Tr.Keb. | Loyalis_161 | Rp532.000 | Rp26.600 | Rp79.800 | +Rp53.200 |
| Siti Urifah, S.Kep., Ns., M.Ns. | Loyalis_101 | Rp795.000 | Rp79.500 | Rp79.500 | Rp0 |
| Sri Banun Titi Istiqomah, S.ST., M.Kes. | Loyalis_148 | Rp702.000 | Rp105.300 | Rp105.300 | Rp0 |
| Sri Wahyuni, A.Ma. Pust. | Loyalis_169 | Rp296.000 | Rp44.400 | Rp44.400 | Rp0 |
| Sujarwo, S.T., M.Kom. | Loyalis_048 | Rp1.076.000 | Rp188.300 | Rp188.300 | Rp0 |
| Suyati, S.ST., M.Kes. | Loyalis_057 | Rp1.029.000 | Rp180.075 | Rp180.075 | Rp0 |
| Tafsillatul Mufida Asriningsih, M.Pd. | Loyalis_177 | Rp760.000 | Rp76.000 | Rp76.000 | Rp0 |
| Teguh Priyo Utomo, S.Kom. | Loyalis_150 | Rp760.000 | Rp114.000 | Rp114.000 | Rp0 |
| Thoif, S.HI., M.Pd. | Loyalis_194 | Rp375.000 | Rp37.500 | Rp37.500 | Rp0 |
| Tomy Syafrudin, M.Pd. | Loyalis_216 | Rp671.000 | Rp100.650 | Rp100.650 | Rp0 |
| Trikaloka Handayani Putri, S.S., M.Pd. | Loyalis_033 | Rp845.000 | Rp190.125 | Rp190.125 | Rp0 |
| Vivin Eka Rahmawati, A.Md.Keb. | Loyalis_127 | Rp546.000 | Rp81.900 | Rp81.900 | Rp0 |
| Wahyuning Ucik, S.Sos. | Loyalis_037 | Rp799.000 | Rp39.950 | Rp39.950 | Rp0 |
| Wim Banu Ukhrowi, S.S., M.Pd. | Loyalis_131 | Rp418.000 | Rp62.700 | Rp62.700 | Rp0 |
| Wiwiek Widiatie, S.Kep., Ners., M.Kes. | Loyalis_078 | Rp1.300.000 | Rp325.000 | Rp325.000 | Rp0 |
| Wiwit Denny Fitriana, S.Si., M.Si. | Loyalis_187 | Rp740.000 | Rp0 | Rp0 | Rp0 |
| Yazid Bustomi, S.Kom. | Loyalis_116 | Rp575.000 | Rp28.750 | Rp28.750 | Rp0 |
| Yulia Arofatus Sobah, S.Kom | Loyalis_130 | Rp546.000 | Rp27.300 | Rp27.300 | Rp0 |
| Yuliana Ika Purnamasari, A.Md.Keb. | Loyalis_140 | Rp507.000 | Rp76.050 | Rp76.050 | Rp0 |
| Zainudin, S.Kom. | Loyalis_182 | Rp407.000 | Rp61.050 | Rp61.050 | Rp0 |
| Zulfa Khusniyah, S.Kep., Ns., M.Pd.I. | Loyalis_062 | Rp1.200.000 | Rp330.000 | Rp330.000 | Rp0 |
| Zuliani, S.Kep., Ns., M.Kep. | Loyalis_143 | Rp655.000 | Rp114.625 | Rp114.625 | Rp0 |

## Profil Tanpa Slip September

| Pegawai | ID | Status Profil |
| --- | --- | --- |
| H. Misbakhul Munir, S.Kom. | Loyalis_004 | KELUAR |
| Abdullah Rikza, S.IP., M.Pd.I. | Loyalis_006 | KELUAR |
| H. M. Abd. Natsir, M.AB. | Loyalis_010 | KELUAR |
| H. Harun Ar Rasyid, S.Pd.I. | Loyalis_011 | KELUAR |
| Dwi Kuswati, CA. | Loyalis_012 | KELUAR |
| Dr. H. Isrofil Amar, M.Ag. | Loyalis_019 | KELUAR |
| Drs. H. M. Ansor Anwar, M.Pd. | Loyalis_021 | KELUAR |
| Achmad Mundzir, S.HI. | Loyalis_028 | KELUAR |
| Siti Zainab Setiawati, A.Md. | Loyalis_038 | KELUAR |
| Emy Irsyadi, S.E. | Loyalis_045 | KELUAR |
| Drs. H. Ir. Sumargono, M.Pd. | Loyalis_047 | KELUAR |
| Anggrea Maduratih, S.AB. | Loyalis_068 | KELUAR |
| Siti Muniroh, S.Kep., Ners. | Loyalis_076 | KELUAR |
| Ir. Syarif Hidayatulloh | Loyalis_082 | KELUAR |
| Dr. H. Afifudin Dimyathi | Loyalis_086 | KELUAR |
| M. Faizin, S.Pd.I. | Loyalis_088 | KELUAR |
| Siti Mutrofin, S.Kom., M.Kom. | Loyalis_094 | KELUAR |
| Didik Saudin, S.Kep., Ners., M.Kep. | Loyalis_098 | KELUAR |
| Edi Wibowo Suwandi, S.Kep., Ners. | Loyalis_099 | KELUAR |
| Muh. Nur Khozin, S.Pd.I. | Loyalis_123 | KELUAR |
| Nurul Khoirun Nisa', S.Kep., Ners. | Loyalis_125 | KELUAR |
| Yuyun Fitriani, A.Md.Keb. | Loyalis_128 | KELUAR |
| Ivan Dwi Fibrian, S.Kom., M.I.Kom. | Loyalis_132 | KELUAR |
| Sandy Octavia Kunyono Rini, S.TP. | Loyalis_138 | KELUAR |
| Yuliasnita Verlandes, S.E., M.S.M. | Loyalis_142 | KELUAR |
| Putri Rahayuningtyas, S.Pd., M.Pd. | Loyalis_154 | KELUAR |
| Rina Suci Andriani, M.Pd. | Loyalis_155 | KELUAR |
| Zakiah, S.Keb., Bd. | Loyalis_157 | KELUAR |
| Ardian Syaifuddin, A.Md.Kep. | Loyalis_158 | KELUAR |
| Hendy, S.Si., M.Si. | Loyalis_160 | KELUAR |
| Anna Rakhmawati, S.S. | Loyalis_162 | KELUAR |
| Darmaji, S.Kom. | Loyalis_164 | KELUAR |
| Suprapti, S.S., M.Pd.I. | Loyalis_165 | KELUAR |
| David Budi Hartanto, S.Kom. | Loyalis_168 | KELUAR |
| M. Kirom | Loyalis_170 | KELUAR |
| Endang Kurniawan, S.Kom., M.M. | Loyalis_174 | KELUAR |
| Erliyah Nurul Jannah, S.Kom., M.Sc. | Loyalis_175 | KELUAR |
| Ike Johan Prihatini, S.Keb., Bd. | Loyalis_180 | KELUAR |
| Imam Latif Rosyadi, A.Md. | Loyalis_181 | KELUAR |
| Ulumul Umah, M.Pd. | Loyalis_183 | KELUAR |
| Ahmad Dzulfikar, M.Pd. | Loyalis_186 | KELUAR |
| Khoirul Islam | Loyalis_188 | KELUAR |
| Dr. H. Imam Baidlowi, M.M. | Loyalis_190 | KELUAR |
| Kusuma Wardhani Mas'udah, S.Si., M.Si. | Loyalis_191 | KELUAR |
| Burhan Abdih, S.Kom. | Loyalis_193 | KELUAR |
| Nisa Ayunda, S.Si., M.Si. | Loyalis_195 | KELUAR |
| Fitrotus Salamah, S.S. | Loyalis_196 | KELUAR |
| Siti Dewi Muchlisoh | Loyalis_198 | KELUAR |
| Aji Muhtarom | Loyalis_200 | KELUAR |
| Nurul Noviana, S.Pd. | Loyalis_202 | KELUAR |
| Ni'mah Akbar Habibie | Loyalis_204 | KELUAR |
| Ircham Ali, S.Kom. | Loyalis_205 | KELUAR |
| Fatikhatus Sholikhah, S.Kom. | Loyalis_206 | KELUAR |
| Luxman Nul Khakim, S.Kep., Ners., M.Kep. | Loyalis_207 | KELUAR |
| Moh. Faizal Fuad Aziz, M.Pd. | Loyalis_208 | KELUAR |
| Rendy Kusuma Indra Permana, S.S. | Loyalis_210 | KELUAR |
| Siti Buryani | Loyalis_211 | KELUAR |
| Mokhamad Abdul Rokhim | Loyalis_212 | KELUAR |
| Serly Apririya Ardi, S.AB. | Loyalis_213 | KELUAR |
| Sri Wahyuni, S.S. | Loyalis_215 | KELUAR |
| Muhammad Ainun Abdurrahman, S.Kom. | Loyalis_218 | KELUAR |
| Riftin Zakia Darajad, S.Kom. | Loyalis_219 | KELUAR |
| Nora Izza Nabila | Loyalis_220 | KELUAR |
| Nuzulia Fitriatun Nisa', M.Pd. | Loyalis_222 | KELUAR |
| Ima Rimayanti | Loyalis_224 | KELUAR |
| Mey Lista Tauryawati, S.Si., M.Si. | Loyalis_228 | KELUAR |
| Andi Agung, S.Si., M.Si. | Loyalis_229 | KELUAR |
| Beda Puspita Candra, M.Kom. | Loyalis_232 | KELUAR |
| Rizka Kurnia Andaru, M.AB. | Loyalis_233 | KELUAR |
| Nurul Aweni | Loyalis_234 | KELUAR |
| Maskuddin Nurcahyo | Loyalis_237 | KELUAR |
| Herjanti Nursuksmaningtyas Santoso, S.S., M.Si. | Loyalis_239 | KELUAR |
| Ichlasul Ayyub | Loyalis_240 | KELUAR |
