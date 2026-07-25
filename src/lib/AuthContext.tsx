"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
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

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

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
    // A permission failure cannot be repaired by reading the same protected
    // document from cache. Avoid a second misleading Firebase error and fail
    // closed so a stale privileged profile is never accepted.
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
  const [loading, setLoading] = useState(true);

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
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
    await signOut(auth);
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signInWithEmail, signInWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
