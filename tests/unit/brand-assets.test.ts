import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pub = (name: string) => path.join(ROOT, 'public', name);
const BLUE = [47, 39, 206]; // #2F27CE, the master logo's background

const PNGS: [string, number, number][] = [
  ['favicon-16x16.png', 16, 16],
  ['favicon-32x32.png', 32, 32],
  ['apple-touch-icon.png', 180, 180],
  ['icon-192.png', 192, 192],
  ['icon-512.png', 512, 512],
  ['icon-maskable-512.png', 512, 512],
  ['og.png', 1200, 630],
];

/** Pixel at (x, y) as [r, g, b, a]. */
async function pixel(file: string, x: number, y: number) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * 4;
  return [data[at], data[at + 1], data[at + 2], data[at + 3]];
}

describe('icons and social image', () => {
  it.each(PNGS)('%s is a %ix%i PNG', async (name, width, height) => {
    const meta = await sharp(pub(name)).metadata();
    expect(meta.format).toBe('png');
    expect([meta.width, meta.height]).toEqual([width, height]);
  });

  it('every image is opaque brand blue at its corners (iPhones paint transparent corners black)', async () => {
    for (const [name, width, height] of PNGS) {
      for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
        expect(await pixel(pub(name), x, y), `${name} at ${x},${y}`).toEqual([...BLUE, 255]);
      }
    }
  });

  it('favicon.ico holds 16, 32 and 48 pixel PNG images', () => {
    const ico = readFileSync(pub('favicon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    const count = ico.readUInt16LE(4);
    const found: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + i * 16;
      const size = ico.readUInt8(entry);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const image = ico.subarray(offset, offset + length);
      expect(image.subarray(0, 8).toString('hex'), `image ${size}`).toBe('89504e470d0a1a0a'); // PNG signature
      expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([size, size]); // IHDR width, height
      found.push(size);
    }
    expect(found).toEqual([16, 32, 48]);
    expect(offsetEnd(ico)).toBe(ico.length);
  });

  it('the master logo is kept next to the script that builds everything from it', async () => {
    const master = path.join(ROOT, 'assets/brand/4e-logo.png');
    expect(existsSync(master)).toBe(true);
    const meta = await sharp(master).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 1200]);
    expect(await pixel(master, 5, 5)).toEqual([...BLUE, 255]);
  });

  it('the old default favicon is gone, so nothing competes with the new one', () => {
    expect(existsSync(path.join(ROOT, 'src/app/favicon.ico'))).toBe(false);
  });
});

/** Where the last image in an .ico ends. */
function offsetEnd(ico: Buffer) {
  let end = 0;
  for (let i = 0; i < ico.readUInt16LE(4); i += 1) {
    const entry = 6 + i * 16;
    end = Math.max(end, ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
  }
  return end;
}

describe('web app manifest', () => {
  const manifest = JSON.parse(readFileSync(pub('site.webmanifest'), 'utf8'));

  it('names the app, starts on Links and uses the brand colour', () => {
    expect(manifest).toMatchObject({ name: '4th Entity', description: 'May the 4th be with you!', start_url: '/links', scope: '/', display: 'standalone' });
    expect(manifest.theme_color.toLowerCase()).toBe('#2f27ce');
    expect(manifest.background_color.toLowerCase()).toBe('#2f27ce');
  });

  it('lists icons that exist, at the sizes it claims, including a maskable one', async () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
      const file = pub(icon.src.replace(/^\//, ''));
      expect(existsSync(file), icon.src).toBe(true);
      const meta = await sharp(file).metadata();
      expect(`${meta.width}x${meta.height}`, icon.src).toBe(icon.sizes);
      expect(icon.type).toBe('image/png');
    }
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    expect(manifest.icons.some((i: { sizes: string; purpose?: string }) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
  });
});
