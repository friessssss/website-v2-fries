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
    // Detect if device is mobile/touch
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    const lenisInstance = new Lenis({
      duration: isTouchDevice ? 1.0 : 1.25, // Faster on mobile for better responsiveness
      smoothWheel: true,
      smoothTouch: true, // Enable smooth scrolling on touch devices
      touchMultiplier: isTouchDevice ? 2.5 : 2, // Higher multiplier for mobile
      easing: (t) => Math.min(1, 1 - Math.pow(1 - t, 3)),
      wheelMultiplier: 1,
      infinite: false,
      // Ensure Lenis doesn't block native touch events
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      // Better mobile support
      lerp: isTouchDevice ? 0.1 : 0.05, // Slightly higher lerp on mobile for smoother feel
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

