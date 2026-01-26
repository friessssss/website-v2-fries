'use client';

import { useEffect, useRef } from 'react';

const GLYPHS = [' ', '.', ':', '-', '+', '*', '#', 'D'];

export default function AsciiDitherBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let columns = 0;
    let rows = 0;
    let glyphSize = 14;
    let animationFrame = 0;

    const updateSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      glyphSize = width < 640 ? 12 : 14;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.font = `${glyphSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
      context.textBaseline = 'top';

      columns = Math.ceil(width / glyphSize);
      rows = Math.ceil(height / glyphSize);
    };

    const render = (time: number) => {
      const t = time * 0.00035;
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(62, 62, 62, 0.6)';

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const wave =
            Math.sin(x * 0.35 + t * 1.7) +
            Math.cos(y * 0.25 - t * 1.4) +
            Math.sin((x + y) * 0.08 + t * 2.1);
          const normalized = (wave + 3) / 6;
          const glyphIndex = Math.min(
            GLYPHS.length - 1,
            Math.floor(normalized * GLYPHS.length),
          );
          const glyph = GLYPHS[glyphIndex];
          if (glyph !== ' ') {
            context.fillText(glyph, x * glyphSize, y * glyphSize);
          }
        }
      }

      animationFrame = requestAnimationFrame(render);
    };

    updateSize();
    animationFrame = requestAnimationFrame(render);
    window.addEventListener('resize', updateSize);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 h-full w-full opacity-70 mix-blend-screen"
      aria-hidden="true"
    />
  );
}

