"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useAuth, type UserProfile } from '@/lib/AuthContext';
import { auth } from '@/lib/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';
import {
  Banknote,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Compass,
  KeyRound,
  Loader2,
  Menu as MenuIcon,
  ShieldCheck,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function supportsEmployeeNavigation(profile: UserProfile): boolean {
  if (profile.role === 'ketua_shift_satpam') return true;
  return profile.role === 'honorer';
}

export default function EmployeeNavigationMenu() {
  const { profile, activeProfile } = useAuth();
  const currentProfile = activeProfile || profile;
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);
  const [passwordResetMessage, setPasswordResetMessage] =
    useState<SnackbarMessage | null>(null);

  const handlePasswordReset = async () => {
    if (!currentProfile?.email) return;
    setPasswordResetLoading(true);
    setPasswordResetMessage(null);
    try {
      await sendPasswordResetEmail(auth, currentProfile.email);
      setPasswordResetMessage({
        type: 'success',
        text: `Tautan reset password telah dikirim ke email ${currentProfile.email}. Silakan periksa inbox atau folder spam Anda.`,
      });
    } catch (error) {
      setPasswordResetMessage({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Gagal mengirim email reset password. Silakan hubungi administrator.',
      });
    } finally {
      setPasswordResetLoading(false);
    }
  };

  if (!currentProfile || !supportsEmployeeNavigation(currentProfile)) {
    return null;
  }

  const isSatpam =
    currentProfile.role === 'ketua_shift_satpam' ||
    currentProfile.permittedCategories?.some(
      (category) => category.trim().toUpperCase() === 'SATPAM',
    );
  const isSopir = currentProfile.permittedCategories?.some(
    (category) => category.trim().toUpperCase() === 'SOPIR',
  );
  const leaveHref = '/employee/leave';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              className="text-slate-600 hover:text-indigo-650 hover:bg-slate-50 border border-slate-200 bg-white rounded-xl h-9 w-9 flex items-center justify-center shadow-sm cursor-pointer shrink-0"
              title="Menu"
              aria-label="Buka menu navigasi"
            />
          }
        >
          <MenuIcon className="w-4.5 h-4.5 text-indigo-500" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem render={<Link href="/employee/activities" />}>
            <ClipboardList className="text-indigo-500" />
            Laporan Kegiatan
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/employee/payslip" />}>
            <Banknote className="text-emerald-500" />
            Slip Gaji
          </DropdownMenuItem>
          {isSopir && (
            <DropdownMenuItem render={<Link href="/employee/driver-history" />}>
              <Compass className="text-indigo-500" />
              Riwayat Perjalanan
            </DropdownMenuItem>
          )}
          {currentProfile.role === 'ketua_shift_satpam' && (
            <DropdownMenuItem render={<Link href="/employee/satpam-duty-plan" />}>
              <CalendarDays className="text-indigo-500" />
              Jadwal Regu
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href={leaveHref} />}>
            {isSatpam ? (
              <ShieldCheck className="text-amber-500" />
            ) : (
              <CalendarCheck className="text-indigo-500" />
            )}
            Ajukan Izin
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => void handlePasswordReset()}
            disabled={passwordResetLoading}
          >
            {passwordResetLoading ? (
              <Loader2 className="animate-spin text-indigo-500" />
            ) : (
              <KeyRound className="text-indigo-500" />
            )}
            Ubah Password
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FloatingSnackbar
        message={passwordResetMessage}
        onDismiss={() => setPasswordResetMessage(null)}
        title={
          passwordResetMessage?.type === 'error'
            ? 'Gagal Mengirim Email'
            : passwordResetMessage
              ? 'Email Terkirim'
              : undefined
        }
      />
    </>
  );
}
