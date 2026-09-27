#!/usr/bin/env Rscript
suppressPackageStartupMessages({library(sf); library(data.table); library(jsonlite); library(yaml)})
cfg <- yaml::read_yaml("config.yml")
rail <- Sys.getenv("RAIL_DENSITY_ROOT", cfg$project$rail_density_root)
origins <- readRDS(file.path(rail, "data/derived/stations/station_origins_phase7.rds"))
stations <- readRDS(file.path(rail, "data/derived/stations/canonical_stations.rds"))
services <- unique(fread("data/derived/station_lines.csv", colClasses = "character")[,
  .(station_id, line_id)])
bridge <- unique(fread("data/derived/platform_lines.csv", colClasses = "character")[,
  .(origin_id = platform_id, station_id, line_id)])
xy <- st_coordinates(origins)
lonlat <- st_coordinates(st_transform(origins, 4326))
base <- data.table(origin_id = origins$origin_id, station_id = origins$station_id,
  method = origins$point_method, x = xy[, 1], y = xy[, 2],
  lon = lonlat[, 1], lat = lonlat[, 2])
base[, name := stations$station_name[match(station_id, stations$station_id)]]
entry <- merge(base[method == "entrance"], services, by = "station_id", allow.cartesian = TRUE)
platform <- merge(base[method == "platform"], bridge,
  by = c("origin_id", "station_id"), allow.cartesian = TRUE)
published <- unique(rbindlist(list(entry, platform), use.names = TRUE))
setorder(published, method, line_id, station_id, origin_id)
if (anyNA(published$name) || uniqueN(published$line_id) != 27L ||
    uniqueN(published[method == "entrance", station_id]) != 357L)
  stop("Score-origin publication failed its service coverage check")
payload <- list(meta = list(crs = 25830, rail_snapshot = cfg$project$rail_snapshot,
                            methods = c("entrance", "platform"),
                            score = cfg$score[c("d50_m", "p", "duplicate_factor",
                              "protected_line_count", "protected_distance_floor_m",
                              "tail_cap_multiplier")]),
  origins = published[, .(origin_id, station_id, name, method, line_id, x, y, lon, lat)])
dir.create("frontend/public/data", recursive = TRUE, showWarnings = FALSE)
json_path <- "frontend/public/data/score_origins.json"
write_json(payload, json_path, auto_unbox = TRUE, digits = 10, pretty = FALSE)
gz <- gzfile("frontend/public/data/score_origins.json.gz", "wb")
writeBin(readBin(json_path, "raw", n = file.info(json_path)$size), gz)
close(gz)
message("Published ", nrow(published), " line-specific score origins")
