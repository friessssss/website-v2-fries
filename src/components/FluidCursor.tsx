'use client';

import clsx from 'clsx';
import { useEffect, useRef } from 'react';

type FluidCursorProps = {
  className?: string;
};

export default function FluidCursor({ className }: FluidCursorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cleanup: (() => void) | void;
    const handleResize = () => {
      if (!canvasRef.current) return;
      const { offsetWidth, offsetHeight } = canvasRef.current;
      const dpr = window.devicePixelRatio || 1;
      canvasRef.current.width = Math.max(1, Math.floor(offsetWidth * dpr));
      canvasRef.current.height = Math.max(1, Math.floor(offsetHeight * dpr));
    };

    const init = async () => {
      handleResize();
      const { default: WebGLFluid } = await import('webgl-fluid');
      cleanup = WebGLFluid(canvas, {
        TRIGGER: 'hover',
        IMMEDIATE: false,
        AUTO: false,
        TRANSPARENT: true,
        SIM_RESOLUTION: 192,
        DYE_RESOLUTION: 1440,
        CAPTURE_RESOLUTION: 512,
        DENSITY_DISSIPATION: 2,
        VELOCITY_DISSIPATION: 1,
        PRESSURE: 0.2,
        PRESSURE_ITERATIONS: 20,
        CURL: 5,
        SPLAT_RADIUS: 0.16,
        SPLAT_FORCE: 1800,
        SPLAT_COUNT: 6,
        SHADING: true,
        COLORFUL: true,
        COLOR_UPDATE_SPEED: 4,
        BLOOM: false,
        SUNRAYS: false,
        BACK_COLOR: { r: 0, g: 0, b: 0 },
      });
    };

    init();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cleanup?.();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={clsx('absolute inset-0 h-full w-full pointer-events-auto z-5 opacity-70', className)}
      style={{ mixBlendMode: 'screen' }}
    />
  );
}

