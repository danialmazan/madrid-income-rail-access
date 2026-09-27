#!/usr/bin/env Rscript
suppressPackageStartupMessages({library(sf); library(data.table); library(yaml)})
cfg <- yaml::read_yaml("config.yml")
rail <- Sys.getenv("RAIL_DENSITY_ROOT", cfg$project$rail_density_root)
tippecanoe <- Sys.which("tippecanoe")
if (!nzchar(tippecanoe)) stop("tippecanoe is required")
dir.create("frontend/public/tiles", recursive = TRUE, showWarnings = FALSE)
dir.create("data/interim/tile_sources", recursive = TRUE, showWarnings = FALSE)
scores <- readRDS("data/derived/component_scores.rds")
if (nrow(scores) != 644613L) stop("Incomplete component scores")
attrs <- scores[, .(component_key, CUSEC, x, y, pop = round(estimated_population, 2),
                    entrance_score = round(rail_score_entrance, 4),
                    platform_score = round(rail_score_platform, 4))]
income <- as.data.table(st_drop_geometry(readRDS("data/derived/section_scores.rds")))[,
  .(CUSEC, income_median_equivalised, income_mean_equivalised, income_mean_per_person)]
attrs <- merge(attrs, income, by = "CUSEC", all.x = TRUE, sort = FALSE)
if (nrow(attrs) != nrow(scores)) stop("Component income join changed row count")
parts_dir <- file.path(rail, "data/interim/phase2/components_by_municipality")
paths <- list.files(parts_dir, pattern = "^components_[0-9]+\\.rds$", full.names = TRUE)
if (!length(paths)) stop("No Rail Density component geometry files")
source_path <- "data/interim/tile_sources/components.geojsons"
if (file.exists(source_path)) unlink(source_path)
first <- TRUE
written <- 0L
for (path in paths) {
  polygons <- readRDS(path)
  x <- merge(polygons[, "component_key"], attrs, by = "component_key", all.x = FALSE)
  written <- written + nrow(x)
  x <- st_transform(x, 4326)
  st_write(x, source_path, driver = "GeoJSONSeq", append = !first, quiet = TRUE)
  first <- FALSE
  message(basename(path), ": ", nrow(x))
}
if (written != nrow(scores)) stop("Not all component polygons entered tiles")
args <- c("--force", "--output", "frontend/public/tiles/components.pmtiles",
          "--layer", "components", "--minimum-zoom", "12", "--maximum-zoom", "16",
          "--drop-densest-as-needed", "--extend-zooms-if-still-dropping",
          "--include", "component_key", "--include", "CUSEC", "--include", "pop",
          "--include", "x", "--include", "y",
          "--include", "entrance_score", "--include", "platform_score", source_path)
args <- append(args, c("--include", "income_median_equivalised",
                       "--include", "income_mean_equivalised",
                       "--include", "income_mean_per_person"), after = length(args) - 1L)
if (system2(tippecanoe, args) != 0) stop("Component tippecanoe build failed")

surface <- rbindlist(list(
  scores[, .(geography = "region", gx = floor(x / 2000) * 2000, gy = floor(y / 2000) * 2000,
             estimated_population, rail_score_entrance, rail_score_platform)],
  scores[CUMUN == cfg$project$city_code,
         .(geography = "city", gx = floor(x / 2000) * 2000, gy = floor(y / 2000) * 2000,
           estimated_population, rail_score_entrance, rail_score_platform)]
))
surface <- surface[, .(pop = sum(estimated_population),
  entrance_score = weighted.mean(rail_score_entrance, estimated_population),
  platform_score = weighted.mean(rail_score_platform, estimated_population)), by = .(geography, gx, gy)]
geom <- st_sfc(lapply(seq_len(nrow(surface)), function(i) st_polygon(list(matrix(c(
  surface$gx[i], surface$gy[i], surface$gx[i] + 2000, surface$gy[i],
  surface$gx[i] + 2000, surface$gy[i] + 2000, surface$gx[i], surface$gy[i] + 2000,
  surface$gx[i], surface$gy[i]), ncol = 2, byrow = TRUE)))), crs = cfg$project$crs)
sf_surface <- st_transform(st_sf(surface[, .(geography, pop = round(pop), entrance_score = round(entrance_score, 4),
                                          platform_score = round(platform_score, 4))], geometry = geom), 4326)
surface_path <- "data/interim/tile_sources/surface.geojsons"
st_write(sf_surface, surface_path, driver = "GeoJSONSeq", delete_dsn = TRUE, quiet = TRUE)
st_write(sf_surface, "frontend/public/data/surface.geojson", driver = "GeoJSON", delete_dsn = TRUE, quiet = TRUE)
args <- c("--force", "--output", "frontend/public/tiles/surface.pmtiles",
          "--layer", "surface", "--minimum-zoom", "5", "--maximum-zoom", "12",
          "--no-feature-limit", "--no-tile-size-limit", surface_path)
if (system2(tippecanoe, args) != 0) stop("Surface tippecanoe build failed")
file.copy(file.path(rail, "frontend/public/tiles/stations.pmtiles"),
          "frontend/public/tiles/stations.pmtiles", overwrite = TRUE)
message("Built component, surface, and reused station PMTiles")
