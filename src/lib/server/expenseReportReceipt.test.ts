import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  MAX_EXPENSE_REPORT_RECEIPT_BYTES,
} from '@/lib/payroll/proposalExpenseReports';
import { compressExpenseReportReceipt } from './expenseReportReceipt';

function fileFromBytes(bytes: Uint8Array, name: string, type: string): File {
  const fileBytes = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fileBytes).set(bytes);
  return new File([fileBytes], name, { type });
}

test('keeps a receipt at or below the storage limit unchanged', async () => {
  const file = fileFromBytes(new Uint8Array([1, 2, 3]), 'receipt.pdf', 'application/pdf');
  const result = await compressExpenseReportReceipt(file);

  assert.equal(result, file);
  assert.ok(result.size <= MAX_EXPENSE_REPORT_RECEIPT_BYTES);
});

test('compresses an oversized image receipt below 1MB', async () => {
  const width = 1800;
  const height = 1800;
  const pixels = new Uint8Array(width * height * 3);
  let seed = 0x12345678;
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    pixels[index] = seed >>> 24;
  }

  const source = await sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).jpeg({ quality: 100 }).toBuffer();
  assert.ok(source.byteLength > MAX_EXPENSE_REPORT_RECEIPT_BYTES);

  const result = await compressExpenseReportReceipt(
    fileFromBytes(source, 'Large Receipt.png', 'image/png'),
  );

  assert.ok(result.size <= MAX_EXPENSE_REPORT_RECEIPT_BYTES);
  assert.equal(result.type, 'image/jpeg');
  assert.equal(result.name, 'Large_Receipt.jpg');
});

test('does not store an oversized PDF without browser rasterization', async () => {
  const oversizedPdf = fileFromBytes(
    new Uint8Array(MAX_EXPENSE_REPORT_RECEIPT_BYTES + 1),
    'large-receipt.pdf',
    'application/pdf',
  );

  await assert.rejects(
    () => compressExpenseReportReceipt(oversizedPdf),
    /maksimal 1MB/,
  );
});
