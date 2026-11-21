'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export function useMountedRef(): RefObject<boolean> {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}
