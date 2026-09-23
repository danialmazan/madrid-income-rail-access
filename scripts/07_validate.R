#!/usr/bin/env Rscript
suppressPackageStartupMessages({library(sf); library(data.table); library(yaml); library(jsonlite)})
source("R/analysis_helpers.R")
cfg <- yaml::read_yaml("config.yml")
rail <- Sys.getenv("RAIL_DENSITY_ROOT", cfg$project$rail_density_root)
stopifnot(file.exists("frontend/public/data/analysis.json"),
          file.exists("frontend/public/tiles/components.pmtiles"),
          file.exists("frontend/public/tiles/surface.pmtiles"),
          file.exists("frontend/public/tiles/stations.pmtiles"))
geo <- readRDS("data/derived/sections_2024_income.rds")
sections <- readRDS("data/derived/section_scores.rds")
components <- readRDS("data/derived/component_scores.rds")
services <- fread("data/derived/station_lines.csv", colClasses = "character")
bridge <- fread("data/derived/platform_lines.csv", colClasses = "character")
audit <- read_json("validation/generated/geography_audit.json", simplifyVector = TRUE)
station_audit <- read_json("validation/generated/station_line_audit.json", simplifyVector = TRUE)
stopifnot(nrow(sections) == 4480L, nrow(components) == 644613L,
          identical(sections$CUSEC, geo$CUSEC),
          abs(sum(components$estimated_population) - audit$total_population) < 1e-5,
          abs(sum(sections$section_population) - sum(components$estimated_population)) < 1e-6,
          !anyDuplicated(components$component_key), !anyDuplicated(sections$CUSEC),
          nrow(services) == station_audit$confirmed_station_line_rows,
          nrow(bridge) == station_audit$platform_line_rows,
          !anyDuplicated(services[, .(station_id, line_id)]),
          !anyDuplicated(bridge[, .(station_id, line_id, platform_id)]),
          nrow(services[unique(bridge[, .(station_id, line_id)]), on = .(station_id, line_id), nomatch = 0L]) ==
            uniqueN(bridge[, .(station_id, line_id)]),
          all(is.finite(components$rail_score_entrance)),
          all(is.finite(components$rail_score_platform)))
for (metric in c("income_median_equivalised", "income_mean_equivalised", "income_mean_per_person")) {
  missing <- !is.finite(sections[[metric]])
  recorded <- audit$missing_income[audit$missing_income$metric == metric, ]
  stopifnot(sum(missing) == recorded$sections,
            abs(sum(sections$section_population[missing]) - recorded$population) < 1e-6)
}
section_score_error <- 0
for (method in c("entrance", "platform")) {
  col <- paste0("rail_score_", method)
  recalculated <- components[, .(score = weighted.mean(get(col), estimated_population)), by = CUSEC]
  delta <- max(abs(sections[[col]] - recalculated$score[match(sections$CUSEC, recalculated$CUSEC)]))
  section_score_error <- max(section_score_error, delta)
  if (!is.finite(delta) || delta > 1e-9) stop("Section weighted score mismatch: ", method)
}

origins <- readRDS(file.path(rail, "data/derived/stations/station_origins_phase7.rds"))
xy <- st_coordinates(origins)
sample_rows <- unique(c(1L, 125L, 3981L, 120000L, 300000L, 644613L))
sample_lines <- c("M1", "M2", "M3", "M10", "C1", "C4", "ML1", "TP")
for (method in c("entrance", "platform")) for (line in sample_lines) {
  stations <- services[line_id == line, station_id]
  ids <- if (method == "platform") bridge[line_id == line, unique(platform_id)] else character()
  keep <- if (method == "entrance") origins$point_method == "entrance" & origins$station_id %in% stations else
    origins$point_method == "platform" & origins$origin_id %in% ids
  o <- which(keep)
  saved <- readRDS(file.path("data/interim/line_distances", method, paste0(line, ".rds")))[sample_rows, ]
  for (j in seq_along(sample_rows)) {
    row <- sample_rows[j]
    d <- sqrt((xy[o, 1] - components$x[row])^2 + (xy[o, 2] - components$y[row])^2)
    full <- data.table(station_id = origins$station_id[o], distance_m = d)[, .(distance_m = min(distance_m)), by = station_id]
    setorder(full, distance_m, station_id)
    stopifnot(identical(saved$first_station_id[j], full$station_id[1]),
              abs(saved$first_distance_m[j] - full$distance_m[1]) < 1e-7)
    if (nrow(full) > 1L) stopifnot(identical(saved$second_station_id[j], full$station_id[2]),
                                 abs(saved$second_distance_m[j] - full$distance_m[2]) < 1e-7)
  }
}

analysis <- read_json("frontend/public/data/analysis.json", simplifyVector = TRUE)
stopifnot(nrow(analysis$sections) == nrow(sections),
          nrow(analysis$deciles) == 120L,
          nrow(analysis$quintiles) == 60L,
          nrow(analysis$smoothers) == 720L,
          all(analysis$deciles$population_share > 0),
          all(analysis$quintiles$population_share > 0))
for (geography in c("region", "city")) for (metric in c("income_median_equivalised", "income_mean_equivalised", "income_mean_per_person")) {
  for (method in c("entrance", "platform")) {
    g_name <- geography; m_name <- metric; method_name <- method
    d <- as.data.table(analysis$deciles)[geography == g_name & income_metric == m_name & method == method_name]
    q <- as.data.table(analysis$quintiles)[geography == g_name & income_metric == m_name & method == method_name]
    stopifnot(nrow(d) == 10L, nrow(q) == 5L,
              abs(sum(d$population_share) - 1) < 1e-8,
              abs(sum(q$population_share) - 1) < 1e-8,
              max(abs(d$population_share - .1)) < .025,
              max(abs(q$population_share - .2)) < .025)
    curves <- as.data.table(analysis$cdfs)[geography == g_name & income_metric == m_name & method == method_name]
    stopifnot(curves[, all(diff(share) >= -1e-12), by = group][, all(V1)],
              curves[, all(abs(tail(share, 1) - 1) < 1e-8), by = group][, all(V1)])
  }
}

bad_examples <- data.table(station_id = c("crtm_interchange_064", "crtm_interchange_280", "crtm_interchange_280"), line_id = c("M2", "M3", "M10"))
stopifnot(nrow(services[bad_examples, on = .(station_id, line_id), nomatch = 0L]) == 0L)
report <- list(section_count = nrow(sections), component_count = nrow(components), population = sum(components$estimated_population),
               station_line_pairs = nrow(services), platform_line_pairs = nrow(bridge),
               exact_distance_spot_checks = length(sample_rows) * length(sample_lines) * 2L,
               max_section_score_error = section_score_error, status = "pass")
write_json(report, "validation/generated/validation_report.json", pretty = TRUE, auto_unbox = TRUE)
message("Validation passed: ", report$exact_distance_spot_checks, " brute-force distance checks; 12 grouped views")
