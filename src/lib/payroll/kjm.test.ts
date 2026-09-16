import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { calculateKjm, emptyKjmEdits, filterKjmCourses, groupKjmCourses, kjmAdminCap, reviewKjm, type KjmCourse, type KjmEdits, type KjmEmployee } from './kjm';
import { parseKjmWorkbook } from './kjmWorkbook';
import { isPayableVakasiTambahan, vakasiApprovedEarningsForEmployee } from './vakasiTambahan';

const employee: KjmEmployee = { id: 'Loyalis_1', name: 'Test', nipy: '01123', active: true, type: 'Dosen', isDosen: true, education: 'S2-Sosial', role: 'Dosen', recognizedDate: '2014-09-30' };
const rate = { degree: 'S2', group: 'Sosial', amount: 20000 };
const course: KjmCourse = { id: 'tetap_6', sheet: 'Tetap Asli', row: 6, lecturer: '01123-Test', nipy: '01123', program: 'PAI', code: 'MK1', name: 'Course', kelas: 'A', sks: 3, attendance: 16 };
const reviewed = (courses: KjmCourse[] = [course]): KjmEdits => ({ ...emptyKjmEdits(), consortiumReviewed: true,
  courses: Object.fromEntries(courses.map(item => [item.id, { consortium: false }])) });
test('regular Dosen obligation is 112, with only the non-Dosen jabatan reduction', () => {
  const r = calculateKjm(employee, 140, 0, rate, '2026-09');
  assert.equal(r.obligation, 112); assert.equal(r.total, 560000);
  assert.equal(calculateKjm({ ...employee, role: 'Dekan' }, 140, 0, rate, '2026-09').obligation, 84);
  assert.throws(() => calculateKjm({ ...employee, role: '' }, 140, 0, rate, '2026-09'), /Jabatan/);
});
test('Kesehatan Dosen obligation is 4 SKS × 14 and excess starts above 56', () => {
  const e = { ...employee, education: 'S2-Kesehatan', role: 'Dosen' };
  const healthRate = { degree: 'S2', group: 'Kesehatan', amount: 37500 };
  const atObligation = calculateKjm(e, 56, 0, healthRate, '2026-09');
  assert.equal(atObligation.base, 56); assert.equal(atObligation.reduction, 0);
  assert.equal(atObligation.obligation, 56); assert.equal(atObligation.excess, 0); assert.equal(atObligation.total, 0);
  const overObligation = calculateKjm({ ...e, education: 'S3-kesehatan' }, 84, 0, healthRate, '2026-09');
  assert.equal(overObligation.obligation, 56); assert.equal(overObligation.excess, 28); assert.equal(overObligation.total, 1050000);
});
test('Keluarga has no obligation but is capped at 252', () => {
  const r = calculateKjm({ ...employee, type: 'Keluarga', role: '' }, 300, 0, rate, '2026-09');
  assert.equal(r.base, 0); assert.equal(r.reduction, 0); assert.equal(r.cap, 252); assert.equal(r.total, 5040000);
});
test('Admin remains eligible with isDosen false: zero obligation and service caps', () => {
  const e = { ...employee, type: 'Admin', isDosen: false, role: 'Staf' };
  const before = calculateKjm(e, 200, 0, rate, '2026-08');
  const at = calculateKjm(e, 200, 0, rate, '2026-09');
  assert.equal(before.cap, 84); assert.equal(at.cap, 126);
  assert.equal(at.obligation, 0); assert.equal(at.reduction, 0);
  assert.equal(kjmAdminCap('2014-10-01', '2026-09'), 84);
  assert.throws(() => kjmAdminCap('', '2026-09'));
  assert.throws(() => kjmAdminCap('2027-01-01', '2026-09'));
  assert.throws(() => kjmAdminCap('2014-02-30', '2026-09'));
});
test('consortium takes priority inside counted excess, never exceeds total', () => {
  const r = calculateKjm(employee, 140, 60, rate, '2026-09');
  assert.equal(r.excess, 88); assert.equal(r.consortiumExcess, 60); assert.equal(r.regularExcess, 28);
  assert.equal(r.total, 2060000);
  const c = calculateKjm(employee, 0, 180, rate, '2026-09');
  assert.equal(c.regularExcess, 0); assert.equal(c.consortiumExcess, 68);
  assert.equal(calculateKjm(employee, 40, 0, rate, '2026-09').total, 0);
});
test('cap attendance before SKS weighting; preserve explicit zero correction', () => {
  const e = { ...employee, type: 'Keluarga' };
  assert.equal(reviewKjm([course], reviewed(), [e], [rate], '2026-09').results[0].regular, 42);
  const edits = reviewed(); edits.courses[course.id] = { ...edits.courses[course.id], attendance: 0, reason: 'Tidak diakui' };
  const r = reviewKjm([course], edits, [e], [rate], '2026-09');
  assert.equal(r.results[0].total, 0); assert.equal(r.issues.length, 0);
  assert.equal(course.attendance, 16);
});
test('an unchecked or missing consortium flag defaults to regular teaching', () => {
  const e = { ...employee, type: 'Keluarga' as const };
  const r = reviewKjm([course], { ...emptyKjmEdits(), consortiumReviewed: true }, [e], [rate], '2026-09');
  assert.equal(r.issues.length, 0); assert.equal(r.results[0].regular, 42); assert.equal(r.results[0].consortium, 0);
});
test('unmatched and duplicate NIPY cannot silently map; inactive cannot be reassigned', () => {
  assert.match(reviewKjm([course], reviewed(), [], [rate], '2026-09').issues.join(), /pilih pegawai/);
  assert.match(reviewKjm([course], reviewed(), [employee, { ...employee, id: 'Loyalis_2' }], [rate], '2026-09').issues.join(), /pilih pegawai/);
  const edits = reviewed(); edits.lecturers[course.lecturer] = { employeeId: 'Loyalis_2', reason: 'Mapping' };
  const r = reviewKjm([course], edits, [{ ...employee, active: false }, { ...employee, id: 'Loyalis_2', nipy: '999' }], [rate], '2026-09');
  assert.equal(r.results.length, 0); assert.match(r.ignored[0], /Non-Aktif/);
});
test('rate and attendance can be overridden without a reason; Khusus has no guessed rate', () => {
  const e = { ...employee, education: 'Khusus' };
  const edits = reviewed();
  assert.match(reviewKjm([course], edits, [e], [rate], '2026-09').issues.join(), /matrix/);
  edits.lecturers[course.lecturer] = { rateKey: 'S2-Sosial' };
  edits.courses[course.id] = { ...edits.courses[course.id], attendance: 14 };
  assert.equal(reviewKjm([course], edits, [e], [rate], '2026-09').issues.length, 0);
});
test('duplicate courses across sheets block approval until excluded', () => {
  const other = { ...course, id: 'kontrak_9', sheet: 'Kontrak Asli', row: 9 };
  const edits = reviewed([course, other]);
  assert.match(reviewKjm([course, other], edits, [employee], [rate], '2026-09').issues.join(), /duplikat/);
  edits.courses[other.id] = { ...edits.courses[other.id], exclude: true, reason: 'Duplikat sumber' };
  assert.equal(reviewKjm([course, other], edits, [employee], [rate], '2026-09').issues.length, 0);
});
test('review confirmation and lecturer eligibility are mandatory', () => {
  assert.match(reviewKjm([course], emptyKjmEdits(), [employee], [rate], '2026-09').issues.join(), /Konfirmasi/);
  assert.match(reviewKjm([course], reviewed(), [{ ...employee, isDosen: false }], [rate], '2026-09').issues.join(), /isDosen/);
});
test('course classification groups classes by program and code', () => {
  const otherClass = { ...course, id: 'tetap_7', name: 'Course (kelas lain)', kelas: 'B' };
  const groups = groupKjmCourses([course, otherClass]);
  assert.equal(groups.length, 1); assert.deepEqual(groups[0].courseIds, [course.id, otherClass.id]);
  assert.deepEqual(groups[0].classes, ['A', 'B']);
});
test('raw parser propagates lecturer context and ignores derived sheets', () => {
  const w = XLSX.utils.book_new();
  for (const name of ['Kontrak Asli', 'Tetap asli']) XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([
    ['Program Studi PAI'], ['#', 'Kode MK', 'Nama Mata Kuliah', 'SKS', 'Kelas', 'Hadir'], ['01123-Test'], [1, 'MK1', 'Course', 3, '1A', 16, 48, 'WRONG DOSEN'],
  ]), name);
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([['do not use', 999999999]]), 'Dosen Rekap');
  const r = parseKjmWorkbook(XLSX.write(w, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(r.length, 2); assert.equal(r[0].nipy, '01123'); assert.equal(r[0].lecturer, '01123-Test'); assert.equal(r[0].attendance, 16);
});
test('raw parser parses latest format with Program Studi column', () => {
  const w = XLSX.utils.book_new();
  for (const name of ['Kontrak Asli', 'Tetap Asli']) XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([
    ['Detail Rekap Kehadiran Dosen'],
    ['01 Maret 2026 s.d 31 Agustus 2026'],
    ['Program Studi '],
    ['#', 'Program Studi', 'Kode MK', 'Nama Mata Kuliah', 'SKS', 'Kelas', 'Hadir', 'SKS*Hadir'],
    ['12011116316-Achmat Rosid S.Kom., M.Kom'],
    [1, 'Administrasi Bisnis', '31WP19017', 'SISTEM INFORMASI MANAJEMEN', 3, '4A1', 10, 30],
  ]), name);
  const r = parseKjmWorkbook(XLSX.write(w, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(r.length, 2);
  assert.equal(r[0].nipy, '12011116316');
  assert.equal(r[0].lecturer, '12011116316-Achmat Rosid S.Kom., M.Kom');
  assert.equal(r[0].program, 'Administrasi Bisnis');
  assert.equal(r[0].code, '31WP19017');
  assert.equal(r[0].name, 'SISTEM INFORMASI MANAJEMEN');
  assert.equal(r[0].sks, 3);
  assert.equal(r[0].attendance, 10);
});
test('rekap excludes NERS, RPL, and Praktek/Praktik only from Tetap Asli', () => {
  const makeCourse = (id: string, sheet: string, changes: Partial<KjmCourse>): KjmCourse => ({ ...course, id, sheet, ...changes });
  const courses = [
    makeCourse('tetap_keep', 'Tetap Asli', { code: 'KEEP', program: 'PAI', kelas: 'A', name: 'Course', sks: 1, attendance: 14 }),
    makeCourse('tetap_ners', 'Tetap Asli', { code: 'NERS', program: 'ners', kelas: 'A', name: 'Course', sks: 1, attendance: 14 }),
    makeCourse('tetap_rpl', 'Tetap Asli', { code: 'RPL', program: 'PAI', kelas: '2rPl', name: 'Course', sks: 1, attendance: 14 }),
    makeCourse('tetap_praktek', 'Tetap Asli', { code: 'PRAKTEK', program: 'PAI', kelas: 'A', name: 'Praktek lapangan', sks: 1, attendance: 14 }),
    makeCourse('tetap_praktik', 'Tetap Asli', { code: 'PRAKTIK', program: 'PAI', kelas: 'A', name: 'Praktik lapangan', sks: 1, attendance: 14 }),
    makeCourse('kontrak_keep', 'Kontrak Asli', { code: 'KONTRAK', program: 'NERS', kelas: '1RPL', name: 'Praktik lapangan', sks: 1, attendance: 14 }),
  ];
  assert.deepEqual(filterKjmCourses(courses).map(item => item.id), ['tetap_keep', 'kontrak_keep']);
  const result = reviewKjm(courses, { ...emptyKjmEdits(), consortiumReviewed: true }, [employee], [rate], '2026-09');
  assert.equal(result.issues.length, 0); assert.equal(result.results[0].regular, 28);
});
test('KJM projection is payable only after approval and creates an itemized earning', () => {
  for (const status of [undefined, 'draft', 'voided']) assert.equal(isPayableVakasiTambahan({ sourceKind: 'kjm_import', status }), false);
  const event = { sourceKind: 'kjm_import', status: 'approved', eventName: 'Kelebihan Jam Mengajar 20251', eventWorkers: { Loyalis_1: { payGiven: 560000 } } };
  assert.equal(isPayableVakasiTambahan(event), true);
  assert.deepEqual(vakasiApprovedEarningsForEmployee([event], 'Loyalis_1'), [{ label: event.eventName, amount: 560000 }]);
});
