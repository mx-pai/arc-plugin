import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
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
  ["sidepanel", "Arc Plugin"],
]) {
  await writeFile(
    path.join(dist, `${view}.html`),
    `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="styles.css"></head><body data-view="${view}"><div id="root"></div><script type="module" src="ui.js"></script></body></html>`,
  );
}
const manifest = JSON.parse(
  await readFile(path.join(dist, "manifest.json"), "utf8"),
);
console.log(`Built ${manifest.name} ${manifest.version} → ${dist}`);
