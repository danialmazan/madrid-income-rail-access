#!/usr/bin/env python3
"""Resolve actual boarding lines using CRTM itinerary-platform links."""
import csv
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAIL = Path(os.environ.get("RAIL_DENSITY_ROOT", ROOT.parent / "rail_density"))
OUT = ROOT / "data/derived"
VAL = ROOT / "validation/generated"
OUT.mkdir(parents=True, exist_ok=True)
VAL.mkdir(parents=True, exist_ok=True)


def read_csv(path):
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path, rows, fields):
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def line_id(code, label):
    value = label.strip().upper()
    if code == "M4":
        return "MR" if value == "R" else "M" + re.match(r"\d+", value).group()
    if code == "M10":
        return "TP" if value.startswith("4") else "ML" + re.match(r"\d+", value).group()
    match = re.match(r"C-?(\d+)([AB])?", value)
    if not match:
        raise ValueError(f"Unexpected Cercanías line: {label}")
    number, branch = match.groups()
    return "C" + number + (branch or "" if number == "8" else "")


services = read_csv(RAIL / "data/derived/stations/station_services.csv")
service_by_key = {(row["station_id"], row["line_id"]): row for row in services}
platforms = read_csv(RAIL / "data/derived/stations/station_platforms.csv")
platform_by_key = {(row["source_code"], row["source_platform_id"]): row for row in platforms}
links = {}
unmatched = []
for code in ("M4", "M5", "M10"):
    rows = json.loads((ROOT / f"data/raw/{code}_paradas_por_itinerario.json").read_text(encoding="utf-8"))
    for row in rows:
        if row["FECHAFIN"] and row["FECHAFIN"] < "20260915":
            continue
        platform = platform_by_key.get((code, row["IDFANDEN"]))
        if not platform:
            unmatched.append({"source_code": code, "source_platform_id": row["IDFANDEN"], "reason": "out_of_scope_platform"})
            continue
        if row["IDFESTACION"] != platform["source_station_id"]:
            raise ValueError(f"Platform-station mismatch: {code} {row['IDFANDEN']}")
        line = line_id(code, row["NUMEROLINEAUSUARIO"])
        key = (platform["station_id"], line)
        if key not in service_by_key:
            raise ValueError(f"Itinerary line absent from source station services: {key}")
        bridge = {
            "platform_id": platform["platform_id"], "station_id": platform["station_id"],
            "line_id": line, "mode": service_by_key[key]["mode"],
            "source_code": code, "source_station_id": row["IDFESTACION"],
        }
        links[(bridge["platform_id"], bridge["line_id"])] = bridge

covered = {(row["station_id"], row["line_id"]) for row in links.values()}
missing = sorted(set(service_by_key) - covered)
expected = {
    ("crtm_interchange_064", "M2"),
    ("crtm_interchange_280", "M3"),
    ("crtm_interchange_280", "M10"),
}
if missing != sorted(expected):
    raise ValueError(f"Unexpected missing platform services: {missing}")
station_rows = [service_by_key[key] for key in sorted(covered)]
platform_rows = [links[key] for key in sorted(links)]
write_csv(OUT / "station_lines.csv", station_rows, list(services[0]))
write_csv(OUT / "platform_lines.csv", platform_rows, list(platform_rows[0]))
write_csv(VAL / "itinerary_unmatched.csv", unmatched, ["source_code", "source_platform_id", "reason"])
(VAL / "station_line_audit.json").write_text(json.dumps({
    "original_station_line_rows": len(service_by_key), "confirmed_station_line_rows": len(covered),
    "platform_line_rows": len(platform_rows), "excluded_source_listings": missing,
    "reason": "Source LINEAS includes connected transfer lines at Plaza de España and Noviciado; itinerary boarding links do not confirm these three station-line pairs."
}, indent=2) + "\n", encoding="utf-8")
print(f"Confirmed {len(covered)} station-line services from {len(platform_rows)} platform-line links")

