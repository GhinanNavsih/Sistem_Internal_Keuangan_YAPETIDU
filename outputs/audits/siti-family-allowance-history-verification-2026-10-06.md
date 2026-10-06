# Verifikasi Riwayat Tanggungan Siti Roudhatul Jannah

Pemeriksaan database dilakukan hanya baca terhadap Employees_Loyalis/Loyalis_161.

## Temuan Yang Dapat Dibuktikan

- Snapshot database pada 6 Oktober 2026 pukul 09.40 WIB berisi spouse_count = 1 dan seluruh jumlah anak = 0. Belum ada dependents.
- Metadata server pada snapshot tersebut menunjukkan updateTime terakhir 9 September 2026 pukul 12.40.31 WIB. Ini menunjukkan dokumen tersebut tidak mengalami perubahan tersimpan dari waktu itu sampai snapshot 6 Oktober pukul 09.40 WIB.
- Snapshot sesudah pengisian ulang, pada 6 Oktober pukul 09.43 WIB, sudah berisi dua anak SD. Metadata server menunjukkan penyimpanan terjadi pukul 09.42.55 WIB.
- EmpEditLog IzA4BMhMEhz0NhiP1m2a mencatat children_sd dari 0 menjadi 2 beserta penambahan dua riwayat anak. Log dikirim pukul 09.42.58 WIB.
- Seluruh 455 dokumen EmpEditLog yang tersedia diperiksa. Tidak ditemukan log Bu Siti sebelum pengisian ulang ini. Tidak ditemukan FamilyAllowanceRequests untuk Bu Siti.

## Batas Kesimpulan

Pengisian ulang pada 6 Oktober terbukti. Pernyataan bahwa HR pernah mengisi form sebelumnya tidak dapat dibantah hanya dari log ini. Namun, jika pengisian sebelumnya dilakukan setelah 9 September pada dokumen pegawai yang sama, data itu tidak menjadi perubahan tersimpan pada dokumen yang diperiksa. Tidak ada bukti bahwa data anak berhasil tersimpan lalu hilang dalam rentang tersebut.

Jika pengisian sebelumnya dilakukan sebelum 9 September, belum ada riwayat database yang cukup untuk menentukan apakah data pernah tersimpan atau tertimpa. Perlu tanggal pengisian sebelumnya dari HR untuk memperjelas rentang pemeriksaan.

Pencarian Cloud Audit Logs untuk dokumen ini tidak menghasilkan entri. Daftar backup Firestore kosong dan Point-in-Time Recovery tidak aktif; versi historis tersedia sekitar satu jam, sehingga snapshot lebih lama tidak dapat diperiksa.

## Temuan Pada Alur Penyimpanan

Log pegawai bukan catatan otomatis yang atomik dengan setiap penyimpanan. Log baru dikirim ketika daftar perubahan dikonfirmasi. Penyimpanan Loyalis juga belum memeriksa apakah profil terbaru berubah sejak form dibuka, dan pembatalan perubahan mengembalikan nilai lama tanpa log permanen. Ini adalah kelemahan yang dapat menimbulkan kehilangan data atau riwayat yang tidak lengkap, tetapi tidak terbukti menjadi penyebab kasus Bu Siti.

Tidak ada kode aplikasi atau data produksi yang diubah dalam pemeriksaan ini.
