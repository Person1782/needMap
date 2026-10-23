#!/usr/bin/env python3
"""Bundle complete American Samoa land geometry after the standard world build.

Usage: python3 scripts/supplement-american-samoa.py /path/ne_10m_admin_1_states_provinces.zip
Requires pyshp. The pinned source archive is public-domain Natural Earth 5.1.1.
No source download or geometric inference happens in the browser.
"""
import hashlib
import json
import pathlib
import sys
import zipfile

import shapefile

SOURCE_SHA256 = "efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05"
SOURCE_URL = "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip"
SOURCE_VERSION = "5.1.1"
EXPECTED_DISTRICTS = {"ASM-4998", "ASM-4999", "ASM-5000", "ASM-5001", "ASM-5002"}


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def main():
    archive = pathlib.Path(sys.argv[1])
    root = pathlib.Path(__file__).resolve().parents[1]
    checksum = hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()
    if checksum != SOURCE_SHA256:
        raise ValueError("Unexpected Natural Earth archive; verify the source before updating the pinned checksum.")
    with zipfile.ZipFile(archive) as source:
        version_file = next(name for name in source.namelist() if name.endswith("VERSION.txt"))
        if source.read(version_file).decode().strip() != SOURCE_VERSION:
            raise ValueError("Unexpected Natural Earth dataset version.")
    polygons, areas = [], []
    reader = shapefile.Reader(str(archive), encoding="utf-8")
    for feature in reader.iterShapeRecords():
        properties = feature.record.as_dict()
        if properties["iso_a2"] != "AS":
            continue
        geometry = feature.shape.__geo_interface__
        if geometry["type"] == "Polygon":
            polygons.append(geometry["coordinates"])
        elif geometry["type"] == "MultiPolygon":
            polygons.extend(geometry["coordinates"])
        else:
            raise ValueError("American Samoa source contains a non-polygon geometry.")
        areas.append({"id": properties["adm1_code"], "name": properties["name_en"]})
    if {area["id"] for area in areas} != EXPECTED_DISTRICTS or len(areas) != 5:
        raise ValueError("All five American Samoa districts, including Rose and Swains, are required.")
    points = [point for polygon in polygons for ring in polygon for point in ring]
    bounds = [[min(point[1] for point in points), min(point[0] for point in points)],
              [max(point[1] for point in points), max(point[0] for point in points)]]
    geometry = {"type": "MultiPolygon", "coordinates": polygons}
    provenance = {"source": "Natural Earth", "sourceVersion": SOURCE_VERSION,
                  "sourceDataset": "10m Admin 1 states and provinces", "sourceLicense": "Public Domain",
                  "sourceUrl": SOURCE_URL, "sourceArchiveSha256": SOURCE_SHA256,
                  "sourceAreas": sorted(areas, key=lambda area: area["id"])}

    catalog_file = root / "world-region-catalog.js"
    catalog_text = catalog_file.read_text(encoding="utf-8")
    rows_start = catalog_text.index("=", catalog_text.index("export const WORLD_REGION_ROWS")) + 1
    rows = json.JSONDecoder().raw_decode(catalog_text[rows_start:].lstrip())[0]
    audit_file = root / "world-region-build.json"
    audit = json.loads(audit_file.read_text(encoding="utf-8"))
    audits = {parent["id"]: parent for parent in audit["parents"]}
    files = []
    for identity, kind, country_code, country in [("AS", "country", "AS", "American Samoa"),
                                                  ("US-AS", "state", "US", "United States")]:
        row = next(row for row in rows if row[0] == identity)
        if row[3] != kind or row[4] != country_code:
            raise ValueError(f"Unexpected existing catalog identity for {identity}.")
        filename = f"data/regions/{identity.lower()}.json"
        row[6] = filename
        record = {"id": identity, "name": row[1], "label": row[1] if kind == "country" else f"{row[1]}, {country}",
                  "kind": kind, "country": country, "countryCode": country_code,
                  "geometry": geometry, "bounds": bounds, **provenance,
                  "sourceShapeID": f"naturalearth-{SOURCE_VERSION}-{identity}", "matchedCatalog": True}
        content = encode({"version": "needmap-v2", "parentId": identity, "regions": [record]}) + "\n"
        (root / "public" / filename).write_text(content, encoding="utf-8")
        audits[identity] = {**audits.get(identity, {}), "id": identity, "name": row[1], "kind": kind,
            "countryCode": country_code, "sourceShapeID": record["sourceShapeID"], "matchedCatalog": True,
            "status": "whole_parent_local_supplement", "childCount": 0, "candidateUnits": 5,
            "file": filename, "bytes": len(content.encode("utf-8")), "source": "Natural Earth",
            "sourceVersion": SOURCE_VERSION, "elapsedMs": 0}
        files.append(filename)
    audit["parents"] = sorted(audits.values(), key=lambda item: item["id"])
    summary = audit["summary"]
    summary["files"] = summary["sourceParents"] = len(audit["parents"])
    summary["geometryBytes"] = sum(parent["bytes"] for parent in audit["parents"])
    summary["localCountryBoundaries"] = sum(row[3] == "country" and bool(row[6]) for row in rows)
    supplement = {**provenance, "regionIds": ["AS", "US-AS"], "files": files,
                  "coordinatePositions": len(points), "polygonParts": len(polygons), "bounds": bounds}
    audit["supplements"] = [item for item in audit.get("supplements", [])
                            if item.get("regionIds") != ["AS", "US-AS"]] + [supplement]
    summary["supplementalSources"] = [{"source": "Natural Earth", "sourceVersion": SOURCE_VERSION,
                                      "regionIds": ["AS", "US-AS"]}]
    catalog_file.write_text("// Generated offline; see WORLD-REGIONS.md. Do not edit rows by hand.\n"
        + f"export const WORLD_REGION_BUILD = Object.freeze({encode(summary)});\n"
        + f"export const WORLD_REGION_ROWS = {encode(rows)};\n", encoding="utf-8")
    audit_file.write_text(encode(audit) + "\n", encoding="utf-8")
    print(encode({"files": files, "districts": len(areas), "polygons": len(polygons),
                  "positions": len(points), "bounds": bounds, "totalBoundaryFiles": summary["files"]}))


if __name__ == "__main__":
    main()
