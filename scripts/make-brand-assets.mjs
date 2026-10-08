#!/usr/bin/env node
/**
 * Builds every icon and the social preview image from the one master logo,
 * assets/brand/4e-logo.png (1200×1200, white mark on the brand blue).
 *
 *   npm run brand
 *
 * Writes into public/ (served at the site root):
 *   favicon.ico                 16, 32 and 48 px in one file
 *   favicon-16x16.png, favicon-32x32.png
 *   apple-touch-icon.png        180 px
 *   icon-192.png, icon-512.png  web app icons
 *   icon-maskable-512.png       web app icon that Android may crop to a circle or squircle
 *   og.png                      1200×630 social preview (mark + tagline)
 *
 * The social image is drawn by Chrome so the type is crisp: it needs Google
 * Chrome (set CHROME_PATH if it lives somewhere unusual). Everything else only
 * needs sharp. To change the logo, replace the master and run this again.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = path.join(ROOT, 'assets/brand/4e-logo.png');
const OUT = path.join(ROOT, 'public');
const TAGLINE = ['May the 4th', 'be with you!'];
const BLUE = '#2F27CE'; // the master's background, exactly

// Where the white mark sits in the 1200×1200 master (measured): x 240–959, y 289–909.
const MARK = { left: 240, top: 289, width: 720, height: 621 };

await mkdir(OUT, { recursive: true });
const png = (pipeline) => pipeline.png({ compressionLevel: 9 });
const write = async (name, buffer) => {
  await writeFile(path.join(OUT, name), buffer);
  console.log(`  ${name.padEnd(24)} ${buffer.length.toLocaleString()} bytes`);
};

// 1. Larger icons keep the supplied proportions. The mark stays well inside the inner 80% "safe zone"
//    Android uses when it crops a maskable icon, so the same artwork serves both purposes.
console.log('Icons:');
for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
]) {
  await write(name, await png(sharp(MASTER).resize(size, size, { kernel: 'lanczos3' })).toBuffer());
}

// 2. Browser-tab icons are tiny, so crop closer to the mark (it fills ~88% of the width) to keep the "4e" legible.
const side = Math.round(MARK.width / 0.88);
const centreX = MARK.left + MARK.width / 2;
const centreY = MARK.top + MARK.height / 2;
const tight = {
  left: Math.round(centreX - side / 2),
  top: Math.round(centreY - side / 2),
  width: side,
  height: side,
};
const small = (size) => png(sharp(MASTER).extract(tight).resize(size, size, { kernel: 'lanczos3' })).toBuffer();

const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(small));
await write('favicon-16x16.png', images[0]);
await write('favicon-32x32.png', images[1]);

/** An .ico that holds PNG images (every current browser reads these). */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, data }, i) => {
    const at = i * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at); // width
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1); // height
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, directory, ...entries.map((e) => e.data)]);
}
await write('favicon.ico', ico(sizes.map((size, i) => ({ size, data: images[i] }))));

// 3. Social preview, 1200×630. Everything sits in the middle so a square centre-crop (WhatsApp, iMessage) still shows it all.
console.log('Social preview:');
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome)) {
  console.error(`  Skipped og.png: Google Chrome not found at ${chrome}. Set CHROME_PATH and run again.`);
  process.exitCode = 1;
} else {
  const padding = 40;
  const mark = await png(
    sharp(MASTER).extract({
      left: MARK.left - padding,
      top: MARK.top - padding,
      width: MARK.width + 2 * padding,
      height: MARK.height + 2 * padding,
    })
  ).toBuffer(); // same blue as the page behind it, so it blends in seamlessly
  const html = `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; width: 1200px; height: 630px; background: ${BLUE}; }
    body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; color: #fff;
           font-family: Inter, 'SF Pro Display', -apple-system, 'Helvetica Neue', Arial, sans-serif; }
    img { height: 290px; display: block; }
    p { margin: 0; font-size: 70px; line-height: 1.08; font-weight: 800; letter-spacing: -0.02em; text-align: center; }
  </style><img alt="" src="data:image/png;base64,${mark.toString('base64')}"><p>${TAGLINE.join('<br>')}</p>`;
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
    // Drawn at 2× and brought down to 1200×630 for smooth edges.
    await write('og.png', await png(sharp(shot).resize(1200, 630, { kernel: 'lanczos3' })).toBuffer());
  } finally {
    await browser.close();
  }
}
