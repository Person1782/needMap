#!/usr/bin/env node
// Offline build only. First run prepare-world-boundaries.py on the pinned CGAZ
// GeoPackages, then: node scripts/build-world-regions.mjs /path/to/prepared-data
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { REGION_CATALOG_ROWS } from "../region-catalog.js";
import { COUNTRY_ALPHA3 } from "../country-alpha3.js";
import { buildNeedMapRegions, NEEDMAP_REGION_VERSION, regionAreaKm2, shouldSplitRegion } from "../needmap-regions.js";
import { cleanWorldGeometry } from "./world-region-geometry.mjs";
import { repairWorldRegionName } from "./world-region-names.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "public/data/regions");
const sourceRevision = "5c25134028196d43ce97b5071934fd0cfc92f09f";
const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const simple = (value) => normalize(String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\b(province|state|region|regiao|provincia|departamento|departement|district|county|governorate|department|prefecture|oblast|republic|territory|autonomous|city|of|the|de|del|do|da|dos|das|la|los|las|el|and|y)\b/gi, ""));
const safeId = (id) => id.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
const polygons = (geometry) => geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
function bounds(geometry) {
  const box = [[90, 180], [-90, -180]];
  for (const polygon of polygons(geometry)) for (const ring of polygon) for (const [x, y] of ring) {
    box[0][0] = Math.min(box[0][0], y); box[0][1] = Math.min(box[0][1], x);
    box[1][0] = Math.max(box[1][0], y); box[1][1] = Math.max(box[1][1], x);
  }
  return box;
}
const overlaps = (box, feature) => !feature.bbox || (box[0][1] <= feature.bbox[2] && box[1][1] >= feature.bbox[0] &&
  box[0][0] <= feature.bbox[3] && box[1][0] >= feature.bbox[1]);
const jsonRead = async (filename) => JSON.parse(await fs.readFile(filename, "utf8"));

async function partitionWithDeadline(parent, features) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { mode: "partition", parent, features } });
    const timeout = setTimeout(() => { worker.terminate(); resolve({ children: [], timedOut: true }); }, 30000);
    worker.once("message", (message) => {
      clearTimeout(timeout);
      message.error ? reject(new Error(message.error)) : resolve({ children: message.result, timedOut: false });
    });
    worker.once("error", (error) => { clearTimeout(timeout); reject(error); });
  });
}

async function buildCountry({ input, parents, countryCode, resume, retryUnsplit, sourceFiles }) {
  let units = [];
  try { units = (await jsonRead(path.join(input, `${COUNTRY_ALPHA3[countryCode]}-ADM2.json`))).features
    .filter((item) => item.properties.shapeType === "ADM2")
    .map((item) => ({ ...item, properties: { ...item.properties, shapeName: repairWorldRegionName(item.properties.shapeName) } })); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const rows = [], audit = [];
  for (const parent of parents) {
    const start = performance.now();
    const eligible = shouldSplitRegion(parent);
    const candidates = units.filter((feature) => overlaps(parent.bounds, feature));
    const file = `data/regions/${safeId(parent.id)}.json`;
    let children = null, timedOut = false;
    if (resume) {
      try {
        let previous;
        try { previous = await jsonRead(path.join(root, "public", file)); }
        catch (error) {
          if (error.code !== "ENOENT" || !sourceFiles[parent.sourceShapeID]) throw error;
          previous = await jsonRead(path.join(root, "public", sourceFiles[parent.sourceShapeID]));
        }
        if (previous.version === NEEDMAP_REGION_VERSION &&
            previous.regions?.[0]?.sourceShapeID === parent.sourceShapeID &&
            !(retryUnsplit && eligible && previous.regions.length === 1)) {
          const oldParent = previous.regions[0];
          children = previous.regions.slice(1).map((child) => {
            const suffix = child.name.slice(oldParent.name.length);
            const name = `${parent.name}${suffix}`;
            return { ...child, id: `${parent.id}${child.id.slice(oldParent.id.length)}`,
              name, label: `${name}, ${parent.country}`, parentId: parent.id, parentName: parent.name,
              memberNames: child.memberNames?.map(repairWorldRegionName) };
          });
        }
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (!children) {
      const result = eligible ? await partitionWithDeadline(parent, candidates) : { children: [], timedOut: false };
      children = result.children; timedOut = result.timedOut;
    }
    const regions = [parent, ...children].map(({ excludedGeometry, ...value }) =>
      ({ ...value, geometry: cleanWorldGeometry(value.geometry).geometry }));
    const serialized = JSON.stringify({ version: NEEDMAP_REGION_VERSION, parentId: parent.id, regions });
    await fs.writeFile(path.join(root, "public", file), serialized + "\n");
    for (const child of children) rows.push([child.id, child.name, "", "needmap", countryCode, parent.id, file]);
    audit.push({ id: parent.id, name: parent.name, countryCode, sourceShapeID: parent.sourceShapeID,
      matchedCatalog: parent.matchedCatalog, areaKm2: Math.round(regionAreaKm2(parent.geometry)),
      status: children.length ? "partitioned" : timedOut ? "whole_parent_computation_timeout"
        : eligible ? "whole_parent_insufficient_subdivision_coverage" : "whole_parent",
      childCount: children.length, candidateUnits: candidates.length, file, bytes: Buffer.byteLength(serialized + "\n", "utf8"),
      elapsedMs: Math.round(performance.now() - start) });
  }
  return { rows, audit };
}

if (!isMainThread) {
  try { parentPort.postMessage({ result: workerData.mode === "partition"
    ? buildNeedMapRegions(workerData.parent, { type: "FeatureCollection", features: workerData.features })
    : await buildCountry(workerData) }); }
  catch (error) { parentPort.postMessage({ error: error.stack || String(error) }); }
} else {
  const input = path.resolve(process.argv[2] || "/tmp/needmap-world-prepared");
  await fs.mkdir(outputRoot, { recursive: true });
  let previousFiles = new Map();
  try { previousFiles = new Map((await jsonRead(path.join(root, "world-region-build.json"))).parents.map((parent) => [parent.sourceShapeID, parent.file])); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const alpha2 = new Map(Object.entries(COUNTRY_ALPHA3).map(([two, three]) => [three, two]));
  const countries = new Map(REGION_CATALOG_ROWS.filter(([id]) => id.length === 2).map(([id, name]) => [id, name]));
  const rows = REGION_CATALOG_ROWS.map(([id, name, native]) => [id, name, native, id.length === 2 ? "country" : "state", id.slice(0, 2), "", ""]);
  const rowById = new Map(rows.map((row) => [row[0], row]));
  const used = new Set();
  const unmatchedSource = [], jobs = [], repairedNames = [];
  const filenames = (await fs.readdir(input)).filter((name) => /-ADM1\.json$/.test(name)).sort();
  for (const filename of filenames) {
    const features = (await jsonRead(path.join(input, filename))).features;
    const code = alpha2.get(filename.slice(0, -10));
    const parents = [];
    for (const feature of features) {
      const properties = feature.properties;
      if (!code || properties.shapeType !== "ADM1") {
        unmatchedSource.push({ ...properties, status: !code ? "unmapped_country_or_disputed_code" : "country_or_disputed_source_feature" });
        continue;
      }
      const originalName = properties.shapeName;
      properties.shapeName = repairWorldRegionName(originalName);
      if (properties.shapeName !== originalName) repairedNames.push({ shapeID: properties.shapeID, countryCode: code,
        originalName, repairedName: properties.shapeName });
      const candidates = rows.filter((row) => row[3] === "state" && row[4] === code && !used.has(row[0]));
      const exact = candidates.filter((row) => [row[1], row[2]].some((name) => normalize(name) === normalize(properties.shapeName)));
      const broad = candidates.filter((row) => [row[1], row[2]].some((name) => simple(name) && simple(name) === simple(properties.shapeName)));
      const matches = exact.length === 1 ? exact : broad;
      let row = matches.length === 1 ? matches[0] : null;
      const matchedCatalog = Boolean(row);
      if (!row) {
        const id = `${code}-GB-${properties.shapeID}`;
        row = [id, properties.shapeName, "", "state", code, "", ""];
        rows.push(row); rowById.set(id, row);
      }
      used.add(row[0]);
      row[6] = `data/regions/${safeId(row[0])}.json`;
      const cleaned = cleanWorldGeometry(feature.geometry);
      parents.push({ id: row[0], name: row[1], label: `${row[1]}, ${countries.get(code) || code}`,
        kind: "state", country: countries.get(code) || code, countryCode: code,
        geometry: cleaned.geometry, bounds: bounds(cleaned.geometry), source: "geoBoundaries CGAZ",
        sourceShapeID: properties.shapeID, matchedCatalog, collapsedSourceRingsRemoved: cleaned.removedRings });
    }
    if (parents.length) jobs.push({ input, parents, countryCode: code, resume: process.argv.includes("--resume"),
      retryUnsplit: process.argv.includes("--retry-unsplit"), sourceFiles: Object.fromEntries(parents
        .map((parent) => [parent.sourceShapeID, previousFiles.get(parent.sourceShapeID)]).filter(([, file]) => file)) });
  }
  const audits = [], children = [];
  let next = 0, completed = 0;
  async function runWorker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: job });
        worker.once("message", (message) => message.error ? reject(new Error(message.error)) : resolve(message.result));
        worker.once("error", reject);
        worker.once("exit", (code) => { if (code) reject(new Error(`Boundary worker exited ${code}`)); });
      });
      children.push(...result.rows); audits.push(...result.audit); completed += 1;
      console.log(JSON.stringify({ country: job.countryCode, completed, total: jobs.length,
        parents: result.audit.length, children: result.rows.length }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, runWorker));
  rows.push(...children.sort((first, second) => first[0].localeCompare(second[0])));
  const preparation = await jsonRead(path.join(input, "prepare-manifest.json"));
  const summary = { status: "complete", version: NEEDMAP_REGION_VERSION, source: "geoBoundaries CGAZ", sourceRevision,
    originalCatalogEntries: REGION_CATALOG_ROWS.length, countries: countries.size,
    sourceParents: audits.length, matchedOriginalStates: audits.filter((item) => item.matchedCatalog).length,
    addedSourceStates: audits.filter((item) => !item.matchedCatalog).length,
    generatedRegions: children.length, totalEntries: rows.length,
    partitionedParents: audits.filter((item) => item.childCount > 0).length,
    wholeLargeParents: audits.filter((item) => item.status.startsWith("whole_parent_")).length,
    originalStateFallbacks: rows.filter((row) => row[3] === "state" && !row[6]).length,
    sourceRecordsNotAssignedToStates: unmatchedSource.length,
    repairedSourceNames: repairedNames.length,
    files: audits.length, geometryBytes: audits.reduce((sum, item) => sum + item.bytes, 0),
    inputs: preparation.inputs, simplificationDegrees: preparation.simplificationDegrees };
  await fs.writeFile(path.join(root, "world-region-catalog.js"),
    `// Generated offline; see WORLD-REGIONS.md. Do not edit rows by hand.\nexport const WORLD_REGION_BUILD = Object.freeze(${JSON.stringify(summary)});\nexport const WORLD_REGION_ROWS = ${JSON.stringify(rows)};\n`);
  await fs.writeFile(path.join(root, "world-region-build.json"), JSON.stringify({ summary, parents: audits,
    sourceRecordsNotAssignedToStates: unmatchedSource, repairedNames, preparationAdjustments: preparation.adjustments }) + "\n");
  const currentFiles = new Set(audits.map((audit) => path.basename(audit.file)));
  for (const filename of await fs.readdir(outputRoot)) {
    if (!filename.endsWith(".json") || currentFiles.has(filename)) continue;
    const previous = await jsonRead(path.join(outputRoot, filename));
    if (previous.version === NEEDMAP_REGION_VERSION && previous.regions?.[0]?.sourceShapeID &&
        previous.regions[0].source === "geoBoundaries CGAZ") await fs.unlink(path.join(outputRoot, filename));
  }
  console.log(JSON.stringify({ complete: true, ...summary }));
}
