'use client';

import { useEffect, useRef } from 'react';
import { RAMP, asciiFromImageData } from './ascii';
import type { Track } from './apiTypes';
import { formatProgress } from './format';

const CELL = 8; // px line height; glyph width is measured

function noiseLines(cols: number, rows: number): string[] {
  const lines: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    let line = '';
    for (let c = 0; c < cols; c += 1) {
      const v = (Math.sin(c * 0.21 + r * 0.37) + Math.cos(c * 0.07 - r * 0.13) + 2) / 4;
      line += RAMP[Math.min(RAMP.length - 1, Math.floor(v * 0.6 * RAMP.length))];
    }
    lines.push(line);
  }
  return lines;
}

function GlyphArt({ src }: { src: string | null }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let cancelled = false;
    let image: HTMLImageElement | null = null;

    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${CELL}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textBaseline = 'top';
      const cw = ctx.measureText('D').width || CELL * 0.6;
      const cols = Math.floor(w / cw);
      const rows = Math.floor(h / CELL);
      let lines = noiseLines(cols, rows);
      if (image) {
        try {
          const off = document.createElement('canvas');
          off.width = cols * 2;
          off.height = rows * 2;
          const octx = off.getContext('2d');
          if (octx) {
            octx.drawImage(image, 0, 0, off.width, off.height);
            lines = asciiFromImageData(octx.getImageData(0, 0, off.width, off.height).data, off.width, off.height, cols, rows);
          }
        } catch {
          // tainted canvas (no CORS): keep the noise
        }
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      lines.forEach((line, r) => ctx.fillText(line, 0, r * CELL));
    };

    if (src) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        image = img;
        paint();
      };
      img.onerror = () => {
        if (!cancelled) paint();
      };
      img.src = src;
    }
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(canvas);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [src]);

  return <canvas ref={ref} aria-hidden="true" className="block h-full w-full" />;
}

/** `track` is undefined while loading or when /now-playing fails (`error`), null when nothing is playing. */
export default function NowPlaying({
  track,
  hostName,
  error,
}: {
  track: Track | null | undefined;
  hostName: string | null;
  error: boolean;
}) {
  return (
    <section aria-label="Now playing" className="flex min-w-0 flex-col gap-3.5">
      <div className="aspect-[10/7] w-full overflow-hidden rounded border border-line-20 bg-surface-50">
        <GlyphArt src={track?.albumArt ?? null} />
      </div>
      {track ? (
        <>
          <h2 className="truncate text-3xl leading-none tracking-[-0.02em] text-ink-90 md:text-4xl">{track.song}</h2>
          <div className="flex items-baseline justify-between gap-4 font-mono text-xs">
            <span className="min-w-0 truncate text-ink-70">
              {track.artist}
              {hostName ? ` · ${hostName}'s jam` : ''}
            </span>
            {track.progressMs !== null && <span className="shrink-0 text-ink-50">{formatProgress(track.progressMs)}</span>}
          </div>
        </>
      ) : track === undefined ? (
        <p role={error ? 'status' : undefined} className="font-mono text-xs text-ink-50">
          {error ? "Can't check what's playing. Retrying." : "checking what's playing"}
        </p>
      ) : (
        <>
          <h2 className="text-3xl leading-none tracking-[-0.02em] text-ink-60 md:text-4xl">Nothing playing</h2>
          <p className="font-mono text-xs text-ink-50">Songs show up here when someone with linked Spotify plays music.</p>
        </>
      )}
    </section>
  );
}
