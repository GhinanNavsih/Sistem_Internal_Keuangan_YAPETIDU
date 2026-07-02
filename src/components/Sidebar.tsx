"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  UserCog,
  Users,
  FileSpreadsheet,
  Banknote,
  Coins,
  LogOut,
  Menu,
  X
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();
  const { logout, profile } = useAuth();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  if (profile?.role !== 'super_admin') {
    return null;
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const menuItems = [
    {
      name: 'Dashboard',
      path: '/dashboard',
      icon: LayoutDashboard,
      exact: true
    },
    {
      name: 'Manajemen Akses',
      path: '/dashboard/users',
      icon: UserCog
    },
    {
      name: 'Data Pegawai',
      path: '/dashboard/employees',
      icon: Users
    },
    {
      name: 'Payroll Bulanan',
      path: '/dashboard/payroll',
      icon: Coins,
      exact: true
    },
    {
      name: 'Rekap & Vakasi',
      path: `/dashboard/payroll/uraian?month=${currentMonth}&year=${currentYear}`,
      icon: FileSpreadsheet,
      activePattern: '/dashboard/payroll/uraian'
    },
    {
      name: 'Simpan Pinjam',
      path: '/dashboard/payroll/simpan-pinjam',
      icon: Banknote
    }
  ];

  const getIsActive = (item: typeof menuItems[0]) => {
    if (item.exact) {
      return pathname === item.path;
    }
    if (item.activePattern) {
      return pathname.startsWith(item.activePattern);
    }
    return pathname.startsWith(item.path);
  };

  const getLinkStyle = (isActive: boolean) => {
    if (isActive) {
      return "flex items-center gap-3 px-4 py-3 rounded-xl bg-indigo-50 border-l-4 border-indigo-500 text-indigo-600 font-bold transition-all shadow-[0_2px_10px_rgba(99,102,241,0.05)] cursor-pointer";
    }
    return "flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:text-indigo-600 hover:bg-slate-50/80 hover:translate-x-1 transition-all duration-200 cursor-pointer font-semibold";
  };

  // Reusable Navigation Link List
  const NavigationLinks = ({ onLinkClick }: { onLinkClick?: () => void }) => (
    <nav className="flex flex-col gap-1.5 py-4">
      {menuItems.map((item) => {
        const isActive = getIsActive(item);
        const Icon = item.icon;
        return (
          <Link
            key={item.name}
            href={item.path}
            onClick={onLinkClick}
            className={getLinkStyle(isActive)}
          >
            <Icon className={`w-5 h-5 shrink-0 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-indigo-500' : 'text-slate-400 group-hover:text-indigo-500'}`} />
            <span>{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* ======================================================== */}
      {/* DESKTOP SIDEBAR                                          */}
      {/* ======================================================== */}
      <aside className="hidden md:flex flex-col justify-between w-72 shrink-0 border-r border-slate-200/80 bg-white/80 backdrop-blur-md sticky top-0 h-screen p-6 z-40">
        <div className="flex flex-col gap-8">
          {/* Brand Header */}
          <div className="flex items-center gap-3 px-2">
            <img
              src="/Logo YAPETIDU (Transparent bg).png"
              alt="Logo YAPETIDU"
              className="w-10 h-10 object-contain"
            />
            <div>
              <h2 className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent font-extrabold text-xl tracking-tight leading-none">
                YAPETIDU
              </h2>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5 block">
                Sistem Keuangan
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <NavigationLinks />
        </div>

        {/* User Profile Footer */}
        <div className="border-t border-slate-200/80 pt-4 mt-auto">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-md shadow-indigo-100 uppercase text-sm">
              {profile?.displayName ? profile.displayName.substring(0, 2) : 'AD'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate leading-tight">
                {profile?.displayName || 'Administrator'}
              </p>
              <p className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md w-fit mt-1">
                Super Admin
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={logout}
            className="w-full rounded-xl shadow-sm bg-white border-slate-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-100 transition-all cursor-pointer flex items-center justify-center gap-2 h-10 font-bold"
          >
            <LogOut className="w-4 h-4" />
            Keluar
          </Button>
        </div>
      </aside>

      {/* ======================================================== */}
      {/* MOBILE TOP BAR NAVIGATION                                */}
      {/* ======================================================== */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-6 py-4 bg-white/80 backdrop-blur-md border-b border-slate-200/80 w-full">
        <div className="flex items-center gap-2">
          <img
            src="/Logo YAPETIDU (Transparent bg).png"
            alt="Logo YAPETIDU"
            className="w-8 h-8 object-contain"
          />
          <div>
            <span className="font-extrabold text-sm text-slate-800 leading-none block">YAPETIDU</span>
            <span className="text-[9px] block text-indigo-600 font-bold mt-0.5">Sistem Keuangan</span>
          </div>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsMobileOpen(true)}
          className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      {/* ======================================================== */}
      {/* MOBILE DRAWER SIDEBAR                                    */}
      {/* ======================================================== */}
      {isMobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
            onClick={() => setIsMobileOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="relative flex flex-col justify-between w-72 max-w-[80vw] h-full bg-white p-6 shadow-2xl animate-in slide-in-from-left duration-300 z-50">
            <div className="flex flex-col gap-6">
              {/* Drawer Brand Header & Close Button */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <img
                    src="/Logo YAPETIDU (Transparent bg).png"
                    alt="Logo YAPETIDU"
                    className="w-8 h-8 object-contain"
                  />
                  <div>
                    <span className="font-extrabold text-sm text-slate-800 leading-none block">YAPETIDU</span>
                    <span className="text-[9px] block text-indigo-600 font-bold mt-0.5">Sistem Keuangan</span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsMobileOpen(false)}
                  className="rounded-xl border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer size-7"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Navigation Links */}
              <NavigationLinks onLinkClick={() => setIsMobileOpen(false)} />
            </div>

            {/* User Profile Footer */}
            <div className="border-t border-slate-200/80 pt-4 mt-auto">
              <div className="flex items-center gap-3 mb-4 px-2">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-md shadow-indigo-100 uppercase text-xs">
                  {profile?.displayName ? profile.displayName.substring(0, 2) : 'AD'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate leading-tight">
                    {profile?.displayName || 'Administrator'}
                  </p>
                  <p className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-md w-fit mt-0.5">
                    Super Admin
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setIsMobileOpen(false);
                  logout();
                }}
                className="w-full rounded-xl shadow-sm bg-white border-slate-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-100 transition-all cursor-pointer flex items-center justify-center gap-2 h-9 text-xs font-bold"
              >
                <LogOut className="w-3.5 h-3.5" />
                Keluar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
