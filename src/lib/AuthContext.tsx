"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCustomToken,
  GoogleAuthProvider,
  signOut,
  User,
} from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDocFromServer } from 'firebase/firestore';
import { normalizeUserRole, UserRole } from '@/lib/payroll/roles';
import { getRoleHomePath } from '@/lib/roleHome';
import type { LinkedAccountSummary } from '@/lib/accountGroups';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  permittedCategories: string[];
  displayName?: string;
  satkerName?: string;
  /** Kepala SatKer Loyalis: the SatKer code used in Surat Keluar numbers. */
  satkerInitials?: string;
  linkedEmployeeId?: string;
  disabled?: boolean;
  phoneNumber?: string;
  phone?: string;
}

export interface ImpersonationSession {
  sessionId: string;
  restoreSecret: string;
  targetEmail: string;
  targetDisplayName?: string;
  targetRole?: UserRole;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  activeProfile: UserProfile | null;
  realProfile: UserProfile | null;
  loading: boolean;
  isImpersonatingUi: boolean;
  uiPreviewHydrated: boolean;
  uiPreviewRevision: number;
  isCustomTokenImpersonating: boolean;
  impersonationSessionInfo: ImpersonationSession | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  startUiImpersonation: (targetUser: UserProfile) => Promise<UserProfile | null>;
  stopUiImpersonation: () => void;
  startCustomTokenImpersonation: (targetUid: string) => Promise<void>;
  stopCustomTokenImpersonation: () => Promise<void>;
  /** The signed-in person's other accounts ("Ganti Peran"); empty when there are none. */
  linkedAccounts: LinkedAccountSummary[];
  /** The account being switched to, until the page reloads into it. */
  switchingAccount: LinkedAccountSummary | null;
  accountSwitchError: string | null;
  switchAccount: (targetUid: string) => Promise<void>;
  clearAccountSwitchError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const UI_IMPERSONATION_KEY = 'bak_ui_impersonated_user';
const CUSTOM_TOKEN_SESSION_KEY = 'bak_custom_token_session';

// Thrown when the user's profile document could not be determined due to a
// transient issue (network/timeout/offline), as opposed to a confirmed absence.
// Callers must NOT treat this the same as "no profile" (e.g. must not sign the user out).
class ProfileFetchError extends Error {
  readonly code = 'auth/profile-unavailable';

  constructor() {
    super('PROFILE_FETCH_FAILED');
    this.name = 'ProfileFetchError';
  }
}

const PROFILE_SERVER_TIMEOUT_MS = 15_000;
const PROFILE_RETRY_DELAY_MS = 500;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new ProfileFetchError()), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const docRef = doc(db, 'users', uid);
  const deadline = Date.now() + PROFILE_SERVER_TIMEOUT_MS;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // A cold Firestore connection can take longer than three seconds. Keep
      // that request alive; cached roles/disabled flags cannot decide a login.
      const docSnap = await withTimeout(
        getDocFromServer(docRef),
        Math.max(1, deadline - Date.now()),
      );
      if (docSnap.exists()) {
        const data = docSnap.data();
        const role = normalizeUserRole(data.role);
        return role ? ({ ...data, uid, role } as UserProfile) : null;
      }
      return null;
    } catch (err) {
      const code = typeof err === 'object' && err !== null && 'code' in err
        ? String(err.code).replace(/^firestore\//, '')
        : '';
      const retryable = [
        'unavailable', 'deadline-exceeded', 'aborted', 'internal', 'unknown',
        // Firestore may still be replacing the anonymous/previous credential
        // when Firebase Auth first announces a new session. Retry once; a
        // persistent denial still grants no access and never means "missing".
        'unauthenticated', 'permission-denied',
      ].includes(code);
      if (!retryable || attempt === 1 || Date.now() + PROFILE_RETRY_DELAY_MS >= deadline) {
        // In particular, permission-denied is not proof that a profile is
        // absent. A failed read must never be converted into a forced logout.
        throw new ProfileFetchError();
      }
      await new Promise(resolve => setTimeout(resolve, PROFILE_RETRY_DELAY_MS));
    }
  }
  throw new ProfileFetchError();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [impersonatedUiProfile, setImpersonatedUiProfile] = useState<UserProfile | null>(null);
  const [uiPreviewHydrated, setUiPreviewHydrated] = useState(false);
  const [uiPreviewRevision, setUiPreviewRevision] = useState(0);
  const [impersonationSessionInfo, setImpersonationSessionInfo] = useState<ImpersonationSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedLinkedAccounts, setLoadedLinkedAccounts] = useState<{
    uid: string;
    accounts: LinkedAccountSummary[];
  } | null>(null);
  const [switchingAccount, setSwitchingAccount] = useState<LinkedAccountSummary | null>(null);
  const [accountSwitchError, setAccountSwitchError] = useState<string | null>(null);
  const authCallIdRef = useRef(0);
  const profileRequestRef = useRef<{ user: User; callId: number; promise: Promise<void> } | null>(null);
  const invalidateProfileRequest = useCallback(() => {
    ++authCallIdRef.current;
    profileRequestRef.current = null;
  }, []);

  const loadAuthenticatedUser = useCallback((firebaseUser: User): Promise<void> => {
    // The observer and the sign-in promise describe the same Firebase session.
    // Give them one verification/settlement, rather than two competing reads.
    if (profileRequestRef.current?.user === firebaseUser) {
      return profileRequestRef.current.promise;
    }
    const callId = ++authCallIdRef.current;
    const isCurrent = () => callId === authCallIdRef.current && auth.currentUser === firebaseUser;
    setLoading(true);
    setUser(null);
    setProfile(null);

    const promise = (async () => {
      try {
        const prof = await getUserProfile(firebaseUser.uid);
        if (!isCurrent()) {
          throw Object.assign(new Error('Sesi telah berubah.'), { code: 'auth/session-changed' });
        }
        if (!prof || prof.disabled === true) {
          await signOut(auth);
          throw Object.assign(new Error('Profil pengguna tidak aktif atau belum terdaftar.'), {
            code: prof?.disabled === true ? 'auth/user-disabled' : 'auth/profile-not-found',
          });
        }
        setUser(firebaseUser);
        setProfile(prof);
      } finally {
        if (callId === authCallIdRef.current) setLoading(false);
        if (profileRequestRef.current?.callId === callId) profileRequestRef.current = null;
      }
    })();
    profileRequestRef.current = { user: firebaseUser, callId, promise };
    return promise;
  }, []);

  // Restore stored impersonation state on mount
  useEffect(() => {
    try {
      const storedUiUser = sessionStorage.getItem(UI_IMPERSONATION_KEY);
      if (storedUiUser) {
        const storedProfile = JSON.parse(storedUiUser);
        setImpersonatedUiProfile({
          ...storedProfile,
          role: normalizeUserRole(storedProfile?.role) ?? storedProfile?.role,
        });
        setUiPreviewRevision((revision) => revision + 1);
      }
      const storedSession = localStorage.getItem(CUSTOM_TOKEN_SESSION_KEY);
      if (storedSession) {
        setImpersonationSessionInfo(JSON.parse(storedSession));
      }
    } catch (e) {
      console.warn('Failed to parse stored impersonation state:', e);
    } finally {
      setUiPreviewHydrated(true);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (auth.currentUser !== firebaseUser) return;
      if (firebaseUser) {
        void loadAuthenticatedUser(firebaseUser).catch((err) => {
          if (auth.currentUser === firebaseUser) {
            console.warn('Unable to verify the signed-in user profile:', err);
          }
        });
      } else {
        invalidateProfileRequest();
        setUser(null);
        setProfile(null);
        setImpersonatedUiProfile(null);
        sessionStorage.removeItem(UI_IMPERSONATION_KEY);
        setLoading(false);
      }
    });
    return () => {
      unsubscribe();
      invalidateProfileRequest();
    };
  }, [loadAuthenticatedUser, invalidateProfileRequest]);

  const isSuperAdmin = profile?.role === 'super_admin';
  const isImpersonatingUi = isSuperAdmin && !!impersonatedUiProfile;
  const isCustomTokenImpersonating = !!impersonationSessionInfo;

  const activeProfile = isImpersonatingUi ? impersonatedUiProfile : profile;

  // The person's other accounts, loaded once per signed-in account. Super Admin
  // is never grouped, and a Super Admin impersonation session may not switch,
  // so neither asks. The list is only for showing the menu: the server checks
  // the link again on every switch.
  const signedInUid = user?.uid ?? null;
  const signedInRole = profile?.role ?? null;
  const signedInName = profile?.displayName ?? null;
  const mayLoadLinkedAccounts =
    !!signedInUid &&
    !!signedInRole &&
    signedInRole !== 'super_admin' &&
    uiPreviewHydrated &&
    !isCustomTokenImpersonating;

  useEffect(() => {
    if (!mayLoadLinkedAccounts || !signedInUid) return;
    let cancelled = false;
    (async () => {
      try {
        const currentUser = auth.currentUser;
        if (!currentUser || currentUser.uid !== signedInUid) return;
        const token = await currentUser.getIdToken();
        const res = await fetch('/api/auth/linked-accounts', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.accounts)) {
          setLoadedLinkedAccounts({ uid: signedInUid, accounts: data.accounts });
        }
      } catch (error) {
        console.warn('Unable to load linked accounts:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // signedInRole and signedInName are listed so a renamed or re-roled account
    // reloads its list.
  }, [mayLoadLinkedAccounts, signedInUid, signedInRole, signedInName]);

  const linkedAccounts =
    mayLoadLinkedAccounts && loadedLinkedAccounts?.uid === signedInUid
      ? loadedLinkedAccounts.accounts
      : [];

  const switchAccount = async (targetUid: string) => {
    const target = linkedAccounts.find((account) => account.uid === targetUid);
    const currentUser = auth.currentUser;
    if (!target || !currentUser || switchingAccount) return;

    setAccountSwitchError(null);
    setSwitchingAccount(target);
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/auth/switch-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetUid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.customToken !== 'string') {
        throw new Error(data.error || 'Gagal berpindah akun.');
      }

      await signInWithCustomToken(auth, data.customToken);
      // A full page load, as after an impersonation, so caches filled for the
      // previous role start empty and the route guard only sees the new one.
      window.location.href = getRoleHomePath(data.targetProfile ?? target);
    } catch (err) {
      setSwitchingAccount(null);
      const code =
        typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
      setAccountSwitchError(
        code === 'auth/user-disabled'
          ? 'Akun tujuan telah dinonaktifkan.'
          : err instanceof Error
            ? err.message
            : 'Gagal berpindah akun.',
      );
    }
  };

  const clearAccountSwitchError = () => setAccountSwitchError(null);

  const startUiImpersonation = async (targetUser: UserProfile) => {
    const targetRole = normalizeUserRole(targetUser.role);
    if (!isSuperAdmin || !targetRole) return null;

    // The users page normally passes a fresh API result, but refresh the
    // profile at the hand-off as well. This prevents a previously loaded user
    // row or sessionStorage snapshot from carrying an old role/linkage into
    // the preview.
    let latestTarget: UserProfile = { ...targetUser, role: targetRole };
    try {
      const targetSnapshot = await getDocFromServer(doc(db, 'users', targetUser.uid));
      if (targetSnapshot.exists()) {
        const targetData = targetSnapshot.data();
        const latestRole = normalizeUserRole(targetData.role);
        if (!latestRole) return null;
        latestTarget = {
          ...targetUser,
          ...targetData,
          role: latestRole,
          uid: targetUser.uid,
        } as UserProfile;
      }
    } catch (error) {
      console.warn('Unable to refresh target profile before UI preview; using the selected row:', error);
    }

    setImpersonatedUiProfile(latestTarget);
    sessionStorage.setItem(UI_IMPERSONATION_KEY, JSON.stringify(latestTarget));
    setUiPreviewRevision((revision) => revision + 1);
    return latestTarget;
  };

  const stopUiImpersonation = () => {
    setImpersonatedUiProfile(null);
    sessionStorage.removeItem(UI_IMPERSONATION_KEY);
    setUiPreviewRevision((revision) => revision + 1);
  };

  const startCustomTokenImpersonation = async (targetUid: string) => {
    if (!profile || profile.role !== 'super_admin' || !user) {
      throw new Error('Hanya Super Admin yang diizinkan meng-impersonasi sesi.');
    }

    const token = await user.getIdToken();
    const res = await fetch('/api/admin/impersonate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetUid }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Gagal memulai sesi impersonasi.');
    }

    const sessionInfo: ImpersonationSession = {
      sessionId: data.sessionId,
      restoreSecret: data.restoreSecret,
      targetEmail: data.targetProfile.email,
      targetDisplayName: data.targetProfile.displayName,
      targetRole: data.targetProfile.role,
    };

    localStorage.setItem(CUSTOM_TOKEN_SESSION_KEY, JSON.stringify(sessionInfo));
    setImpersonationSessionInfo(sessionInfo);

    try {
      // Sign in as target user via Custom Token
      await signInWithCustomToken(auth, data.customToken);

      // Redirect target user to their appropriate role home page
      window.location.href = getRoleHomePath(data.targetProfile);
    } catch (err) {
      localStorage.removeItem(CUSTOM_TOKEN_SESSION_KEY);
      setImpersonationSessionInfo(null);
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'auth/user-disabled') {
        throw new Error('Akun ini telah dinonaktifkan (Disabled) dalam sistem Firebase Authentication.');
      }
      throw err;
    }
  };

  const stopCustomTokenImpersonation = async () => {
    if (!impersonationSessionInfo) return;

    try {
      const res = await fetch('/api/admin/restore-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: impersonationSessionInfo.sessionId,
          restoreSecret: impersonationSessionInfo.restoreSecret,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memulihkan sesi Super Admin.');
      }

      localStorage.removeItem(CUSTOM_TOKEN_SESSION_KEY);
      setImpersonationSessionInfo(null);

      // Sign back into Super Admin via restored custom token
      await signInWithCustomToken(auth, data.customToken);

      // Redirect Super Admin back to /dashboard/users
      window.location.href = '/dashboard/users';
    } catch (err) {
      console.error('Error restoring Super Admin session:', err);
      localStorage.removeItem(CUSTOM_TOKEN_SESSION_KEY);
      setImpersonationSessionInfo(null);
      await signOut(auth);
      window.location.href = '/login';
      throw err;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    await loadAuthenticatedUser(credential.user);
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const credential = await signInWithPopup(auth, provider);
    await loadAuthenticatedUser(credential.user);
  };

  const logout = async () => {
    invalidateProfileRequest();
    setImpersonatedUiProfile(null);
    setImpersonationSessionInfo(null);
    sessionStorage.removeItem(UI_IMPERSONATION_KEY);
    localStorage.removeItem(CUSTOM_TOKEN_SESSION_KEY);
    await signOut(auth);
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        activeProfile,
        realProfile: profile,
        loading,
        isImpersonatingUi,
        uiPreviewHydrated,
        uiPreviewRevision,
        isCustomTokenImpersonating,
        impersonationSessionInfo,
        signInWithEmail,
        signInWithGoogle,
        logout,
        startUiImpersonation,
        stopUiImpersonation,
        startCustomTokenImpersonation,
        stopCustomTokenImpersonation,
        linkedAccounts,
        switchingAccount,
        accountSwitchError,
        switchAccount,
        clearAccountSwitchError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
