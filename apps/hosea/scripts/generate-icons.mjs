import { Resvg } from '@resvg/resvg-js';
import { readFile, writeFile } from 'node:fs/promises';
const assets = new URL('../assets/', import.meta.url);
const source = await readFile(new URL('icon.svg', assets), 'utf8');
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const images = new Map(sizes.map(size => [size, new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng()]));
await writeFile(new URL('icon.png', assets), images.get(1024));
const types = new Map([[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']]);
const records = [...types].map(([size, type]) => {
  const png = images.get(size);
  const header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
});
const header = Buffer.alloc(8); header.write('icns'); header.writeUInt32BE(8 + records.reduce((n, r) => n + r.length, 0), 4);
await writeFile(new URL('icon.icns', assets), Buffer.concat([header, ...records]));
const icoSizes = [16, 32, 48, 64, 128, 256];
const icoHeader = Buffer.alloc(6); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(icoSizes.length, 4);
let offset = 6 + icoSizes.length * 16;
const entries = icoSizes.map(size => {
  const png = images.get(size); const entry = Buffer.alloc(16);
  entry[0] = entry[1] = size === 256 ? 0 : size;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(offset, 12);
  offset += png.length; return entry;
});
await writeFile(new URL('icon.ico', assets), Buffer.concat([icoHeader, ...entries, ...icoSizes.map(size => images.get(size))]));
console.log('Generated hosea PNG, ICNS, and ICO icons from assets/icon.svg.');
