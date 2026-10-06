"use client";

import { useMemo } from 'react';
import { ArrowLeftRight, Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserRoleLabel } from '@/lib/payroll/roles';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';

/**
 * "Ganti Peran": lets a person who holds several accounts (one per role, same
 * Nama Lengkap) move between them without logging out. Which accounts belong
 * together is `@/lib/accountGroups`; the switch itself is `switchAccount` in
 * AuthContext. Renders nothing for someone with a single account, and during a
 * Super Admin preview or impersonation.
 */

function useCanSwitchAccounts(): boolean {
  const { profile, linkedAccounts, isImpersonatingUi, isCustomTokenImpersonating } = useAuth();
  return !!profile && linkedAccounts.length > 0 && !isImpersonatingUi && !isCustomTokenImpersonating;
}

function AccountLine({ role, email }: { role: unknown; email: string }) {
  return (
    <span className="flex min-w-0 flex-col text-left">
      <span className="truncate">{getUserRoleLabel(role)}</span>
      <span className="truncate text-[11px] font-normal text-slate-500">{email}</span>
    </span>
  );
}

/**
 * The person's accounts as menu entries: the current one marked, the others
 * switchable. For use inside an existing DropdownMenuContent; `separatorBefore`
 * adds a divider above, only when there is something to show.
 */
export function AccountSwitchMenuItems({ separatorBefore = false }: { separatorBefore?: boolean }) {
  const canSwitch = useCanSwitchAccounts();
  const { profile, linkedAccounts, switchingAccount, switchAccount } = useAuth();
  if (!canSwitch || !profile) return null;

  return (
    <>
      {separatorBefore && <DropdownMenuSeparator />}
      <DropdownMenuGroup>
        <DropdownMenuLabel>Ganti peran</DropdownMenuLabel>
        <div
          aria-current="true"
          className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-800"
        >
          <Check className="size-4 shrink-0 text-emerald-500" aria-label="Akun saat ini" />
          <AccountLine role={profile.role} email={profile.email} />
        </div>
        {linkedAccounts.map((account) => (
          <DropdownMenuItem
            key={account.uid}
            disabled={!!switchingAccount}
            onClick={() => void switchAccount(account.uid)}
            className="min-h-11"
          >
            {switchingAccount?.uid === account.uid ? (
              <Loader2 className="animate-spin text-indigo-500" />
            ) : (
              <ArrowLeftRight className="text-indigo-500" />
            )}
            <AccountLine role={account.role} email={account.email} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </>
  );
}

interface AccountSwitcherProps {
  /** Classes for the trigger button, to match the bar it sits in. */
  className?: string;
  /**
   * The "Ganti Peran" text beside the icon: always, from the `sm` breakpoint up
   * (like the "Keluar" buttons it sits next to), or never.
   */
  label?: 'always' | 'responsive' | 'none';
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}

/** A "Ganti Peran" button that opens the person's accounts. */
export default function AccountSwitcher({
  className,
  label = 'responsive',
  side = 'bottom',
  align = 'end',
}: AccountSwitcherProps) {
  const canSwitch = useCanSwitchAccounts();
  const { switchingAccount } = useAuth();
  if (!canSwitch) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size={label === 'none' ? 'icon' : 'sm'}
            className={cn('cursor-pointer gap-1.5 font-semibold', className)}
            title="Ganti peran"
            aria-label="Ganti peran"
          />
        }
      >
        {switchingAccount ? (
          <Loader2 className="animate-spin text-indigo-500" />
        ) : (
          <ArrowLeftRight className="text-indigo-500" />
        )}
        {label !== 'none' && (
          <span className={label === 'responsive' ? 'hidden sm:inline' : undefined}>
            Ganti Peran
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="min-w-[260px] p-2">
        <AccountSwitchMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Mounted once in the root layout: covers the page while the browser signs in
 * to the other account (the page then reloads into it), and reports a switch
 * that failed. Lives outside the menus because they close on click.
 */
export function AccountSwitchStatus() {
  const { switchingAccount, accountSwitchError, clearAccountSwitchError } = useAuth();
  const errorMessage = useMemo<SnackbarMessage | null>(
    () => (accountSwitchError ? { type: 'error', text: accountSwitchError } : null),
    [accountSwitchError],
  );

  return (
    <>
      {switchingAccount && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-white/80 px-4 backdrop-blur-sm"
        >
          <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-xl ring-1 ring-slate-200">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-indigo-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">
                Membuka akun {getUserRoleLabel(switchingAccount.role)}…
              </p>
              <p className="truncate text-xs text-slate-500">{switchingAccount.email}</p>
            </div>
          </div>
        </div>
      )}
      <FloatingSnackbar
        message={errorMessage}
        onDismiss={clearAccountSwitchError}
        title="Gagal Berganti Peran"
      />
    </>
  );
}
