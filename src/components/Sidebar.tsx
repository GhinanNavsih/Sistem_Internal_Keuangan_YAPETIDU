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
  BarChart3,
  LogOut,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';

const SIDEBAR_COLLAPSED_KEY = 'yapetidu_sidebar_collapsed';

export default function Sidebar() {
  const pathname = usePathname();
  const { logout, profile, activeProfile } = useAuth();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const currentProfile = activeProfile || profile;

  // Restore collapsed state from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored === 'true') setIsCollapsed(true);
    } catch {}
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  if (!currentProfile || !['super_admin', 'finance_verifier'].includes(currentProfile.role)) {
    return null;
  }

  const toggleCollapsed = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  };

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const menuItems = [
    {
      name: 'Payroll Bulanan',
      path: '/dashboard/payroll',
      icon: Coins,
      exact: true
    },
    {
      name: 'Data Pegawai',
      path: '/dashboard/employees',
      icon: Users
    },
    {
      name: 'Manajemen Akses',
      path: '/dashboard/users',
      icon: UserCog
    },
    {
      // No month/year here: the uraian layout resolves its own default period
      // (previous month before the 6th, unless closed) when the URL carries
      // none. Forcing "now" here would pre-empt that on every fresh visit.
      name: 'Rekap & Vakasi',
      path: '/dashboard/payroll/uraian',
      icon: FileSpreadsheet,
      activePattern: '/dashboard/payroll/uraian'
    },
    {
      name: 'Simpan Pinjam',
      path: '/dashboard/payroll/simpan-pinjam',
      icon: Banknote
    },
    {
      // Starts the "monitoring" group — rendered below a separator so the
      // two dashboards read apart from the operational menus above.
      name: 'Dashboard',
      path: '/dashboard',
      icon: LayoutDashboard,
      exact: true,
      startsGroup: true
    },
    {
      name: 'Dashboard Pekarya',
      path: `/dashboard/payroll/pekarya-dashboard?month=${currentMonth}&year=${currentYear}`,
      icon: BarChart3,
      activePattern: '/dashboard/payroll/pekarya-dashboard'
    }
  ].filter(item => {
    if (currentProfile.role === 'super_admin') return true;
    return item.path === '/dashboard/payroll';
  });

  const getIsActive = (item: typeof menuItems[0]) => {
    if (item.exact) {
      return pathname === item.path;
    }
    if (item.activePattern) {
      if (item.activePattern === '/dashboard/payroll/uraian') {
        return pathname.startsWith('/dashboard/payroll/uraian') || pathname.startsWith('/dashboard/payroll/activity-review');
      }
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

  const getCollapsedLinkStyle = (isActive: boolean) => {
    if (isActive) {
      return "relative group flex items-center justify-center w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 transition-all cursor-pointer";
    }
    return "relative group flex items-center justify-center w-11 h-11 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-slate-50/80 transition-all duration-200 cursor-pointer";
  };

  // Reusable Navigation Link List (expanded)
  const NavigationLinks = ({ onLinkClick }: { onLinkClick?: () => void }) => (
    <nav className="flex flex-col gap-1.5 py-4">
      {menuItems.map((item, index) => {
        const isActive = getIsActive(item);
        const Icon = item.icon;
        return (
          <React.Fragment key={item.name}>
            {item.startsGroup && index > 0 && (
              <div className="my-2 border-t border-slate-200/80" />
            )}
            <Link
              href={item.path}
              onClick={onLinkClick}
              className={getLinkStyle(isActive)}
            >
              <Icon className={`w-5 h-5 shrink-0 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-indigo-500' : 'text-slate-400 group-hover:text-indigo-500'}`} />
              <span>{item.name}</span>
            </Link>
          </React.Fragment>
        );
      })}
    </nav>
  );

  // Navigation Links for collapsed mode (icons only + tooltip)
  const CollapsedNavigationLinks = () => (
    <nav className="flex flex-col items-center gap-2 py-4">
      {menuItems.map((item, index) => {
        const isActive = getIsActive(item);
        const Icon = item.icon;
        return (
          <React.Fragment key={item.name}>
            {item.startsGroup && index > 0 && (
              <div className="my-1.5 w-8 border-t border-slate-200/80" />
            )}
            <Link
              href={item.path}
              className={getCollapsedLinkStyle(isActive)}
              title={item.name}
            >
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-indigo-500' : ''}`} />
              {/* Tooltip */}
              <span className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200 shadow-lg z-50">
                {item.name}
              </span>
            </Link>
          </React.Fragment>
        );
      })}
    </nav>
  );

  const roleLabel =
    currentProfile?.role === 'super_admin'
      ? 'Super Admin'
      : currentProfile?.role === 'finance_verifier'
        ? 'Badan Keuangan'
        : currentProfile?.role || 'Pengguna';

  return (
    <>
      {/* ======================================================== */}
      {/* DESKTOP SIDEBAR — EXPANDED                               */}
      {/* ======================================================== */}
      <aside
        className={`hidden md:flex flex-col justify-between shrink-0 border-r border-slate-200/80 bg-white/80 backdrop-blur-md sticky top-0 h-screen z-40 transition-all duration-300 ease-in-out ${
          isCollapsed ? 'w-[76px] p-3' : 'w-72 p-6'
        }`}
      >
        <div className="flex flex-col gap-8">
          {/* Brand Header */}
          {isCollapsed ? (
            <div className="flex items-center justify-center pt-1">
              <img
                src="/Logo YAPETIDU (Transparent bg).png"
                alt="Logo YAPETIDU"
                className="w-9 h-9 object-contain"
              />
            </div>
          ) : (
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
          )}

          {/* Navigation Links */}
          {isCollapsed ? <CollapsedNavigationLinks /> : <NavigationLinks />}
        </div>

        {/* Bottom Area: Collapse toggle + User Profile */}
        <div className="mt-auto">
          {/* Collapse / Expand Toggle */}
          <div className={`flex ${isCollapsed ? 'justify-center' : 'justify-end'} mb-3`}>
            <button
              onClick={toggleCollapsed}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all duration-200 cursor-pointer"
              title={isCollapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}
            >
              {isCollapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
            </button>
          </div>

          {/* User Profile Footer */}
          <div className="border-t border-slate-200/80 pt-4">
            {isCollapsed ? (
              /* Collapsed: avatar + logout icon */
              <div className="flex flex-col items-center gap-3">
                <div
                  className="relative group w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-md shadow-indigo-100 uppercase text-sm cursor-default"
                  title={`${currentProfile?.displayName || 'Administrator'} — ${roleLabel}`}
                >
                  {currentProfile?.displayName ? currentProfile.displayName.substring(0, 2) : 'AD'}
                  <span className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-[11px] font-semibold whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200 shadow-lg z-50">
                    {currentProfile?.displayName || 'Administrator'}
                    <br />
                    <span className="text-indigo-300 text-[10px]">{roleLabel}</span>
                  </span>
                </div>
                <button
                  onClick={logout}
                  className="flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 text-rose-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all cursor-pointer"
                  title="Keluar"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              /* Expanded: full user info + logout button */
              <>
                <div className="flex items-center gap-3 mb-4 px-2">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-md shadow-indigo-100 uppercase text-sm">
                    {currentProfile?.displayName ? currentProfile.displayName.substring(0, 2) : 'AD'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate leading-tight">
                      {currentProfile?.displayName || 'Administrator'}
                    </p>
                    <p className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md w-fit mt-1">
                      {roleLabel}
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
              </>
            )}
          </div>
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
                  {currentProfile?.displayName ? currentProfile.displayName.substring(0, 2) : 'AD'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate leading-tight">
                    {currentProfile?.displayName || 'Administrator'}
                  </p>
                  <p className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-md w-fit mt-0.5">
                    {roleLabel}
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
