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
    // Detect Safari - it handles smooth scrolling better
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isChrome = !isSafari && !isTouchDevice;
    
    // Disable smooth scrolling on Chrome and mobile for better performance
    const shouldSmoothScroll = isSafari && !isTouchDevice;
    
    const lenisInstance = new Lenis({
      duration: shouldSmoothScroll ? 1.25 : 1.0,
      smoothWheel: shouldSmoothScroll, // Disable on Chrome and mobile
      touchMultiplier: isTouchDevice ? 2.5 : 2,
      easing: (t) => Math.min(1, 1 - Math.pow(1 - t, 3)),
      wheelMultiplier: 1,
      infinite: false,
      orientation: 'vertical',
      lerp: shouldSmoothScroll ? 0.05 : 0.1, // Higher lerp when smooth scrolling is disabled
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

