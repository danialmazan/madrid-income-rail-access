.PHONY: sources geography services scores aggregate tiles site validate all
sources:
	python3 scripts/01_fetch_sources.py
geography: sources
	Rscript scripts/02_prepare_geography.R
services: sources
	python3 scripts/03_build_services.py
scores: geography services
	Rscript scripts/04_score_components.R
aggregate: scores
	Rscript scripts/05_aggregate_publish.R
tiles: aggregate
	Rscript scripts/06_build_tiles.R
site: tiles
	npm ci --prefix frontend
	npm run build --prefix frontend
validate: site
	Rscript scripts/07_validate.R
	python3 scripts/08_write_results.py
all: validate
