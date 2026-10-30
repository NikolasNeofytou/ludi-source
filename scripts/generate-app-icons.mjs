// Rasterises the mark SVGs in apps/mobile/assets into the PNGs Expo needs,
// and writes the iOS 26 Icon Composer icon (assets/app.icon) from mark.svg.
//
// Run from the repo root:  node scripts/generate-app-icons.mjs
//
// The mark is full-bleed by design — its outermost plane is cut by the frame
// edge, and lifting it turns the mark into a bunting triangle.
//
// Android is the exception. A launcher shows only the middle 72 of the 108dp
// adaptive canvas and may mask it to a circle, so the same art loses the apex
// and the gold. The adaptive foreground therefore comes from mark-adaptive.svg,
// drawn into that window, with every plane still running off the mask.
//
// iOS reads assets/app.icon (app.json `ios.icon`): the ground as the icon's
// fill and each plane as its own layer, so the system can light the edges and
// derive real dark, clear and tinted icons instead of guessing from a flat
// PNG. Three groups, front to back: the gold, the light planes, the deep
// planes. The layers stay flat (`glass: false`) so the ramp keeps its
// colours — checked against the flat PNG rendered the same way, band for
// band. Preview any appearance with Icon Composer, or headless:
//   "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool" \
//     apps/mobile/assets/app.icon --export-image --output-file out.png \
//     --platform iOS --rendition Dark --width 1024 --height 1024 --scale 1
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'apps/mobile/assets');

const OUTPUTS = [
  { source: 'mark.svg', file: 'icon.png', size: 1024 },
  { source: 'mark-adaptive.svg', file: 'adaptive-icon.png', size: 1024 },
  { source: 'mark.svg', file: 'splash-icon.png', size: 512 },
  { source: 'mark.svg', file: 'favicon.png', size: 96 },
];

await mkdir(assets, { recursive: true });

for (const { source, file, size } of OUTPUTS) {
  const svg = await readFile(path.join(assets, source));
  const png = await sharp(svg, { density: 600 }).resize(size, size).png().toBuffer();
  await writeFile(path.join(assets, file), png);
  console.log(`${source} → ${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

// ── Icon Composer ──────────────────────────────────────────────────────────

const mark = await readFile(path.join(assets, 'mark.svg'), 'utf8');
const viewBox = mark.match(/viewBox="([^"]+)"/)[1];
const ground = mark.match(/<rect[^>]*fill="(#[0-9A-Fa-f]{6})"/)[1];
// Outermost plane first, the gold apex last — the document order of mark.svg.
const paths = [...mark.matchAll(/<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})"\/>/g)].map(
  ([, d, fill]) => ({ d, fill }),
);
const planes = paths.map((p, i) => ({ ...p, name: i === paths.length - 1 ? 'gold' : `plane-${i + 1}` }));

const srgb = (hex) =>
  `srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(',')},1.00000`;
const layer = (name) => ({ 'image-name': `${name}.svg`, name, glass: false });
const group = (name, names) => ({
  name,
  layers: names.map(layer),
  shadow: { kind: 'neutral', opacity: 0.5 },
  translucency: { enabled: false, value: 0.5 },
  specular: true,
});
const byName = (names) => names.filter((n) => planes.some((p) => p.name === n));

const iconDir = path.join(assets, 'app.icon');
await rm(iconDir, { recursive: true, force: true });
await mkdir(path.join(iconDir, 'Assets'), { recursive: true });
for (const { name, d, fill } of planes) {
  await writeFile(
    path.join(iconDir, 'Assets', `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="1024" height="1024"><path d="${d}" fill="${fill}"/></svg>\n`,
  );
}
const icon = {
  fill: { solid: srgb(ground) },
  groups: [
    group('gold', ['gold']),
    group('light', byName(['plane-6', 'plane-5', 'plane-4'])),
    group('deep', byName(['plane-3', 'plane-2', 'plane-1'])),
  ],
  'supported-platforms': { squares: 'shared' },
};
await writeFile(path.join(iconDir, 'icon.json'), `${JSON.stringify(icon, null, 2)}\n`);
console.log(`mark.svg → app.icon  ${planes.length} layers in 3 groups`);
