import { readFile, writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { minify } from "terser";
import { parse } from "acorn";
const scripts = ["firebase-config.js", "form-model.js", "firebase-submit.js", "place-search.js", "adaptive-mode.js", "app.js"];
const source = (await Promise.all(scripts.map((file) => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
parse(source, { ecmaVersion: 5 });
const result = await minify(source, { ecma: 5, compress: { passes: 2 }, mangle: true, format: { comments: false, ascii_only: true } });
parse(result.code, { ecmaVersion: 5 });
const mapUrl = process.env.NEEDMAP_MAP_URL || "/map/";
if (!/^\/(?!\/)[^\s]*$/.test(mapUrl) && !/^https:\/\/[^\s]+$/i.test(mapUrl)) throw new Error("NEEDMAP_MAP_URL must be a root-relative path or an HTTPS URL.");
const escapedMapUrl = mapUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = (await readFile(new URL("index.html", import.meta.url), "utf8")).replace(/    <!-- form-scripts-start -->[\s\S]*?<!-- form-scripts-end -->/, '    <script defer src="./report.js"></script>').replace('data-map-url="/map/"', 'data-map-url="' + escapedMapUrl + '"').replace('id="map-link" href="/map/"', 'id="map-link" href="' + escapedMapUrl + '"');
const css = (await readFile(new URL("styles.css", import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{}:;,])\s*/g, "$1").trim();
await rm(new URL("dist", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("dist", import.meta.url));
for (const [name, content] of [["index.html", html], ["report.js", result.code], ["styles.css", css]]) {
  await writeFile(new URL("dist/" + name, import.meta.url), content);
  console.log(`${name}: ${Buffer.byteLength(content)} bytes, ${gzipSync(content).byteLength} bytes gzip`);
}
await copyFile(new URL("favicon.svg", import.meta.url), new URL("dist/favicon.svg", import.meta.url));
console.log("Verified source and bundled script parse as ES5. No external scripts, fonts, images or map tiles.");
