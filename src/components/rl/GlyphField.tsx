'use client';

import { useEffect, useRef } from 'react';
import { RAMP } from './ascii';

export default function GlyphField() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let size = 14;
    let cols = 0;
    let rows = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      size = w < 640 ? 12 : 14;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textBaseline = 'top';
      cols = Math.ceil(w / size);
      rows = Math.ceil(h / size);
      draw(performance.now());
    };

    const draw = (time: number) => {
      const t = reduced ? 0 : time * 0.00025;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(62, 62, 62, 0.55)';
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const wave =
            Math.sin(x * 0.35 + t * 1.7) + Math.cos(y * 0.25 - t * 1.4) + Math.sin((x + y) * 0.08 + t * 2.1);
          const g = RAMP[Math.min(RAMP.length - 1, Math.floor(((wave + 3) / 6) * RAMP.length))];
          if (g !== ' ') ctx.fillText(g, x * size, y * size);
        }
      }
    };

    const loop = (time: number) => {
      draw(time);
      raf = requestAnimationFrame(loop);
    };

    resize();
    if (!reduced) raf = requestAnimationFrame(loop);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 opacity-70" />;
}
