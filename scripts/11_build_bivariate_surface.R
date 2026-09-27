#!/usr/bin/env Rscript
suppressPackageStartupMessages({library(sf); library(data.table); library(jsonlite)})
source('R/analysis_helpers.R')
components <- readRDS('data/derived/component_scores.rds')
sections <- as.data.table(st_drop_geometry(readRDS('data/derived/section_scores.rds')))[,
  .(CUSEC, income_median_equivalised, income_mean_equivalised, income_mean_per_person)]
components <- merge(components, sections, by = 'CUSEC', all.x = TRUE, sort = FALSE)
summary <- read_json('frontend/public/data/analysis.json', simplifyVector = FALSE)$summaries
surface <- st_read('frontend/public/data/surface.geojson', quiet = TRUE)
xy <- st_coordinates(st_centroid(st_transform(surface, 25830)))
surface$gx <- floor(xy[, 1] / 2000) * 2000
surface$gy <- floor(xy[, 2] / 2000) * 2000
surface <- as.data.table(surface)
metrics <- c(median = 'income_median_equivalised', mean_equiv = 'income_mean_equivalised',
             mean_person = 'income_mean_per_person')
for (geo in c('region', 'city')) for (metric_name in names(metrics)) for (method in c('entrance', 'platform')) {
  metric <- metrics[[metric_name]]
  match_summary <- Filter(function(s) s$geography == geo && s$income_metric == metric && s$method == method, summary)
  if (length(match_summary) != 1L) stop('Missing summary: ', geo, ' ', metric, ' ', method)
  inc <- match_summary[[1]]$income_threshold
  rail <- match_summary[[1]]$score_threshold
  part <- if (geo == 'city') components[CUMUN == '28079'] else components
  part <- part[is.finite(get(metric)) & estimated_population > 0,
               .(gx = floor(x / 2000) * 2000, gy = floor(y / 2000) * 2000,
                 population = estimated_population,
                 quadrant = 2L * as.integer(get(metric) > inc) +
                            as.integer(get(paste0('rail_score_', method)) > rail))]
  modal <- part[, .(population = sum(population)), by = .(gx, gy, quadrant)]
  setorder(modal, gx, gy, -population, quadrant)
  modal <- modal[, .SD[1L], by = .(gx, gy)]
  name <- paste('four', metric_name, method, sep = '_')
  surface[geography == geo, (name) := modal$quadrant[match(paste(gx, gy), paste(modal$gx, modal$gy))]]
}
surface[, c('gx', 'gy') := NULL]
st_write(st_as_sf(surface), 'frontend/public/data/surface.geojson', driver = 'GeoJSON', delete_dsn = TRUE, quiet = TRUE)
st_write(st_as_sf(surface), 'data/interim/tile_sources/surface.geojsons', driver = 'GeoJSONSeq', delete_dsn = TRUE, quiet = TRUE)
tippecanoe <- Sys.which('tippecanoe')
if (!nzchar(tippecanoe)) stop('tippecanoe is required')
args <- c('--force', '--output', 'frontend/public/tiles/surface.pmtiles', '--layer', 'surface',
          '--minimum-zoom', '5', '--maximum-zoom', '12', '--no-feature-limit', '--no-tile-size-limit',
          'data/interim/tile_sources/surface.geojsons')
if (system2(tippecanoe, args) != 0) stop('Bivariate surface tippecanoe build failed')
message('Added building-derived modal Four Madrids categories to 2 km map surface')
