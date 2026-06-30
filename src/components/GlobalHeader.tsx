"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut, UserCog, Users, FileSpreadsheet, Banknote, Coins } from 'lucide-react';

export default function GlobalHeader() {
  const pathname = usePathname();
  const { logout, profile } = useAuth();

  if (profile?.role !== 'super_admin') {
    return null;
  }

  const getButtonStyle = (paths: string[], exact = false) => {
    const isActive = paths.some(p => {
      if (exact) return pathname === p;
      return pathname === p || (p !== '/dashboard' && pathname.startsWith(p));
    });
    if (isActive) {
      return "rounded-xl shadow-sm bg-indigo-50/50 border-indigo-200 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-100/50 transition-all font-bold cursor-pointer";
    }
    return "rounded-xl shadow-sm bg-white border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 transition-all cursor-pointer";
  };

  const isRoot = pathname === '/dashboard';

  // Get current date for the Rekap link (defaulting to current month/year)
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  return (
    <div className="flex justify-between items-center mb-6 w-full animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex gap-2">
        {!isRoot && (
          <Link href="/dashboard">
            <Button variant="outline" className="rounded-xl shadow-sm bg-white border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer">
              ← Kembali
            </Button>
          </Link>
        )}
        <Button
          variant="outline"
          onClick={logout}
          className="rounded-xl shadow-sm bg-white border-slate-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-100 transition-all cursor-pointer"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Keluar
        </Button>
      </div>
      <div className="flex gap-3">
        <Link href="/dashboard/users">
          <Button variant="outline" className={getButtonStyle(['/dashboard/users'])}>
            <UserCog className="w-4 h-4 mr-2" /> Manajemen Akses
          </Button>
        </Link>
        <Link href="/dashboard/employees">
          <Button variant="outline" className={getButtonStyle(['/dashboard/employees'])}>
            <Users className="w-4 h-4 mr-2" /> Data Pegawai
          </Button>
        </Link>
        <Link href="/dashboard/payroll">
          <Button variant="outline" className={getButtonStyle(['/dashboard/payroll'], true)}>
            <Coins className="w-4 h-4 mr-2" /> Payroll
          </Button>
        </Link>
        <Link href={`/dashboard/payroll/uraian?month=${currentMonth}&year=${currentYear}`}>
          <Button variant="outline" className={getButtonStyle(['/dashboard/payroll/uraian'])}>
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Rekap & Vakasi Tambahan
          </Button>
        </Link>
        <Link href="/dashboard/payroll/simpan-pinjam">
          <Button variant="outline" className={getButtonStyle(['/dashboard/payroll/simpan-pinjam'])}>
            <Banknote className="w-4 h-4 mr-2" /> Simpan Pinjam
          </Button>
        </Link>
      </div>
    </div>
  );
}
