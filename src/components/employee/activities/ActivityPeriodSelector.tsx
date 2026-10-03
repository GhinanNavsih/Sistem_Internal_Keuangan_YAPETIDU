"use client";

import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {
  CalendarDays,
} from 'lucide-react';
import {
  MONTHS_ID,
} from '@/utils/rekapConfig';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  EARLIEST_PERIOD_MONTH,
  EARLIEST_PERIOD_YEAR,
  YEARS,
} from './activityModel';
import type { EmployeeActivitiesModel } from './activityModel';

interface ActivityPeriodSelectorProps {
  model: EmployeeActivitiesModel;
}

export default function ActivityPeriodSelector({ model }: ActivityPeriodSelectorProps) {
  const {
    isSopir,
    isKetuaShiftSatpam,
    month,
    setMonth,
    year,
    setYear,
  } = model;

  return (
    <>
{!isSopir && (
          <Card className="bg-white rounded-md shadow-sm border-none">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <CalendarDays className="w-4 h-4 text-teal-500 shrink-0" />
                <div className="flex items-center gap-2 flex-1">
                  <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
                    <SelectTrigger className="text-sm font-bold text-slate-700 bg-slate-50 rounded-sm border border-slate-200 h-10 px-3 flex-1">
                      <SelectValue>{MONTHS_ID[month - 1]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-md border-slate-100 shadow-xl bg-white">
                      {MONTHS_ID.map((m, i) => {
                        const now = new Date();
                        const currentYear = now.getFullYear();
                        const currentMonth = now.getMonth() + 1;
                        const isHidden =
                          (year === EARLIEST_PERIOD_YEAR && (i + 1) < EARLIEST_PERIOD_MONTH) ||
                          (year === currentYear && (i + 1) > currentMonth) ||
                          (year > currentYear) ||
                          (isKetuaShiftSatpam && year === 2026 && (i + 1) < 7);
                        if (isHidden) return null;
                        return (
                          <SelectItem
                            key={i + 1}
                            value={String(i + 1)}
                          >
                            {m}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v))}>
                    <SelectTrigger className="text-sm font-bold text-slate-700 bg-slate-50 rounded-sm border border-slate-200 h-10 px-3 w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-md border-slate-100 shadow-xl bg-white">
                      {YEARS.map(y => {
                        const now = new Date();
                        const currentYear = now.getFullYear();
                        const isHidden = isKetuaShiftSatpam && (
                          y < 2026 || y > currentYear
                        );
                        if (isHidden) return null;
                        return (
                          <SelectItem
                            key={y}
                            value={String(y)}
                          >
                            {y}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
    </>
  );
}
