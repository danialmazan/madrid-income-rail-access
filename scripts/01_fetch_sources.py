#!/usr/bin/env python3
"""Cache official INE/CRTM data and a source-hash manifest."""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw"
RAW.mkdir(parents=True, exist_ok=True)
RAIL = Path(os.environ.get("RAIL_DENSITY_ROOT", ROOT.parent / "rail_density"))
BASE = "https://services5.arcgis.com/UxADft6QPcvFyDU1/arcgis/rest/services"
FILES = {
    "ine_adrh_madrid_31097.csv": "https://www.ine.es/jaxiT3/files/t/es/csv_bd/31097.csv",
    "seccionado_2024.zip": "https://www.ine.es/prodyser/cartografia/seccionado_2024.zip",
}


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


for name, url in FILES.items():
    path = RAW / name
    if not path.exists():
        print("Downloading", url, flush=True)
        with urlopen(url, timeout=120) as src, open(path.with_suffix(path.suffix + ".part"), "wb") as out:
            for block in iter(lambda: src.read(1024 * 1024), b""):
                out.write(block)
        path.with_suffix(path.suffix + ".part").replace(path)

for code in ("M4", "M5", "M10"):
    path = RAW / f"{code}_paradas_por_itinerario.json"
    if path.exists():
        continue
    rows = []
    offset = 0
    while True:
        params = urlencode({
            "where": "1=1", "outFields": "*", "returnGeometry": "false",
            "resultOffset": offset, "resultRecordCount": 1000, "f": "json",
        })
        url = f"{BASE}/{code}_Red/FeatureServer/5/query?{params}"
        with urlopen(url, timeout=60) as src:
            payload = json.load(src)
        if "error" in payload:
            raise RuntimeError(payload["error"])
        batch = [item["attributes"] for item in payload["features"]]
        rows.extend(batch)
        offset += len(batch)
        if len(batch) < 1000:
            break
    path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(code, len(rows), "itinerary rows", flush=True)

rail_inputs = [
    "data/derived/building_population/component_population_2025.rds",
    "data/derived/stations/canonical_stations.rds",
    "data/derived/stations/station_origins_phase7.rds",
    "data/derived/stations/station_platforms.csv",
    "data/derived/stations/station_services.csv",
    "data/interim/phase3/station_source_records.csv",
]
manifest = {
    "manifest_generated_utc": datetime.now(timezone.utc).isoformat(),
    "income_year": 2023, "income_geography": "2024-01-01",
    "population_geography": "2025-01-01", "rail_snapshot": "2026-09-15",
    "inputs": {},
}
geometry_files = sorted((RAIL / "data/interim/phase2/components_by_municipality").glob("components_*.rds"))
for path in [*RAW.iterdir(), *(RAIL / p for p in rail_inputs), *geometry_files]:
    if path.is_file() and not path.name.endswith(".part") and path.name != "source_manifest.json":
        manifest["inputs"][str(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path)] = {
            "sha256": digest(path), "bytes": path.stat().st_size,
            "local_file_mtime_utc": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
        }
(RAW / "source_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print("Source manifest written")
