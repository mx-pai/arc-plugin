import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["scripts/build.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  child.on("exit", (code) =>
    code ? reject(new Error("构建失败")) : resolve(),
  );
});
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".map": "application/json",
};
createServer(async (req, res) => {
  try {
    const name = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(
      root,
      "dist",
      name === "/" ? "newtab.html" : "." + name,
    );
    if (!file.startsWith(path.join(root, "dist") + path.sep))
      throw new Error("Invalid path");
    const bytes = await readFile(file);
    res.writeHead(200, {
      "content-type": types[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(4173, "127.0.0.1", () =>
  console.log(
    "演示预览 http://127.0.0.1:4173/ · 设置 /options.html · 工具栏 /popup.html",
  ),
);
