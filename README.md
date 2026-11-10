# Madrid income and rail access

A reproducible, bilingual spatial analysis of 2023 census-section income and modelled access to rail lines in the Comunidad de Madrid. The source population and rail snapshots come from the sibling `rail_density` project. The article uses the Red Margin style kit.

## Build

Requirements: R with `sf`, `terra`, `data.table`, `jsonlite`, and `yaml`; Python 3; Node/npm; and `tippecanoe`. Set `RAIL_DENSITY_ROOT` to override the default sibling repository.

```sh
python3 scripts/01_fetch_sources.py
Rscript scripts/02_prepare_geography.R
python3 scripts/03_build_services.py
Rscript scripts/04_score_components.R
Rscript scripts/05_aggregate_publish.R
Rscript scripts/06_build_tiles.R
Rscript scripts/12_publish_score_origins.R
Rscript scripts/11_build_bivariate_surface.R
python3 scripts/10_build_component_chunks.py
Rscript scripts/09_select_examples.R
make local-roads
npm ci --prefix frontend
npm run build --prefix frontend
Rscript scripts/13_test_tail_score.R
Rscript scripts/07_validate.R
python3 scripts/08_write_results.py
```

The raw, interim, derived, validation, and frontend assets are generated locally. If the component and station inputs have not changed, `SCORE_REUSE_DISTANCES=1 Rscript scripts/04_score_components.R` reuses the validated per-line distance tables for a scoring-formula rebuild; omit that flag when upstream geometry or station data changes. Source downloads are cached and checksummed. The site build is in `site/`. Building and publishing the site are separate steps. Use an HTTP preview (`npm run preview --prefix frontend`) for the MapLibre PMTiles map. When opened directly as `site/index.html`, the page loads nearby building polygons from spatially indexed gzip chunks, with a 2 km generalisation at wide zoom. Section 7 uses Photon address suggestions. Its HTTP map uses OpenFreeMap streets; direct-file viewing uses small local street chunks built from the Geofabrik Madrid OSM extract, so the street map and building selection do not depend on remote map tiles. Address search itself still requires network access. The local road index records the source URL and SHA-256; map attribution credits OpenStreetMap contributors and Geofabrik. The OpenFreeMap Liberty style is bundled locally for faster HTTP startup, and its upstream license notice is copied to `site/OPENFREEMAP_LICENSE.md`. Score origins are published as JSON and gzip JSON, with the compressed copy used by the address tool.

## Publication

GitHub Pages deploys the generated `site/` directory from a `site.tar.gz` release asset. The generated data and the building PMTiles file are too large to keep in the source Git history. After a validated build, package the contents of `site/` at the archive root, create a new release with that asset, then run the Pages workflow on `main` (`gh workflow run pages.yml --ref main`). The project inherits `danielalmazan.com` from the account's main Pages site and is served at `/madrid-income-rail-access/`.

[Methodology](METHODOLOGY.md) documents sources, keys, assumptions, and limits. [Results](RESULTS.md) is regenerated from the section and sensitivity outputs. The browser checks are available with `npm run test:e2e --prefix frontend` after the data and tiles have been built.

Income is an area measure. Component income labels are inherited only for mapping; comparisons use one observation per 2024 census section. Population is modelled from the Rail Density 2025 allocation. Distances are straight-line EPSG:25830 distances, not walking routes. The Rail Access Score is a constructed index, not an INE or CRTM statistic.

## Web analytics

The HTML entry point (`frontend/index.html`) loads the supplied Cloudflare Web Analytics module once before the closing body tag. Future production builds retain that installation. The analytics-only `analytics-2026-11-10` release keeps the existing application and data files; only its `index.html` content changed. Deployment continues through the existing release-archive Pages workflow.
