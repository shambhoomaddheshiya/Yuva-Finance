'use client';

import { createContext, useContext, ReactNode, useMemo } from 'react';
import { useUser } from '@/firebase';

type AdminContextType = {
  isAdmin: boolean;
};

const AdminContext = createContext<AdminContextType>({ isAdmin: false });

export const AdminProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useUser();
  const isAdmin = useMemo(() => user?.email === 'shambhoo.in@zohomail.in', [user]);

  return <AdminContext.Provider value={{ isAdmin }}>{children}</AdminContext.Provider>;
};

export const useAdmin = () => useContext(AdminContext);
