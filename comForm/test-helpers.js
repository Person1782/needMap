import vm from "node:vm";
import { readFileSync } from "node:fs";
export function read(name) { return readFileSync(new URL(name, import.meta.url), "utf8"); }
export function context(extra = {}) {
  const target = { console, setTimeout, clearTimeout, JSON, ...extra };
  target.window = target;
  const ctx = vm.createContext(target);
  for (const name of ["firebase-config.js", "form-model.js", "firebase-submit.js", "place-search.js", "adaptive-mode.js"]) vm.runInContext(read(name), ctx);
  return ctx;
}
export function plain(value) { return JSON.parse(JSON.stringify(value)); }
export const valid = { category: "healthcare", severity: "medium", summary: "Evening pharmacy access is limited.", location: { latitude: 37.77491234, longitude: -122.41941234 } };
