export const RAMP = [' ', '.', ':', '-', '+', '*', '#', 'D'] as const;

/** Brightness-samples RGBA image data into `rows` strings of `cols` ramp glyphs (dark = space, bright = D). */
export function asciiFromImageData(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  cols: number,
  rows: number,
): string[] {
  const lines: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    const y0 = Math.floor((r * h) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * h) / rows));
    let line = '';
    for (let c = 0; c < cols; c += 1) {
      const x0 = Math.floor((c * w) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / cols));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < h; y += 1) {
        for (let x = x0; x < x1 && x < w; x += 1) {
          const i = (y * w + x) * 4;
          const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          sum += lum * (data[i + 3] / 255);
          n += 1;
        }
      }
      const v = n === 0 ? 0 : sum / n;
      line += RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))];
    }
    lines.push(line);
  }
  return lines;
}
