'use client';

import { useEffect, useRef } from 'react';

const GLYPHS = [' ', '.', ':', '-', '+', '*', '#', 'D'];
const FLUID_GLYPHS = [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const idx = (x: number, y: number, w: number) => y * w + x;

const sampleBilinear = (
  field: Float32Array,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  const x0 = clamp(Math.floor(x), 0, w - 1);
  const y0 = clamp(Math.floor(y), 0, h - 1);
  const x1 = clamp(x0 + 1, 0, w - 1);
  const y1 = clamp(y0 + 1, 0, h - 1);
  const tx = x - x0;
  const ty = y - y0;

  const a = field[idx(x0, y0, w)];
  const b = field[idx(x1, y0, w)];
  const c = field[idx(x0, y1, w)];
  const d = field[idx(x1, y1, w)];
  const ab = lerp(a, b, tx);
  const cd = lerp(c, d, tx);
  return lerp(ab, cd, ty);
};

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
    let lastTime = 0;

    // Simple 2D “fluid-ish” velocity field in grid space (glyph cells)
    let velX = new Float32Array(0);
    let velY = new Float32Array(0);
    let velXTmp = new Float32Array(0);
    let velYTmp = new Float32Array(0);

    const pointer = {
      x: -9999,
      y: -9999,
      prevX: -9999,
      prevY: -9999,
      last: 0,
      active: false,
    };

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

      const totalCells = columns * rows;
      velX = new Float32Array(totalCells);
      velY = new Float32Array(totalCells);
      velXTmp = new Float32Array(totalCells);
      velYTmp = new Float32Array(totalCells);
    };

    const splat = (
      x: number,
      y: number,
      dx: number,
      dy: number,
      strength: number,
    ) => {
      const radius = 3; // in cells (smaller impact radius)
      const cx = Math.round(x);
      const cy = Math.round(y);
      for (let oy = -radius; oy <= radius; oy += 1) {
        const yy = cy + oy;
        if (yy < 1 || yy >= rows - 1) continue;
        for (let ox = -radius; ox <= radius; ox += 1) {
          const xx = cx + ox;
          if (xx < 1 || xx >= columns - 1) continue;
          const r2 = ox * ox + oy * oy;
          const falloff = Math.exp(-r2 / (radius * radius));
          const i = idx(xx, yy, columns);
          // No "dye" (density) — only inject motion.
          velX[i] += dx * falloff * strength;
          velY[i] += dy * falloff * strength;
        }
      }
    };

    const render = (time: number) => {
      const dt = clamp((time - lastTime) / 1000, 0, 0.05);
      lastTime = time;
      const t = time * 0.00035;
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(62, 62, 62, 0.55)';

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

      // Pointer → inject motion
      const influence =
        pointer.last === 0 ? 0 : Math.exp(-(time - pointer.last) / 650);
      if (pointer.active && influence > 0.02) {
        const safePrevX = Number.isFinite(pointer.prevX) ? pointer.prevX : pointer.x;
        const safePrevY = Number.isFinite(pointer.prevY) ? pointer.prevY : pointer.y;
        const dx = clamp((pointer.x - safePrevX) / Math.max(1, columns), -0.25, 0.25);
        const dy = clamp((pointer.y - safePrevY) / Math.max(1, rows), -0.25, 0.25);
        // Denser feel: stronger impulse (scales with movement).
        const impulse = (0.9 + Math.hypot(dx, dy) * 14) * influence * 18;
        splat(pointer.x, pointer.y, dx, dy, impulse);
      }

      // Advect velocity by itself (semi-Lagrangian), plus dissipation.
      const velocityDissipation = 0.93; // higher = denser / longer lasting
      const advectScale = 58; // higher = more “push” / slosh

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const i = idx(x, y, columns);
          const vx = velX[i] * velocityDissipation;
          const vy = velY[i] * velocityDissipation;

          const px = x - vx * dt * advectScale;
          const py = y - vy * dt * advectScale;
          velXTmp[i] = sampleBilinear(velX, px, py, columns, rows);
          velYTmp[i] = sampleBilinear(velY, px, py, columns, rows);
        }
      }

      // Simple diffusion/blur pass to feel more fluid (cheap 5-tap).
      for (let y = 1; y < rows - 1; y += 1) {
        for (let x = 1; x < columns - 1; x += 1) {
          const i = idx(x, y, columns);
          const vx =
            velXTmp[i] * 0.52 +
            (velXTmp[i - 1] +
              velXTmp[i + 1] +
              velXTmp[i - columns] +
              velXTmp[i + columns]) *
              0.12;
          const vy =
            velYTmp[i] * 0.52 +
            (velYTmp[i - 1] +
              velYTmp[i + 1] +
              velYTmp[i - columns] +
              velYTmp[i + columns]) *
              0.12;
          velX[i] = vx;
          velY[i] = vy;
        }
      }

      // Render the fluid as ASCII glyphs (the “fluid cursor”).
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const i = idx(x, y, columns);
          const vx = velX[i];
          const vy = velY[i];
          const speed = Math.hypot(vx, vy);
          if (speed <= 0.01) continue;

          // Map speed to glyph intensity.
          const normalized = clamp(speed * 0.35, 0, 1);
          const glyphIndex = Math.min(
            FLUID_GLYPHS.length - 1,
            Math.floor(normalized * (FLUID_GLYPHS.length - 1)),
          );
          const glyph = FLUID_GLYPHS[glyphIndex];
          if (glyph === ' ') continue;

          const alpha = clamp(0.25 + normalized * 0.85, 0, 1);
          context.fillStyle = `rgba(220, 240, 255, ${alpha})`;
          context.fillText(glyph, x * glyphSize, y * glyphSize);
        }
      }

      animationFrame = requestAnimationFrame(render);
    };

    updateSize();
    lastTime = performance.now();
    animationFrame = requestAnimationFrame(render);
    window.addEventListener('resize', updateSize);

    const handlePointerMove = (event: PointerEvent) => {
      const x = event.clientX / glyphSize;
      const y = event.clientY / glyphSize;
      pointer.prevX = Number.isFinite(pointer.x) ? pointer.x : x;
      pointer.prevY = Number.isFinite(pointer.y) ? pointer.y : y;
      pointer.x = x;
      pointer.y = y;
      pointer.last = performance.now();
      pointer.active = true;
    };

    const handlePointerLeave = () => {
      pointer.prevX = pointer.x;
      pointer.prevY = pointer.y;
      pointer.x = -9999;
      pointer.y = -9999;
      pointer.last = performance.now();
      pointer.active = false;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 h-full w-full opacity-70 mix-blend-screen pointer-events-none"
      aria-hidden="true"
    />
  );
}

