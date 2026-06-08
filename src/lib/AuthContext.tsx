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
import { doc, getDoc } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  email: string;
  role: 'super_admin' | 'satker_head' | 'employee_admin' | 'honorer';
  permittedCategories: string[];
  displayName?: string;
  linkedEmployeeId?: string;
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
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { uid, ...docSnap.data() } as UserProfile;
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
          if (prof) {
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
    if (!prof) {
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
    if (!prof) {
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

