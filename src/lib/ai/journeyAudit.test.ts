import test from 'node:test';
import assert from 'node:assert/strict';
import { auditJourneyWithGemini, JourneyAuditPayload } from './journeyAudit';

test('auditJourneyWithGemini throws a helpful error when GEMINI_API_KEY is missing', async () => {
  const samplePayload: JourneyAuditPayload = {
    employeeName: 'Buamat',
    activityName: 'piket gus heri',
    dateStart: '2026-09-03',
    timeStart: '06:30',
    dateEnd: '2026-09-04',
    timeEnd: '14:05',
    isMultiDay: true,
    nightCount: 1,
    elapsedDurationHours: 31.58,
    drivingDurationHours: 15.87,
    totalDistanceKm: 957.27,
    points: ['UNIPDU Jombang', 'Megaland Hotel Solo', 'Masjid Tembelang'],
  };

  await assert.rejects(
    async () => {
      await auditJourneyWithGemini(samplePayload, '');
    },
    {
      message: /GEMINI_API_KEY belum dikonfigurasi/,
    },
  );
});
