import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, "public"), dist, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: { worker: "src/worker.ts", ui: "src/app.tsx" },
  outdir: dist,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "chrome127",
  jsx: "automatic",
  minify: true,
  sourcemap: true,
  chunkNames: "chunks/[name]-[hash]",
  define: { "process.env.NODE_ENV": '"production"' },
});
await build({
  absWorkingDir: root,
  entryPoints: ["src/spotlight.tsx"],
  outfile: path.join(dist, "spotlight.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome127",
  jsx: "automatic",
  minify: true,
  sourcemap: true,
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
});
await cp(path.join(root, "src/styles.css"), path.join(dist, "styles.css"));
for (const [view, title] of [
  ["popup", "Arc Plugin"],
  ["newtab", "新标签页 · Arc Plugin"],
  ["options", "设置 · Arc Plugin"],
]) {
  await writeFile(
    path.join(dist, `${view}.html`),
    `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="styles.css"></head><body data-view="${view}"><div id="root"></div><script type="module" src="ui.js"></script></body></html>`,
  );
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, buffer) {
  const type = Buffer.from(name);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buffer.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, buffer])));
  return Buffer.concat([len, type, buffer, crc]);
}
function icon(size) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size,
        v = (y + 0.5) / size;
      const dx = Math.max(0.2 - u, 0, u - 0.8),
        dy = Math.max(0.2 - v, 0, v - 0.8);
      const inside = dx * dx + dy * dy < 0.18 * 0.18;
      const radius = Math.hypot(u - 0.47, v - 0.53);
      const letter =
        (radius > 0.13 && radius < 0.21) ||
        (u > 0.62 && u < 0.7 && v > 0.33 && v < 0.75);
      const p = y * (size * 4 + 1) + 1 + x * 4;
      pixels[p] = letter ? 255 : 120;
      pixels[p + 1] = letter ? 255 : 98;
      pixels[p + 2] = letter ? 255 : 141;
      pixels[p + 3] = inside ? 255 : 0;
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
for (const size of [16, 48, 128])
  await writeFile(path.join(dist, `icon-${size}.png`), icon(size));
const manifest = JSON.parse(
  await readFile(path.join(dist, "manifest.json"), "utf8"),
);
console.log(`Built ${manifest.name} ${manifest.version} → ${dist}`);
