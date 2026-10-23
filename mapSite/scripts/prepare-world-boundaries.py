#!/usr/bin/env python3
"""Convert pinned geoBoundaries CGAZ GeoPackages into small offline build inputs.

Requires Shapely 2. Source GeoPackages remain build inputs, never browser assets.
Run with ADM1.gpkg ADM2.gpkg output-directory. Every omitted/repaired source
record is recorded in prepare-manifest.json; no geographical area is invented.
"""
import collections
import hashlib
import json
import pathlib
import sqlite3
import sys

from shapely import from_wkb, make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, mapping


def polygonal(geometry):
    if geometry.geom_type in ("Polygon", "MultiPolygon"):
        return geometry
    polygons = []
    for part in getattr(geometry, "geoms", []):
        result = polygonal(part)
        if result.geom_type == "Polygon":
            polygons.append(result)
        elif result.geom_type == "MultiPolygon":
            polygons.extend(result.geoms)
    return MultiPolygon(polygons) if polygons else GeometryCollection()


def decode(blob):
    if blob[:2] != b"GP":
        raise ValueError("Not a GeoPackage geometry")
    envelope = (blob[3] >> 1) & 7
    size = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get(envelope)
    if size is None:
        raise ValueError("Unknown GeoPackage envelope")
    return from_wkb(blob[8 + size:])


def rounded(value):
    if isinstance(value, (tuple, list)):
        return [rounded(item) for item in value]
    return round(value, 6)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    first, second, destination = map(pathlib.Path, sys.argv[1:4])
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {"source": "geoBoundaries CGAZ", "simplificationDegrees": 0.001,
                "coordinateDecimals": 6, "inputs": [], "adjustments": []}
    for level, source in ((1, first), (2, second)):
        connection = sqlite3.connect(source)
        table = f"globalADM{level}"
        manifest["inputs"].append({"level": level, "filename": source.name,
            "bytes": source.stat().st_size, "sha256": hashlib.file_digest(source.open("rb"), "sha256").hexdigest(),
            "records": connection.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]})
        groups = collections.defaultdict(list)
        for name, identity, country, kind, blob in connection.execute(
                f'SELECT shapeName,shapeID,shapeGroup,shapeType,geom FROM "{table}" ORDER BY shapeGroup,shapeID'):
            entry = {"level": level, "shapeID": identity, "shapeGroup": country, "shapeName": name, "shapeType": kind}
            try:
                geometry = decode(blob)
                if not geometry.is_valid:
                    geometry = polygonal(make_valid(geometry))
                    manifest["adjustments"].append({**entry, "action": "repaired_invalid_geometry"})
                geometry = polygonal(geometry.simplify(0.001, preserve_topology=True))
                if geometry.is_empty:
                    manifest["adjustments"].append({**entry, "action": "empty_polygon_omitted"})
                    continue
                if not name:
                    name = f"Administrative area {identity}"
                    manifest["adjustments"].append({**entry, "action": "missing_name_labeled_by_source_id"})
                coordinates = mapping(geometry)
                feature = {"type": "Feature", "properties": {"shapeName": name, "shapeID": identity,
                    "shapeGroup": country, "shapeType": kind},
                    "geometry": {"type": coordinates["type"], "coordinates": rounded(coordinates["coordinates"])},
                    "bbox": list(geometry.bounds)}
                groups[country].append(feature)
            except Exception as error:
                manifest["adjustments"].append({**entry, "action": "unreadable_geometry_omitted", "error": str(error)})
        for country, features in groups.items():
            write_json(destination / f"{country}-ADM{level}.json", {"type": "FeatureCollection", "features": features})
        manifest[f"adm{level}"] = {"groups": len(groups), "features": sum(map(len, groups.values())),
            "counts": {country: len(features) for country, features in groups.items()}}
        print(json.dumps({"level": level, "groups": len(groups), "features": manifest[f"adm{level}"]["features"]}), flush=True)
    write_json(destination / "prepare-manifest.json", manifest)


if __name__ == "__main__":
    main()
