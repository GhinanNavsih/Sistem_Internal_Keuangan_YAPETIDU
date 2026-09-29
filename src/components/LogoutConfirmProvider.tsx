"use client";

import { createContext, useCallback, useContext, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAuth } from "@/lib/AuthContext";

const RequestLogoutContext = createContext<(() => void) | null>(null);

/**
 * Mounts the one "Keluar dari akun?" dialog for the whole app. Every Keluar
 * button asks it through `useConfirmLogout()` instead of calling `logout()`,
 * so signing out is never a single stray tap. Code that signs a user out for
 * its own reasons (an expired session, a redirect) keeps calling `logout()`.
 */
export function LogoutConfirmProvider({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const requestLogout = useCallback(() => setOpen(true), []);

  const confirmLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      setOpen(false);
    }
  };

  return (
    <RequestLogoutContext.Provider value={requestLogout}>
      {children}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Keluar dari akun?"
        description="Anda akan keluar dan perlu masuk lagi untuk melanjutkan."
        confirmLabel="Keluar"
        loading={loggingOut}
        onConfirm={confirmLogout}
      />
    </RequestLogoutContext.Provider>
  );
}

/** Returns a function that opens the logout confirmation. Use it for Keluar buttons. */
export function useConfirmLogout(): () => void {
  const requestLogout = useContext(RequestLogoutContext);
  if (!requestLogout) {
    throw new Error("useConfirmLogout must be used inside <LogoutConfirmProvider>.");
  }
  return requestLogout;
}
