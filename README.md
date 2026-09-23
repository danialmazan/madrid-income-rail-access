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
npm ci --prefix frontend
npm run build --prefix frontend
Rscript scripts/07_validate.R
python3 scripts/08_write_results.py
```

The raw, interim, derived, validation, and frontend assets are generated locally. Source downloads are cached and checksummed. The site build is in `site/`. No release or website publication is performed by these commands.

[Methodology](METHODOLOGY.md) documents sources, keys, assumptions, and limits. [Results](RESULTS.md) is regenerated from the section and sensitivity outputs. The browser checks are available with `npm run test:e2e --prefix frontend` after the data and tiles have been built.

Income is an area measure. Component income labels are inherited only for mapping; comparisons use one observation per 2024 census section. Population is modelled from the Rail Density 2025 allocation. Distances are straight-line EPSG:25830 distances, not walking routes. The Rail Access Score is a constructed index, not an INE or CRTM statistic.
