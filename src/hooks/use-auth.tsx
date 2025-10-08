'use client';

import { auth } from '@/lib/firebase';
import {
  User,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AuthCredential } from 'firebase/auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signUp: typeof createUserWithEmailAndPassword;
  signIn: typeof signInWithEmailAndPassword;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const logout = () => signOut(auth);

  const value = {
    user,
    loading,
    signUp: createUserWithEmailAndPassword,
    signIn: signInWithEmailAndPassword,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
