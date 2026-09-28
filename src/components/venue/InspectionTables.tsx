"use client";

import { RotateCcw, Wrench, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  formatInspectionDate,
  inspectionLocationLabel,
  RETURN_STAGE_LABELS,
  type RepairLogView,
  type ReturnInspectionView,
  type ReturnStage,
} from '@/lib/venueInspection';

/**
 * The two lists of Pemeriksaan Ruang, laid out like SIMPEL's maintenance page:
 * flat rows on the page, plain column heads, a status as a dot and a word
 * (never a filled pill), one small button per row. Only the colours are SAKU's.
 */

type Tone = 'info' | 'neutral' | 'warning' | 'success';

const DOT: Record<Tone, string> = {
  info: 'bg-indigo-500',
  neutral: 'bg-slate-400',
  warning: 'bg-amber-500',
  success: 'bg-green-500',
};

const STAGE_TONES: Record<ReturnStage, Tone> = {
  siap_dikembalikan: 'info',
  sedang_dipakai: 'neutral',
  sudah_diserahkan: 'neutral',
  belum_diserahkan: 'neutral',
};

const HEAD = 'h-auto whitespace-nowrap border-b border-slate-200 px-3 py-2.5 text-xs font-medium text-slate-500';
const CELL = 'whitespace-normal px-3 py-3 align-top text-slate-700';
const ROW = 'border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70';

// `!` because globals.css forces 16px on buttons at 768px and below; see ReturnInspectionDialog.
const BUTTON = 'h-8 rounded-md px-3 text-[13px]! font-medium';
const PRIMARY = 'bg-indigo-600 text-white hover:bg-indigo-700';
const SECONDARY = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900';

export function StatusBadge({ tone, children, detail }: { tone: Tone; children: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-slate-800">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone])} aria-hidden />
        {children}
      </span>
      {detail && <span className="pl-3 text-xs text-slate-500">{detail}</span>}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <Icon size={28} strokeWidth={1.5} className="mb-3 text-slate-300" aria-hidden />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="mt-1 max-w-sm text-[13px] text-slate-500">{description}</p>
    </div>
  );
}

export function InspectionRowsSkeleton() {
  return (
    <div className="divide-y divide-slate-100">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-4 px-3 py-4">
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/5 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
          </div>
          <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
          <div className="h-8 w-16 animate-pulse rounded-md bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function ReturnsTable({
  items,
  onInspect,
}: {
  items: ReturnInspectionView[];
  onInspect: (item: ReturnInspectionView) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={RotateCcw}
        title="Tidak ada peminjaman aktif"
        description="Ruangan yang sedang atau sudah dipakai dan belum diperiksa akan muncul di sini."
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-0 hover:bg-transparent">
          <TableHead className={HEAD}>Kegiatan</TableHead>
          <TableHead className={cn(HEAD, 'hidden md:table-cell')}>Pemohon</TableHead>
          <TableHead className={cn(HEAD, 'hidden sm:table-cell')}>Tanggal</TableHead>
          <TableHead className={HEAD}>Tahap</TableHead>
          <TableHead className={cn(HEAD, 'text-right')}>
            <span className="sr-only">Aksi</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const multiDay = item.groupTotal && item.groupTotal > 1;
          return (
            <TableRow key={item.id} className={ROW}>
              <TableCell className={CELL}>
                <p className="font-medium text-slate-900">{item.kegiatan}</p>
                <p className="text-[13px] text-slate-500">{inspectionLocationLabel(item)}</p>
                <p className="text-[13px] tabular-nums text-slate-400 sm:hidden">
                  {formatInspectionDate(item.waktu)}
                  {multiDay ? ` · hari ${item.groupIndex}/${item.groupTotal}` : ''}
                </p>
              </TableCell>
              <TableCell className={cn(CELL, 'hidden md:table-cell')}>
                <p className="text-slate-800">{item.pemohon}</p>
                {item.ownerName && <p className="text-[13px] text-slate-500">PIC {item.ownerName}</p>}
              </TableCell>
              <TableCell className={cn(CELL, 'hidden whitespace-nowrap tabular-nums sm:table-cell')}>
                {formatInspectionDate(item.waktu)}
                {multiDay ? (
                  <span className="block text-[13px] text-slate-500">
                    hari {item.groupIndex}/{item.groupTotal}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className={CELL}>
                <StatusBadge tone={STAGE_TONES[item.stage]}>{RETURN_STAGE_LABELS[item.stage]}</StatusBadge>
              </TableCell>
              <TableCell className={cn(CELL, 'text-right')}>
                <Button
                  type="button"
                  variant={item.stage === 'siap_dikembalikan' ? 'default' : 'outline'}
                  onClick={() => onInspect(item)}
                  className={cn(BUTTON, item.stage === 'siap_dikembalikan' ? PRIMARY : SECONDARY)}
                >
                  Periksa
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function RepairsTable({
  items,
  onResolve,
}: {
  items: RepairLogView[];
  onResolve: (log: RepairLogView) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="Belum ada catatan perbaikan"
        description="Barang atau ruangan yang dilaporkan rusak saat pemeriksaan akan muncul di sini."
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-0 hover:bg-transparent">
          <TableHead className={HEAD}>Barang</TableHead>
          <TableHead className={cn(HEAD, 'hidden md:table-cell')}>Keterangan</TableHead>
          <TableHead className={cn(HEAD, 'hidden lg:table-cell')}>Penanggung jawab</TableHead>
          <TableHead className={HEAD}>Status</TableHead>
          <TableHead className={cn(HEAD, 'text-right')}>
            <span className="sr-only">Aksi</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((log) => {
          const open = log.status === 'Dalam Perbaikan';
          return (
            <TableRow key={log.id} className={ROW}>
              <TableCell className={CELL}>
                <p className="font-medium text-slate-900">{log.namaBarang}</p>
                <p className="text-[13px] tabular-nums text-slate-500">
                  {log.jumlah} unit · {log.kondisi.toLowerCase()}
                </p>
              </TableCell>
              <TableCell className={cn(CELL, 'hidden max-w-sm md:table-cell')}>
                <p className="line-clamp-2 text-slate-700">{log.keterangan || '—'}</p>
                <p className="text-[13px] text-slate-500">
                  Dilaporkan {log.tanggalLapor ? formatInspectionDate(log.tanggalLapor) : '—'}
                  {log.reportedBy ? ` oleh ${log.reportedBy}` : ''}
                </p>
              </TableCell>
              <TableCell className={cn(CELL, 'hidden lg:table-cell')}>{log.penanggungJawab || '—'}</TableCell>
              <TableCell className={CELL}>
                <StatusBadge tone={open ? 'warning' : 'success'} detail={!open && log.resolvedBy ? `oleh ${log.resolvedBy}` : undefined}>
                  {open ? 'Diservis' : 'Selesai'}
                </StatusBadge>
              </TableCell>
              <TableCell className={cn(CELL, 'whitespace-nowrap text-right')}>
                {open && (
                  <Button type="button" onClick={() => onResolve(log)} className={cn(BUTTON, PRIMARY)}>
                    Selesai servis
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
