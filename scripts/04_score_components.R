#!/usr/bin/env Rscript
suppressPackageStartupMessages({library(sf); library(terra); library(data.table); library(yaml); library(jsonlite)})
cfg <- yaml::read_yaml("config.yml")
source("R/score_tail.R")
rail <- Sys.getenv("RAIL_DENSITY_ROOT", cfg$project$rail_density_root)
component <- readRDS("data/interim/component_section_2024.rds")
if (nrow(component) != 644613L && Sys.getenv("SCORE_LIMIT") == "") stop("Component contract changed")
if (nzchar(Sys.getenv("SCORE_LIMIT"))) component <- component[seq_len(min(nrow(component), as.integer(Sys.getenv("SCORE_LIMIT"))))]
services <- fread("data/derived/station_lines.csv", colClasses = "character")
bridge <- fread("data/derived/platform_lines.csv", colClasses = "character")
origins <- readRDS(file.path(rail, "data/derived/stations/station_origins_phase7.rds"))
if (st_crs(origins)$epsg != cfg$project$crs) stop("Origin CRS mismatch")
origin_xy <- st_coordinates(origins)
platform_by_id <- split(seq_len(nrow(origins)), origins$origin_id)
points <- st_as_sf(component, coords = c("x", "y"), crs = cfg$project$crs, remove = FALSE)
point_xy <- as.matrix(component[, .(x, y)])
point_terra <- terra::vect(points)
n <- nrow(component)
batch_size <- as.integer(cfg$score$component_batch_size)
initial_k <- as.integer(cfg$score$nearest_origin_candidates)

line_ids <- sort(unique(services$line_id))
if (length(line_ids) != 27L) stop("Expected 27 distinct lines")
d50 <- as.numeric(cfg$score$d50_sensitivity_m)
pval <- as.numeric(cfg$score$p_sensitivity)
grid <- CJ(d50_m = d50, p = pval)
grid[, variant := paste0("d", d50_m, "_p", format(p, nsmall = 1))]
factors <- as.numeric(cfg$score$duplicate_sensitivity)
factor_names <- paste0("q", gsub("\\.", "_", format(factors, nsmall = 2)))
tail_grid <- CJ(protected_lines = as.integer(cfg$score$protected_line_sensitivity),
                eta = as.numeric(cfg$score$tail_cap_sensitivity))
tail_grid[, variant := paste0("k", protected_lines, "_eta",
                               gsub("\\.", "_", format(eta, nsmall = 1)))]
variant_names <- c(grid$variant, factor_names, tail_grid$variant)
main_name <- "d600_p2.5"
if (!(main_name %in% variant_names)) stop("Main sensitivity specification missing")
if (cfg$score$protected_line_count != 3L || cfg$score$tail_cap_multiplier != 1 ||
    cfg$score$d50_m != 600 || cfg$score$p != 2.5 || cfg$score$duplicate_factor != 0.1)
  stop("Main score parameters changed; update main-specification contract explicitly")
scores <- list(
  entrance = matrix(0, nrow = n, ncol = length(variant_names), dimnames = list(NULL, variant_names)),
  platform = matrix(0, nrow = n, ncol = length(variant_names), dimnames = list(NULL, variant_names))
)

nearest_two <- function(row_ids, origin_indices, station_count) {
  result <- data.table(row = row_ids, first_station_id = NA_character_, first_distance_m = Inf,
                       second_station_id = NA_character_, second_distance_m = Inf)
  if (!length(origin_indices)) stop("Line has no spatial origin")
  o <- origins[origin_indices, ]
  oxy <- origin_xy[origin_indices, , drop = FALSE]
  origin_stations <- o$station_id
  ot <- terra::vect(o)
  pending <- seq_along(row_ids)
  k <- min(initial_k, nrow(o))
  repeat {
    if (!length(pending)) break
    global_rows <- row_ids[pending]
    if (k >= nrow(o)) {
      # terra::nearby can return only n-1 neighbours when k == n.
      idx <- rep(seq_len(nrow(o)), each = length(pending))
      local_rows <- rep(seq_along(pending), times = nrow(o))
    } else {
      nearby <- as.matrix(terra::nearby(point_terra[global_rows, ], ot, k = k))
      if (ncol(nearby) < 2L) stop("Unexpected terra nearby shape")
      idx <- as.integer(as.vector(nearby[, -1, drop = FALSE]))
      local_rows <- rep(seq_along(pending), times = ncol(nearby) - 1L)
    }
    ok <- !is.na(idx) & idx >= 1L & idx <= nrow(o)
    candidate <- data.table(local_row = local_rows[ok], origin = idx[ok])
    if (!nrow(candidate)) stop("No nearest-origin candidate")
    candidate[, station_id := origin_stations[origin]]
    px <- point_xy[global_rows[candidate$local_row], 1]
    py <- point_xy[global_rows[candidate$local_row], 2]
    candidate[, distance_m := sqrt((px - oxy[origin, 1])^2 + (py - oxy[origin, 2])^2)]
    candidate <- candidate[, .(distance_m = min(distance_m)), by = .(local_row, station_id)]
    setorder(candidate, local_row, distance_m, station_id)
    candidate[, rank := seq_len(.N), by = local_row]
    first <- candidate[rank == 1L]
    second <- candidate[rank == 2L]
    result$first_station_id[pending[first$local_row]] <- first$station_id
    result$first_distance_m[pending[first$local_row]] <- first$distance_m
    result$second_station_id[pending[second$local_row]] <- second$station_id
    result$second_distance_m[pending[second$local_row]] <- second$distance_m
    if (station_count == 1L || k == nrow(o)) break
    pending <- pending[which(is.na(result$second_station_id[pending]))]
    k <- min(nrow(o), k * 2L)
  }
  if (any(!is.finite(result$first_distance_m)) || (station_count > 1L && any(!is.finite(result$second_distance_m)))) {
    stop("Nearest station search did not return two distinct stations")
  }
  result[]
}

for (method in c("entrance", "platform")) {
  dir.create(file.path("data/interim/line_distances", method), recursive = TRUE, showWarnings = FALSE)
  first_matrix <- second_matrix <- matrix(Inf, nrow = n, ncol = length(line_ids),
                                           dimnames = list(NULL, line_ids))
  for (line_index in seq_along(line_ids)) {
    line <- line_ids[line_index]
    station_ids <- services[line_id == line, unique(station_id)]
    if (method == "entrance") {
      origin_indices <- which(origins$point_method == "entrance" & origins$station_id %in% station_ids)
    } else {
      ids <- bridge[line_id == line & station_id %in% station_ids, unique(platform_id)]
      origin_indices <- which(origins$point_method == "platform" & origins$origin_id %in% ids)
    }
    if (any(!station_ids %in% origins$station_id[origin_indices])) stop("Missing line-specific station origin: ", method, "/", line)
    distance_path <- file.path("data/interim/line_distances", method, paste0(line, ".rds"))
    if (Sys.getenv("SCORE_REUSE_DISTANCES") == "1" && file.exists(distance_path)) {
      distances <- readRDS(distance_path)
    } else {
      out <- vector("list", ceiling(n / batch_size))
      for (j in seq_along(out)) {
        rows <- seq.int((j - 1L) * batch_size + 1L, min(j * batch_size, n))
        out[[j]] <- nearest_two(rows, origin_indices, length(station_ids))
      }
      distances <- rbindlist(out)
      if (nrow(distances) != n || anyDuplicated(distances$row)) stop("Component-line distance coverage failed")
      setorder(distances, row)
      distances[, row := NULL]
      distances[, component_key := component$component_key]
      setcolorder(distances, c("component_key", "first_station_id", "first_distance_m", "second_station_id", "second_distance_m"))
      saveRDS(distances, distance_path, compress = "gzip")
    }
    if (nrow(distances) != n || !identical(distances$component_key, component$component_key))
      stop("Cached distance rows do not match components: ", method, "/", line)
    first_matrix[, line_index] <- distances$first_distance_m
    second_matrix[, line_index] <- distances$second_distance_m
    message(method, " / ", line, " (", line_index, "/", length(line_ids), ")")
  }
  threshold_cache <- lapply(sort(unique(tail_grid$protected_lines)), function(k)
    protected_distance(first_matrix, k, cfg$score$protected_distance_floor_m))
  names(threshold_cache) <- as.character(sort(unique(tail_grid$protected_lines)))
  main_threshold <- threshold_cache[[as.character(cfg$score$protected_line_count)]]
  for (v in seq_len(nrow(grid))) {
    scores[[method]][, grid$variant[v]] <- score_tail_components(
      first_matrix, second_matrix, main_threshold, grid$d50_m[v], grid$p[v],
      cfg$score$duplicate_factor, cfg$score$tail_cap_multiplier)$total
  }
  for (v in seq_along(factors)) {
    scores[[method]][, factor_names[v]] <- score_tail_components(
      first_matrix, second_matrix, main_threshold, cfg$score$d50_m, cfg$score$p,
      factors[v], cfg$score$tail_cap_multiplier)$total
  }
  for (v in seq_len(nrow(tail_grid))) {
    scores[[method]][, tail_grid$variant[v]] <- score_tail_components(
      first_matrix, second_matrix,
      threshold_cache[[as.character(tail_grid$protected_lines[v])]],
      cfg$score$d50_m, cfg$score$p, cfg$score$duplicate_factor,
      tail_grid$eta[v])$total
  }
}
if (max(abs(scores$entrance[, main_name] - scores$entrance[, "q0_10"])) > 1e-9 ||
    max(abs(scores$platform[, main_name] - scores$platform[, "q0_10"])) > 1e-9 ||
    max(abs(scores$entrance[, main_name] - scores$entrance[, "k3_eta1_0"])) > 1e-9 ||
    max(abs(scores$platform[, main_name] - scores$platform[, "k3_eta1_0"])) > 1e-9)
  stop("Main score sensitivity aliases differ")
if (any(!is.finite(scores$entrance)) || any(!is.finite(scores$platform))) stop("Non-finite score")
result <- component[, .(component_key, CUSEC, CUMUN, estimated_population, x, y, support_type)]
result[, `:=`(rail_score_entrance = scores$entrance[, main_name], rail_score_platform = scores$platform[, main_name])]
dir.create("data/derived", recursive = TRUE, showWarnings = FALSE)
saveRDS(result, "data/derived/component_scores.rds", compress = "gzip")
saveRDS(list(component_key = result$component_key, entrance = scores$entrance, platform = scores$platform),
        "data/interim/component_sensitivity.rds", compress = "gzip")
fwrite(result[, .(component_key, CUSEC, estimated_population, rail_score_entrance, rail_score_platform)],
       "data/derived/component_scores.csv.gz")
message("Scored ", n, " components across ", length(line_ids), " lines")
