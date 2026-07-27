"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Eye, KeyRound, LogOut, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ImpersonationBanner() {
  const {
    isImpersonatingUi,
    isCustomTokenImpersonating,
    activeProfile,
    impersonationSessionInfo,
    stopUiImpersonation,
    stopCustomTokenImpersonation,
  } = useAuth();

  const [restoringSession, setRestoringSession] = useState(false);

  const handleStopCustomToken = async () => {
    try {
      setRestoringSession(true);
      await stopCustomTokenImpersonation();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal memulihkan sesi Super Admin');
    } finally {
      setRestoringSession(false);
    }
  };

  if (isCustomTokenImpersonating && impersonationSessionInfo) {
    return (
      <div className="bg-gradient-to-r from-rose-700 via-rose-600 to-amber-600 text-white px-4 py-2.5 shadow-md flex flex-wrap items-center justify-between gap-3 text-xs md:text-sm font-medium z-[9999] sticky top-0 border-b border-rose-500/30">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <KeyRound className="w-4 h-4 text-white animate-pulse" />
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-[10px] bg-rose-900/60 text-rose-100 px-2 py-0.5 rounded-md mr-2">
              Custom Token Session Active
            </span>
            <span>
              Terkoneksi sebagai <strong>{impersonationSessionInfo.targetDisplayName || impersonationSessionInfo.targetEmail}</strong> ({impersonationSessionInfo.targetEmail}). Semua operasi database & server berjalan dengan identitas ini.
            </span>
          </div>
        </div>

        <Button
          onClick={handleStopCustomToken}
          disabled={restoringSession}
          size="sm"
          className="bg-white text-rose-700 hover:bg-rose-50 font-bold rounded-xl shadow-sm border border-white/20 transition-all text-xs px-3.5 py-1.5 h-auto flex items-center gap-1.5"
        >
          {restoringSession ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Memulihkan Sesi Admin...</span>
            </>
          ) : (
            <>
              <LogOut className="w-3.5 h-3.5" />
              <span>🔒 Kembali ke Sesi Super Admin</span>
            </>
          )}
        </Button>
      </div>
    );
  }

  const handleStopUi = () => {
    stopUiImpersonation();
    window.location.href = '/dashboard/users';
  };

  if (isImpersonatingUi && activeProfile) {
    return (
      <div className="bg-gradient-to-r from-amber-600 via-amber-500 to-orange-500 text-white px-4 py-2.5 shadow-md flex flex-wrap items-center justify-between gap-3 text-xs md:text-sm font-medium z-[9999] sticky top-0 border-b border-amber-400/30">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Eye className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="font-bold uppercase tracking-wider text-[10px] bg-amber-900/50 text-amber-100 px-2 py-0.5 rounded-md mr-2">
              Mode Preview UI
            </span>
            <span>
              Melihat aplikasi sebagai <strong>{activeProfile.displayName || activeProfile.email}</strong> ({activeProfile.role})
            </span>
          </div>
        </div>

        <Button
          onClick={handleStopUi}
          size="sm"
          className="bg-white text-amber-800 hover:bg-amber-50 font-bold rounded-xl shadow-sm border border-white/20 transition-all text-xs px-3.5 py-1.5 h-auto flex items-center gap-1.5 cursor-pointer"
        >
          <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
          <span>Hentikan Preview UI</span>
        </Button>
      </div>
    );
  }

  return null;
}
