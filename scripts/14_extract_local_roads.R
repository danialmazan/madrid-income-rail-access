#!/usr/bin/env Rscript
suppressPackageStartupMessages(library(sf))
source_path <- "data/raw/madrid-latest.osm.pbf"
output_path <- "data/interim/madrid_local_roads.geojsonl"
if (!file.exists(source_path)) stop("Download the Geofabrik Madrid OSM extract to ", source_path)
roads <- st_read(source_path,
  query = "SELECT osm_id, name, highway FROM lines WHERE highway IS NOT NULL",
  quiet = TRUE)
roads <- roads[roads$highway %in% c(
  "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
  "residential", "living_street", "pedestrian", "service", "road",
  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
  "footway", "path", "cycleway", "steps", "track"), ]
roads <- st_transform(roads, 25830)
sf_use_s2(FALSE)
st_geometry(roads) <- st_simplify(st_geometry(roads), dTolerance = 1.5,
                                  preserveTopology = FALSE)
roads <- roads[!st_is_empty(roads), ]
roads <- st_transform(roads, 4326)
dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
if (file.exists(output_path)) file.remove(output_path)
st_write(roads, output_path, driver = "GeoJSONSeq", quiet = TRUE)
message("Extracted ", nrow(roads), " Madrid road segments")
