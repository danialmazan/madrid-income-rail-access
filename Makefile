.PHONY: sources geography services origins scores aggregate examples tiles bivariate-surface chunks local-roads site validate all
sources:
	python3 scripts/01_fetch_sources.py
geography: sources
	Rscript scripts/02_prepare_geography.R
services: sources
	python3 scripts/03_build_services.py
origins: services
	Rscript scripts/12_publish_score_origins.R
scores: geography services
	Rscript scripts/04_score_components.R
aggregate: scores
	Rscript scripts/05_aggregate_publish.R
examples: scores
	Rscript scripts/09_select_examples.R
tiles: aggregate
	Rscript scripts/06_build_tiles.R
bivariate-surface: tiles
	Rscript scripts/11_build_bivariate_surface.R
chunks: bivariate-surface
	python3 scripts/10_build_component_chunks.py
data/raw/madrid-latest.osm.pbf:
	mkdir -p data/raw
	curl -L --fail --silent --show-error -o $@.tmp https://download.geofabrik.de/europe/spain/madrid-latest.osm.pbf
	mv $@.tmp $@
local-roads: data/raw/madrid-latest.osm.pbf
	Rscript scripts/14_extract_local_roads.R
	python3 scripts/15_chunk_local_roads.py
site: chunks examples origins local-roads
	npm ci --prefix frontend
	npm run build --prefix frontend
validate: site
	Rscript scripts/13_test_tail_score.R
	Rscript scripts/07_validate.R
	python3 scripts/08_write_results.py
all: validate
