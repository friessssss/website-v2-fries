import { describe, expect, it } from 'vitest';
import { asciiFromImageData } from '../ascii';

describe('asciiFromImageData', () => {
  it('maps black to space and white to D', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(asciiFromImageData(data, 2, 1, 2, 1)).toEqual([' D']);
  });

  it('returns rows lines of cols chars', () => {
    const w = 8;
    const h = 6;
    const data = new Uint8ClampedArray(w * h * 4).fill(128);
    const out = asciiFromImageData(data, w, h, 4, 3);
    expect(out).toHaveLength(3);
    for (const line of out) expect(line).toHaveLength(4);
  });

  it('treats transparent pixels as dark', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 0]);
    expect(asciiFromImageData(data, 1, 1, 1, 1)).toEqual([' ']);
  });
});
