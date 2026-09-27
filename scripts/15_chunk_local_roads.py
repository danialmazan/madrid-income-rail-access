#!/usr/bin/env python3
"""Split the Geofabrik Madrid road extract into small local SVG-map chunks."""
import gzip
import hashlib
import json
import math
from collections import OrderedDict, defaultdict
from pathlib import Path

SOURCE = Path("data/interim/madrid_local_roads.geojsonl")
SOURCE_PBF = Path("data/raw/madrid-latest.osm.pbf")
SOURCE_URL = "https://download.geofabrik.de/europe/spain/madrid-latest.osm.pbf"
OUTPUT = Path("frontend/public/data/local_roads")
SCRATCH = Path("data/interim/local_roads_chunks")
TILE_DEGREES = 0.02
MAX_OPEN = 64
MAJOR = {"motorway", "trunk", "primary", "secondary", "tertiary",
         "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
PATH = {"footway", "path", "cycleway", "steps", "track"}


def tile_range(coords):
    points = [point for line in coords for point in line]
    return (range(math.floor(min(p[0] for p in points) / TILE_DEGREES),
                  math.floor(max(p[0] for p in points) / TILE_DEGREES) + 1),
            range(math.floor(min(p[1] for p in points) / TILE_DEGREES),
                  math.floor(max(p[1] for p in points) / TILE_DEGREES) + 1))


def main():
    if not SOURCE.exists():
        raise SystemExit(f"Missing {SOURCE}; run scripts/14_extract_local_roads.R")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    SCRATCH.mkdir(parents=True, exist_ok=True)
    handles = OrderedDict()
    counts = defaultdict(int)
    with SOURCE.open(encoding="utf-8") as source:
        for raw in source:
            feature = json.loads(raw)
            geometry = feature["geometry"]
            if geometry is None:
                continue
            lines = ([geometry["coordinates"]] if geometry["type"] == "LineString"
                     else geometry["coordinates"] if geometry["type"] == "MultiLineString" else [])
            if not lines:
                continue
            kind = feature["properties"]["highway"]
            category = "major" if kind in MAJOR else "path" if kind in PATH else "street"
            record = json.dumps([category, feature["properties"].get("name"), lines],
                                ensure_ascii=False, separators=(",", ":")) + "\n"
            xs, ys = tile_range(lines)
            for tx in xs:
                for ty in ys:
                    key = f"{tx}_{ty}"
                    if key not in handles:
                        if len(handles) >= MAX_OPEN:
                            _, old = handles.popitem(last=False)
                            old.close()
                        handles[key] = (SCRATCH / f"{key}.jsonl").open("a", encoding="utf-8")
                    handles.move_to_end(key)
                    handles[key].write(record)
                    counts[key] += 1
    for handle in handles.values():
        handle.close()
    tiles = []
    for key in sorted(counts):
        tx, ty = map(int, key.split("_"))
        raw_path = SCRATCH / f"{key}.jsonl"
        with raw_path.open("rb") as source, (OUTPUT / f"{key}.jsonl.gz").open("wb") as target:
            target.write(gzip.compress(source.read(), compresslevel=7, mtime=0))
        raw_path.unlink()
        tiles.append({"key": key, "bbox": [tx * TILE_DEGREES, ty * TILE_DEGREES,
                                             (tx + 1) * TILE_DEGREES, (ty + 1) * TILE_DEGREES],
                      "count": counts[key]})
    SCRATCH.rmdir()
    digest = hashlib.sha256()
    with SOURCE_PBF.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    (OUTPUT / "index.json").write_text(json.dumps({"tile_degrees": TILE_DEGREES,
                                                    "source": SOURCE_URL,
                                                    "source_sha256": digest.hexdigest(),
                                                    "tiles": tiles}, separators=(",", ":")),
                                        encoding="utf-8")
    print(f"Published {sum(counts.values()):,} road appearances in {len(tiles):,} tiles")


if __name__ == "__main__":
    main()
