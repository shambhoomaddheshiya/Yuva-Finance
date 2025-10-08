'use client';

import { db } from '@/lib/firebase';
import { onValue, ref } from 'firebase/database';
import { useEffect, useState } from 'react';

export function useRealtimeData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const dbRef = ref(db, path);
    const unsubscribe = onValue(
      dbRef,
      (snapshot) => {
        setData(snapshot.val() as T);
        setLoading(false);
      },
      (error) => {
        setError(error);
        setLoading(false);
        console.error('Firebase read failed: ', error);
      }
    );

    return () => unsubscribe();
  }, [path]);

  return { data, loading, error };
}
