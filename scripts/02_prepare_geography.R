#!/usr/bin/env Rscript
suppressPackageStartupMessages({library(sf); library(data.table); library(yaml); library(jsonlite)})
cfg <- yaml::read_yaml("config.yml")
rail <- Sys.getenv("RAIL_DENSITY_ROOT", cfg$project$rail_density_root)
dir.create("data/interim", recursive = TRUE, showWarnings = FALSE)
dir.create("data/derived", recursive = TRUE, showWarnings = FALSE)
dir.create("validation/generated", recursive = TRUE, showWarnings = FALSE)

raw <- fread("data/raw/ine_adrh_madrid_31097.csv", sep = "\t", colClasses = "character", encoding = "UTF-8", na.strings = c("", "."))
names(raw) <- sub("^\ufeff", "", names(raw))
indicator_col <- "Indicadores de renta media y mediana"
labels <- c(
  "Mediana de la renta por unidad de consumo" = "income_median_equivalised",
  "Media de la renta por unidad de consumo" = "income_mean_equivalised",
  "Renta neta media por persona" = "income_mean_per_person"
)
income <- raw[Periodo == "2023" & !is.na(Secciones) & get(indicator_col) %in% names(labels),
  .(CUSEC = substr(Secciones, 1, 10), metric = unname(labels[get(indicator_col)]), value = Total)]
income[, value := fifelse(is.na(value), NA_real_, as.numeric(gsub(".", "", value, fixed = TRUE)))]
if (anyDuplicated(income[, .(CUSEC, metric)])) stop("Duplicate ADRH section-metric row")
income <- dcast(income, CUSEC ~ metric, value.var = "value")
if (any(nchar(income$CUSEC) != 10L)) stop("Invalid CUSEC in ADRH")

archive <- "data/raw/seccionado_2024.zip"
extracted <- "data/interim/seccionado_2024"
if (!file.exists(file.path(extracted, "SECC_CE_20240101.shp"))) {
  dir.create(extracted, recursive = TRUE, showWarnings = FALSE)
  unzip(archive, exdir = extracted, junkpaths = TRUE)
}
sections <- st_read(file.path(extracted, "SECC_CE_20240101.shp"), quiet = TRUE, stringsAsFactors = FALSE)
sections <- sections[trimws(as.character(sections$CPRO)) == "28", ]
sections$CUSEC <- trimws(as.character(sections$CUSEC))
sections$CUMUN <- trimws(as.character(sections$CUMUN))
sections$NMUN <- trimws(as.character(sections$NMUN))
if (st_crs(sections)$epsg != cfg$project$crs) sections <- st_transform(sections, cfg$project$crs)
if (nrow(sections) != 4480L || anyDuplicated(sections$CUSEC)) stop("2024 section geography changed")
sections <- merge(sections[, c("CUSEC", "CUMUN", "NMUN")], income, by = "CUSEC", all.x = TRUE, sort = FALSE)
if (nrow(sections) != 4480L) stop("Income join changed section count")

points <- readRDS(file.path(rail, "data/derived/building_population/component_population_2025.rds"))
if (st_crs(points)$epsg != cfg$project$crs) points <- st_transform(points, cfg$project$crs)
if (nrow(points) != 644613L || anyDuplicated(points$component_key)) stop("Rail Density component contract changed")
message("Assigning ", nrow(points), " components to 2024 income geography")
hits <- st_within(points, sections)
idx <- vapply(hits, function(v) if(length(v)) v[1] else NA_integer_, integer(1))
multiple <- lengths(hits) > 1L
nearest <- is.na(idx)
nearest_m <- numeric(length(idx))
if (any(nearest)) {
  candidate <- st_nearest_feature(points[nearest, ], sections)
  nearest_m[nearest] <- as.numeric(st_distance(points[nearest, ], sections[candidate, ], by_element = TRUE))
  idx[nearest] <- candidate
}
if (anyNA(idx)) stop("Unassigned components")
xy <- st_coordinates(points)
component <- as.data.table(st_drop_geometry(points))[, .(
  component_key, estimated_population, source_CUSEC_2025 = CUSEC,
  support_type, nearest_section_assignment
)]
component[, `:=`(
  CUSEC = sections$CUSEC[idx], CUMUN = sections$CUMUN[idx],
  x = xy[, 1], y = xy[, 2], section_2024_nearest = nearest,
  section_2024_nearest_m = nearest_m, section_2024_multiple_hits = multiple
)]
if (any(component$estimated_population < -1e-8) || anyNA(component$estimated_population)) stop("Invalid component population")
original_total <- sum(points$estimated_population)
if (abs(sum(component$estimated_population) - original_total) > 1e-6) stop("Population changed during section assignment")
population <- component[, .(section_population = sum(estimated_population), components = .N,
  nearest_components = sum(section_2024_nearest)), by = CUSEC]
sections <- merge(sections, population, by = "CUSEC", all.x = TRUE, sort = FALSE)
sections$section_population[is.na(sections$section_population)] <- 0
sections$components[is.na(sections$components)] <- 0L
sections$nearest_components[is.na(sections$nearest_components)] <- 0L
if (abs(sum(sections$section_population) - original_total) > 1e-6) stop("2024 section population does not reconcile")

saveRDS(component, "data/interim/component_section_2024.rds", compress = "gzip")
saveRDS(sections, "data/derived/sections_2024_income.rds", compress = "gzip")
fwrite(st_drop_geometry(sections), "data/derived/sections_2024_income.csv")
fwrite(component[section_2024_nearest == TRUE, .(component_key, source_CUSEC_2025, CUSEC, section_2024_nearest_m)],
       "validation/generated/nearest_2024_section_assignments.csv")
audit <- list(
  section_count = nrow(sections), component_count = nrow(component), total_population = original_total,
  nearest_2024_assignments = sum(nearest), multiple_2024_hits = sum(multiple),
  missing_income = lapply(names(labels), function(label) {
    key <- unname(labels[label]); missing <- is.na(sections[[key]])
    list(metric = key, sections = sum(missing), population = sum(sections$section_population[missing]))
  })
)
write_json(audit, "validation/generated/geography_audit.json", pretty = TRUE, auto_unbox = TRUE)
message("Prepared ", nrow(sections), " 2024 sections; population ", round(original_total), "; nearest assignments ", sum(nearest))

