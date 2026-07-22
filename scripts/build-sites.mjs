import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(root, "public");
const outFile = resolve(root, "dist", "server", "index.js");
const runtimeFile = resolve(root, "scripts", "sites-worker-runtime.mjs");

const files = [
  ["/index.html", "index.html", "text/html; charset=utf-8"],
  ["/styles.css", "styles.css", "text/css; charset=utf-8"],
  ["/app.js", "app.js", "application/javascript; charset=utf-8"]
];

const assets = {};
for (const [route, file, contentType] of files) {
  assets[route] = {
    contentType,
    body: await readFile(resolve(publicDir, file), "utf8")
  };
}

const runtime = await readFile(runtimeFile, "utf8");
const source = `const STATIC_ASSETS = ${JSON.stringify(assets)};\n\n${runtime}`;

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, source, "utf8");
console.log(`Sites bundle ready: ${outFile}`);
