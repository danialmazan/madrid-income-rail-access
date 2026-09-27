#!/usr/bin/env python3
"""Build gzip-compressed, spatially indexed component GeoJSON for file:// maps."""
from __future__ import annotations
import gzip
import json
import math
from pathlib import Path
import sqlite3

SOURCE = Path('data/interim/tile_sources/components.geojsons')
OUT = Path('frontend/public/data/component_chunks')
DATABASE = Path('data/interim/component_chunks.sqlite')
LON_STEP = 0.04
LAT_STEP = 0.03
EXPECTED = 644_613

def first_point(coordinates):
    part = coordinates
    while isinstance(part[0], list):
        part = part[0]
    return float(part[0]), float(part[1])

def main():
    if not SOURCE.exists():
        raise SystemExit('Build component tiles first')
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.geojson.gz'):
        old.unlink()
    if DATABASE.exists():
        DATABASE.unlink()
    db = sqlite3.connect(DATABASE)
    db.execute('PRAGMA journal_mode=OFF')
    db.execute('PRAGMA synchronous=OFF')
    db.execute('CREATE TABLE features (tx INTEGER, ty INTEGER, feature TEXT)')
    rows = []
    count = 0
    with SOURCE.open(encoding='utf-8') as stream:
        for raw in stream:
            raw = raw.lstrip('\x1e').strip()
            if not raw:
                continue
            feature = json.loads(raw)
            props = feature['properties']
            for key in ('income_median_equivalised', 'income_mean_equivalised', 'income_mean_per_person'):
                if key not in props:
                    raise ValueError(f'Missing {key} in component source')
            lon, lat = first_point(feature['geometry']['coordinates'])
            tx, ty = math.floor(lon / LON_STEP), math.floor(lat / LAT_STEP)
            rows.append((tx, ty, json.dumps(feature, ensure_ascii=False, separators=(',', ':'))))
            count += 1
            if len(rows) == 2000:
                db.executemany('INSERT INTO features VALUES (?,?,?)', rows)
                rows.clear()
    if rows:
        db.executemany('INSERT INTO features VALUES (?,?,?)', rows)
    db.commit()
    if count != EXPECTED:
        raise ValueError(f'Expected {EXPECTED} components, got {count}')
    db.execute('CREATE INDEX by_chunk ON features (tx, ty)')
    tiles = []
    for tx, ty, n in db.execute('SELECT tx, ty, count(*) FROM features GROUP BY tx, ty'):
        name = f'{tx}_{ty}.geojson.gz'
        path = OUT / name
        with path.open('wb') as file, gzip.GzipFile(fileobj=file, mode='wb', mtime=0, compresslevel=6) as zipped:
            zipped.write(b'{"type":"FeatureCollection","features":[')
            first = True
            for (feature,) in db.execute('SELECT feature FROM features WHERE tx=? AND ty=?', (tx, ty)):
                if not first:
                    zipped.write(b',')
                zipped.write(feature.encode('utf-8'))
                first = False
            zipped.write(b']}')
        tiles.append({'file': name, 'bbox': [tx * LON_STEP, ty * LAT_STEP,
                                              (tx + 1) * LON_STEP, (ty + 1) * LAT_STEP],
                      'count': n})
    (OUT / 'index.json').write_text(json.dumps({'version': 1, 'component_count': count,
                                                 'tiles': tiles}, separators=(',', ':')))
    db.close()
    DATABASE.unlink()
    print(f'Built {len(tiles)} indexed component chunks for {count:,} buildings')

if __name__ == '__main__':
    main()
