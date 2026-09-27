#!/usr/bin/env Rscript
suppressPackageStartupMessages({library(sf); library(data.table); library(jsonlite); library(yaml)})
cfg <- yaml::read_yaml("config.yml")
source("R/score_tail.R")
rail <- Sys.getenv("RAIL_DENSITY_ROOT", cfg$project$rail_density_root)
components <- readRDS("data/derived/component_scores.rds")
city <- which(components$CUMUN == "28079" & components$estimated_population > 0 &
                components$support_type == "residential_component")
lines <- sub("[.]rds$", "", sort(list.files("data/interim/line_distances/entrance", pattern = "[.]rds$")))
n <- length(city); k <- length(lines)
first <- matrix(Inf, n, k, dimnames = list(NULL, lines))
second <- matrix(Inf, n, k, dimnames = list(NULL, lines))
first_station <- matrix(NA_character_, n, k, dimnames = list(NULL, lines))
second_station <- matrix(NA_character_, n, k, dimnames = list(NULL, lines))
for (j in seq_along(lines)) {
  x <- readRDS(file.path("data/interim/line_distances/entrance", paste0(lines[j], ".rds")))[city]
  first[, j] <- x$first_distance_m; second[, j] <- x$second_distance_m
  first_station[, j] <- x$first_station_id; second_station[, j] <- x$second_station_id
}
near <- first <= 600
near_count <- rowSums(near)
duplicate_count <- rowSums(second <= 500)
shared <- vapply(seq_len(n), function(i) {
  ids <- first_station[i, near[i, ]]
  if (!length(ids)) return(0L)
  max(tabulate(match(ids, unique(ids))))
}, integer(1))
distinct <- vapply(seq_len(n), function(i) length(unique(first_station[i, near[i, ]])), integer(1))
station_services <- fread("data/derived/station_lines.csv")
multi_ids <- station_services[, .N, by = station_id][N > 1, station_id]
near_multi <- rowSums(first <= 1000 & first_station %in% multi_ids)

pick <- function(ok, target) {
  candidates <- which(ok)
  if (!length(candidates)) stop("No example candidate for ", target)
  candidates[order(-components$estimated_population[city[candidates]], components$component_key[city[candidates]])][1]
}
chosen <- integer()
choose <- function(ok, name) {
  i <- pick(ok & !(seq_len(n) %in% chosen), name)
  chosen <<- c(chosen, i)
  i
}
chosen <- c(
  choose(near_count == 1 & near_multi == 0 & apply(first, 1, min) >= 350 & apply(first, 1, min) <= 500,
         "one nearby line"),
  choose(near_count >= 4 & distinct >= 2 & duplicate_count >= 2,
         "several nearby stations"),
  choose(near_count <= 2 & apply(first < 150 & second <= 350, 1, any),
         "repeated access to one line")
)

stations <- readRDS(file.path(rail, "data/derived/stations/canonical_stations.rds"))
station_name <- setNames(stations$station_name, stations$station_id)
origins <- readRDS(file.path(rail, "data/derived/stations/station_origins_phase7.rds"))
entrances <- origins[origins$point_method == "entrance", ]
entry_xy <- st_coordinates(entrances)
decay <- function(d) ifelse(is.finite(d), 1 / (1 + (d / 600)^2.5), 0)
ids <- c("one_line", "several_stations", "same_line_twice")
titles_en <- c("Single-line stations nearby", "Several stations and lines", "Repeated access to one line")
titles_es <- c("Estaciones cercanas de una línea", "Varias estaciones y líneas", "Acceso repetido a una línea")
examples <- vector("list", length(chosen))
for (h in seq_along(chosen)) {
  i <- chosen[h]; row <- city[i]
  dx <- components$x[row]; dy <- components$y[row]
  line_rows <- data.table(line_id = lines, first_station_id = first_station[i, ],
    first_distance_m = first[i, ], second_station_id = second_station[i, ],
    second_distance_m = second[i, ])
  line_rows[, `:=`(first_station = unname(station_name[first_station_id]),
                 second_station = unname(station_name[second_station_id]),
                 full_contribution = decay(first_distance_m),
                 repeat_contribution = 0.1 * decay(second_distance_m))]
  line_rows[, line_score := full_contribution + repeat_contribution]
  threshold <- protected_distance(matrix(first[i, ], nrow = 1),
    cfg$score$protected_line_count, cfg$score$protected_distance_floor_m)
  parts <- score_tail_components(matrix(first[i, ], nrow = 1),
    matrix(second[i, ], nrow = 1), threshold, cfg$score$d50_m, cfg$score$p,
    cfg$score$duplicate_factor, cfg$score$tail_cap_multiplier)
  line_rows[, protected := first_distance_m <= threshold]
  if (abs(parts$total - components$rail_score_entrance[row]) > 1e-8)
    stop("Example score decomposition failed")
  setorder(line_rows, first_distance_m, line_id)
  plotted <- unique(c(line_rows$first_station_id[line_rows$first_distance_m <= 1000],
                      line_rows$second_station_id[line_rows$second_distance_m <= 1000]))
  plotted <- plotted[!is.na(plotted)]
  points <- lapply(plotted, function(station_id) {
    sid <- station_id
    o <- which(entrances$station_id == station_id)
    d <- sqrt((entry_xy[o, 1] - dx)^2 + (entry_xy[o, 2] - dy)^2)
    nearest <- o[order(d, entrances$origin_id[o])][1]
    list(station_id = station_id, name = unname(station_name[station_id]),
         x = entry_xy[nearest, 1] - dx, y = entry_xy[nearest, 2] - dy,
         distance_m = min(d), lines = sort(station_services[station_id == sid, line_id]))
  })
  examples[[h]] <- list(id = ids[h], title_en = titles_en[h], title_es = titles_es[h],
    component_key = components$component_key[row], CUSEC = components$CUSEC[row],
    population = components$estimated_population[row], score = components$rail_score_entrance[row],
    protected_distance_m = threshold, full_score = parts$full,
    raw_tail = parts$tail_raw, tail_cap = parts$tail_cap,
    tail_score = parts$tail,
    nearby_line_count = near_count[i], nearby_station_count = distinct[i],
    x = dx, y = dy, stations = points,
    lines = line_rows[, .(line_id, first_station, first_distance_m, second_station,
                          second_distance_m, full_contribution, repeat_contribution,
                          line_score, protected)])
}
dir.create("frontend/public/data", recursive = TRUE, showWarnings = FALSE)
write_json(examples, "frontend/public/data/score_examples.json", auto_unbox = TRUE, digits = 10, na = "null", pretty = TRUE)
fwrite(data.table(id = ids, component_key = components$component_key[city[chosen]],
                  CUSEC = components$CUSEC[city[chosen]], score = components$rail_score_entrance[city[chosen]],
                  near_lines = near_count[chosen], near_stations = distinct[chosen]),
       "validation/generated/score_examples.csv")
message("Selected ", length(examples), " real Madrid residential-component score examples")
