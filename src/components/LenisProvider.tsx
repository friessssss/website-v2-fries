'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Lenis from 'lenis';

type LenisContextValue = {
  instance: Lenis | null;
};

const LenisContext = createContext<LenisContextValue>({ instance: null });

type LenisProviderProps = {
  children: React.ReactNode;
};

export function LenisProvider({ children }: LenisProviderProps) {
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const frameRef = useRef<number>();

  useEffect(() => {
    const lenisInstance = new Lenis({
      duration: 1.25,
      smoothWheel: true,
      smoothTouch: false,
      easing: (t) => Math.min(1, 1 - Math.pow(1 - t, 3)),
    });

    setLenis(lenisInstance);

    const raf = (time: number) => {
      lenisInstance.raf(time);
      frameRef.current = requestAnimationFrame(raf);
    };

    frameRef.current = requestAnimationFrame(raf);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      lenisInstance.destroy();
      setLenis(null);
    };
  }, []);

  const value = useMemo(
    () => ({
      instance: lenis,
    }),
    [lenis],
  );

  return <LenisContext.Provider value={value}>{children}</LenisContext.Provider>;
}

export function useLenisScroll() {
  const context = useContext(LenisContext);
  return context.instance;
}

