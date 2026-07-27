"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
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
import { doc, getDocFromCache, getDocFromServer } from 'firebase/firestore';
import { UserRole } from '@/lib/payroll/roles';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  permittedCategories: string[];
  displayName?: string;
  linkedEmployeeId?: string;
  disabled?: boolean;
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
  isCustomTokenImpersonating: boolean;
  impersonationSessionInfo: ImpersonationSession | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  startUiImpersonation: (targetUser: UserProfile) => void;
  stopUiImpersonation: () => void;
  startCustomTokenImpersonation: (targetUid: string) => Promise<void>;
  stopCustomTokenImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const UI_IMPERSONATION_KEY = 'bak_ui_impersonated_user';
const CUSTOM_TOKEN_SESSION_KEY = 'bak_custom_token_session';

async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const docRef = doc(db, 'users', uid);

  try {
    const serverPromise = getDocFromServer(docRef);
    
    // Race server getDoc against a 3-second timeout to prevent infinite loading state
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 3000)
    );

    const docSnap = await Promise.race([
      serverPromise,
      timeoutPromise
    ]);

    if (docSnap) {
      if (docSnap.exists()) {
        return { uid, ...docSnap.data() } as UserProfile;
      }
      return null;
    }

    // Server request timed out. Fall back to local cache if available.
    console.warn("getUserProfile server request timed out. Trying cache fallback...");
    try {
      const cacheSnap = await getDocFromCache(docRef);
      if (cacheSnap.exists()) {
        return { uid, ...cacheSnap.data() } as UserProfile;
      }
    } catch (cacheErr) {
      console.warn("Cache fallback failed (no cached document). Waiting for server instead...", cacheErr);
    }

    // If cache fallback failed or document wasn't cached, wait for the server response to complete
    const finalSnap = await serverPromise;
    if (finalSnap.exists()) {
      return { uid, ...finalSnap.data() } as UserProfile;
    }
    return null;
  } catch (err) {
    console.error("Error fetching user profile:", err);
    const errorCode =
      typeof err === 'object' && err !== null && 'code' in err
        ? String(err.code)
        : '';
    if (errorCode === 'permission-denied' || errorCode === 'firestore/permission-denied') {
      return null;
    }
    try {
      const cacheSnap = await getDocFromCache(docRef);
      if (cacheSnap.exists()) {
        return { uid, ...cacheSnap.data() } as UserProfile;
      }
    } catch (cacheErr) {
      console.error("Cache fallback after error failed:", cacheErr);
    }
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [impersonatedUiProfile, setImpersonatedUiProfile] = useState<UserProfile | null>(null);
  const [impersonationSessionInfo, setImpersonationSessionInfo] = useState<ImpersonationSession | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore stored impersonation state on mount
  useEffect(() => {
    try {
      const storedUiUser = sessionStorage.getItem(UI_IMPERSONATION_KEY);
      if (storedUiUser) {
        setImpersonatedUiProfile(JSON.parse(storedUiUser));
      }
      const storedSession = localStorage.getItem(CUSTOM_TOKEN_SESSION_KEY);
      if (storedSession) {
        setImpersonationSessionInfo(JSON.parse(storedSession));
      }
    } catch (e) {
      console.warn('Failed to parse stored impersonation state:', e);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const prof = await getUserProfile(firebaseUser.uid);
          if (prof && prof.disabled !== true) {
            setUser(firebaseUser);
            setProfile(prof);
          } else {
            await signOut(auth);
            setUser(null);
            setProfile(null);
          }
        } catch (err) {
          console.error("Error loading user profile on auth state change:", err);
          await signOut(auth);
          setUser(null);
          setProfile(null);
        }
      } else {
        setUser(null);
        setProfile(null);
        setImpersonatedUiProfile(null);
        sessionStorage.removeItem(UI_IMPERSONATION_KEY);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const isSuperAdmin = profile?.role === 'super_admin';
  const isImpersonatingUi = isSuperAdmin && !!impersonatedUiProfile;
  const isCustomTokenImpersonating = !!impersonationSessionInfo;

  const activeProfile = isImpersonatingUi ? impersonatedUiProfile : profile;

  const startUiImpersonation = (targetUser: UserProfile) => {
    if (!isSuperAdmin) return;
    setImpersonatedUiProfile(targetUser);
    sessionStorage.setItem(UI_IMPERSONATION_KEY, JSON.stringify(targetUser));
  };

  const stopUiImpersonation = () => {
    setImpersonatedUiProfile(null);
    sessionStorage.removeItem(UI_IMPERSONATION_KEY);
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
      const roleStr = data.targetProfile.role;
      if (roleStr === 'honorer' || roleStr === 'ketua_shift_satpam') {
        window.location.href = '/employee/activities';
      } else if (roleStr === 'loyalis') {
        window.location.href = '/employee/payslip';
      } else if (roleStr === 'satker_head') {
        window.location.href = '/dashboard/payroll/activity-review';
      } else if (roleStr === 'satker_head_loyalis') {
        window.location.href = '/dashboard/payroll/uraian';
      } else if (roleStr === 'employee_admin') {
        window.location.href = '/dashboard/employees';
      } else if (roleStr === 'loyalis_presence_admin') {
        window.location.href = '/dashboard/payroll/uraian/presensi-loyalis-raw';
      } else {
        window.location.href = '/dashboard/payroll';
      }
    } catch (err: any) {
      localStorage.removeItem(CUSTOM_TOKEN_SESSION_KEY);
      setImpersonationSessionInfo(null);
      if (err?.code === 'auth/user-disabled') {
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
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const firebaseUser = credential.user;
    const prof = await getUserProfile(firebaseUser.uid);
    if (!prof || prof.disabled === true) {
      await signOut(auth);
      throw new Error('Akun Anda belum terdaftar dalam sistem. Silakan hubungi administrator Badan Administrasi Keuangan (BAK).');
    }
    setUser(firebaseUser);
    setProfile(prof);
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const credential = await signInWithPopup(auth, provider);
    const firebaseUser = credential.user;
    const prof = await getUserProfile(firebaseUser.uid);
    if (!prof || prof.disabled === true) {
      await signOut(auth);
      throw new Error('Akun Anda belum terdaftar dalam sistem. Silakan hubungi administrator Badan Administrasi Keuangan (BAK).');
    }
    setUser(firebaseUser);
    setProfile(prof);
  };

  const logout = async () => {
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
        isCustomTokenImpersonating,
        impersonationSessionInfo,
        signInWithEmail,
        signInWithGoogle,
        logout,
        startUiImpersonation,
        stopUiImpersonation,
        startCustomTokenImpersonation,
        stopCustomTokenImpersonation,
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

