import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCoretaxBpmpXml,
  generateCoretaxBpmpExcel,
  type CoretaxExportParams,
} from './coretaxExport';

const mockParams: CoretaxExportParams = {
  periodKey: '2026_11',
  periodLabel: 'November 2026',
  year: 2026,
  month: 11,
  withholderNpwp: '1234567890123456',
  withholderNitku: '0000000000000000',
  withholderName: "UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM",
  rows: [
    {
      no: 1,
      id: 'Loyalis_001',
      name: "Dr. dr. H.M. Zulfikar As'ad, M.MR.",
      nik: '3517102602640001',
      npwp: '3517102602640001',
      ptkp: 'TK/0',
      terCategory: 'A',
      penghasilanBruto: 6_230_000,
      tarifPersen: 0.75,
      pphDipotong: 46_725,
      gender: 'male',
    },
    {
      no: 2,
      id: 'Loyalis_002',
      name: 'Athi Linda Yani, S.Kep., Ners., M.Kep.',
      nik: '3517114607820005',
      npwp: '3517114607820005',
      ptkp: 'TK/0',
      terCategory: 'A',
      penghasilanBruto: 15_000_000,
      tarifPersen: 6,
      pphDipotong: 900_000,
      gender: 'female',
    },
    {
      no: 3,
      id: 'BC_001',
      name: 'Budi Santoso',
      nik: '3517101501800003',
      npwp: '',
      ptkp: 'TK/0',
      terCategory: 'A',
      penghasilanBruto: 3_500_000,
      tarifPersen: 0,
      pphDipotong: 0,
      gender: 'male',
    },
  ],
};

test('generateCoretaxBpmpXml generates valid XML with all Coretax headers and rows', () => {
  const xml = generateCoretaxBpmpXml(mockParams);

  assert.ok(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<CoretaxDocument xmlns="http://coretax.pajak.go.id/schema/bupot" version="1.0">'));
  assert.ok(xml.includes('<TahunPajak>2026</TahunPajak>'));
  assert.ok(xml.includes('<MasaPajak>11</MasaPajak>'));
  assert.ok(xml.includes('<NPWPPemotong>1234567890123456</NPWPPemotong>'));
  assert.ok(xml.includes('<JumlahData>3</JumlahData>'));

  // Total gross: 6.230.000 + 15.000.000 + 3.500.000 = 24.730.000
  assert.ok(xml.includes('<TotalPenghasilanBruto>24730000</TotalPenghasilanBruto>'));
  // Total PPh: 46.725 + 900.000 + 0 = 946.725
  assert.ok(xml.includes('<TotalPPhDipotong>946725</TotalPPhDipotong>'));

  // Check detail items
  assert.ok(xml.includes("Dr. dr. H.M. Zulfikar As&apos;ad, M.MR."));
  assert.ok(xml.includes('<StatusPTKP>TK/0</StatusPTKP>'));
  assert.ok(xml.includes('<KategoriTER>A</KategoriTER>'));
  assert.ok(xml.includes('<JumlahPenghasilanBruto>6230000</JumlahPenghasilanBruto>'));
  assert.ok(xml.includes('<PPhDipotong>46725</PPhDipotong>'));
});

test('generateCoretaxBpmpExcel generates valid XLSX workbook with DATA and REKAP_TER sheets', () => {
  const wb = generateCoretaxBpmpExcel(mockParams);

  assert.deepEqual(wb.SheetNames, ['DATA', 'REKAP_TER']);
  assert.ok(wb.Sheets['DATA']);
  assert.ok(wb.Sheets['REKAP_TER']);
});
