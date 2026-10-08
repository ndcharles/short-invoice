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
 *   site-default.png            1200×630 "site default" link preview (mark left, title and tagline right);
 *                               the words come from src/lib/site-default.ts, which the editor also uses
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
import { SITE_DEFAULT } from '../src/lib/site-default.ts';

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

/** The white mark on a transparent background, so it can sit on a gradient. The master is flat white on flat blue, so the green channel runs from the blue's (39) to white (255). */
async function transparentMark(padding) {
  const { data, info } = await sharp(MASTER).extractChannel('green').raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4, 255);
  for (let i = 0; i < data.length; i += 1) rgba[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(((data[i] - 39) / (255 - 39)) * 255)));
  return png(
    sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).extract({
      left: MARK.left - padding,
      top: MARK.top - padding,
      width: MARK.width + 2 * padding,
      height: MARK.height + 2 * padding,
    })
  ).toBuffer();
}
const html = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 3. Social images, 1200×630. Drawn by Chrome at 2× and brought down to size for smooth edges.
console.log('Social images:');
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome)) {
  console.error(`  Skipped og.png and site-default.png: Google Chrome not found at ${chrome}. Set CHROME_PATH and run again.`);
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
  const ogHtml = `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; width: 1200px; height: 630px; background: ${BLUE}; }
    body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; color: #fff;
           font-family: Inter, 'SF Pro Display', -apple-system, 'Helvetica Neue', Arial, sans-serif; }
    img { height: 290px; display: block; }
    p { margin: 0; font-size: 70px; line-height: 1.08; font-weight: 800; letter-spacing: -0.02em; text-align: center; }
  </style><img alt="" src="data:image/png;base64,${mark.toString('base64')}"><p>${TAGLINE.join('<br>')}</p>`;

  // The "site default" preview: the mark on the left, a thin rule, then the title over the tagline.
  const whiteMark = await transparentMark(0);
  const split = SITE_DEFAULT.title.lastIndexOf(' ');
  const siteHtml = `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; width: 1200px; height: 630px; }
    body { position: relative; overflow: hidden; color: #fff;
           background: radial-gradient(ellipse 70% 90% at 88% 8%, rgba(255,255,255,0.13), transparent 60%),
                       linear-gradient(135deg, #3A32DD 0%, ${BLUE} 55%, #241DAE 100%);
           font-family: Inter, 'SF Pro Display', -apple-system, 'Helvetica Neue', Arial, sans-serif; }
    .mark { position: absolute; left: 92px; top: 50%; width: 340px; transform: translateY(-50%); display: block; }
    .rule { position: absolute; left: 504px; top: 150px; width: 2px; height: 330px; background: rgba(255,255,255,0.30); border-radius: 1px; }
    .text { position: absolute; left: 566px; right: 72px; top: 50%; transform: translateY(-50%); }
    h1 { margin: 0 0 24px; font-size: 76px; line-height: 1.04; font-weight: 800; letter-spacing: -0.025em; }
    p { margin: 0; font-size: 33px; line-height: 1.38; font-weight: 500; color: rgba(255,255,255,0.9); letter-spacing: -0.005em; }
  </style>
  <img class="mark" alt="" src="data:image/png;base64,${whiteMark.toString('base64')}">
  <div class="rule"></div>
  <div class="text"><h1>${html(SITE_DEFAULT.title.slice(0, split))}<br>${html(SITE_DEFAULT.title.slice(split + 1))}</h1><p>${html(SITE_DEFAULT.description)}</p></div>`;

  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    for (const [name, markup] of [['og.png', ogHtml], ['site-default.png', siteHtml]]) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
      await page.setContent(markup);
      await page.evaluate(() => document.fonts.ready);
      const shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
      await write(name, await png(sharp(shot).resize(1200, 630, { kernel: 'lanczos3' })).toBuffer());
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
