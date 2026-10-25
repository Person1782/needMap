#!/usr/bin/env node
// Regenerate after changing bundled polygons: node scripts/build-report-region-index.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORLD_REGION_ROWS } from "../world-region-catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function geometrySearchBounds(geometry) {
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon" ? geometry.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length) throw new Error("Missing polygon geometry.");
  let south = 90, west = 180, north = -90, east = -180, crossesDateLine = false;
  for (const polygon of polygons) for (const ring of polygon) {
    for (let index = 0; index < ring.length; index += 1) {
      const [longitude, latitude] = ring[index];
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        throw new Error("Invalid polygon coordinate.");
      }
      south = Math.min(south, latitude); north = Math.max(north, latitude);
      west = Math.min(west, longitude); east = Math.max(east, longitude);
      if (index && Math.abs(longitude - ring[index - 1][0]) > 180) crossesDateLine = true;
    }
  }
  // Broad bounds are deliberate at the date line: only exact polygon checks
  // decide membership, and the shortlist must never omit a wrapped polygon.
  if (crossesDateLine || east - west > 300) { west = -180; east = 180; }
  const down = (number) => Math.floor(number * 1e6) / 1e6;
  const up = (number) => Math.ceil(number * 1e6) / 1e6;
  return [down(south), down(west), up(north), up(east)];
}

export async function buildReportRegionIndex() {
  const parents = WORLD_REGION_ROWS.filter((row) => ["country", "state"].includes(row[3]) && row[6])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const rows = [];
  for (const [id, , , kind, countryCode, , file] of parents) {
    const data = JSON.parse(await fs.readFile(path.join(root, "public", file), "utf8"));
    const parent = data.regions?.[0];
    if (data.version !== "needmap-v2" || data.parentId !== id || parent?.id !== id ||
        parent.kind !== kind || parent.countryCode !== countryCode) {
      throw new Error(`Bundled boundary metadata does not match ${id}.`);
    }
    rows.push([id, ...geometrySearchBounds(parent.geometry)]);
  }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = await buildReportRegionIndex();
  const output = "// Generated from bundled polygons; run scripts/build-report-region-index.mjs after boundary changes.\n" +
    "// Rows: parent ID, south, west, north, east. Bounds shortlist files; they never establish membership.\n" +
    `export const REPORT_REGION_BOUNDS = ${JSON.stringify(rows)};\n`;
  await fs.writeFile(path.join(root, "report-region-bounds.js"), output);
  console.log(JSON.stringify({ parents: rows.length, bytes: Buffer.byteLength(output) }));
}
