#!/usr/bin/env Rscript
suppressPackageStartupMessages({library(sf); library(data.table); library(yaml); library(jsonlite)})
source("R/analysis_helpers.R")
cfg <- yaml::read_yaml("config.yml")
sections <- readRDS("data/derived/sections_2024_income.rds")
components <- readRDS("data/derived/component_scores.rds")
variants <- readRDS("data/interim/component_sensitivity.rds")
if (!identical(components$component_key, variants$component_key)) stop("Sensitivity component order changed")
if (nrow(components) != 644613L) stop("Incomplete component-score build")
lookup <- match(sections$CUSEC, unique(components$CUSEC))
if (anyNA(lookup[sections$section_population > 0])) stop("Populated section has no components")

for (method in c("entrance", "platform")) {
  col <- paste0("rail_score_", method)
  sums <- components[, .(weighted = sum(estimated_population * get(col)),
                         pop = sum(estimated_population)), by = CUSEC]
  sections[[col]] <- sums$weighted[match(sections$CUSEC, sums$CUSEC)] /
                     sums$pop[match(sections$CUSEC, sums$CUSEC)]
}
if (any(!is.finite(sections$rail_score_entrance[sections$section_population > 0]))) stop("Missing entrance section score")
if (any(!is.finite(sections$rail_score_platform[sections$section_population > 0]))) stop("Missing platform section score")
saveRDS(sections, "data/derived/section_scores.rds", compress = "gzip")
fwrite(st_drop_geometry(sections), "data/derived/section_scores.csv")

variant_sections <- data.table(CUSEC = sections$CUSEC)
group_factor <- factor(components$CUSEC, levels = sections$CUSEC)
for (method in c("entrance", "platform")) {
  mat <- variants[[method]]
  weighted <- rowsum(mat * components$estimated_population, group_factor, reorder = TRUE)
  pop_by_section <- rowsum(components$estimated_population, group_factor, reorder = TRUE)
  if (nrow(weighted) != nrow(sections)) stop("Sensitivity sections incomplete")
  weighted <- weighted[match(sections$CUSEC, rownames(weighted)), , drop = FALSE]
  pop <- pop_by_section[match(sections$CUSEC, rownames(pop_by_section)), 1]
  if (anyNA(pop) || any(pop <= 0)) stop("Invalid sensitivity section denominator")
  weighted <- sweep(weighted, 1, pop, "/")
  colnames(weighted) <- paste(method, colnames(weighted), sep = "_")
  variant_sections <- cbind(variant_sections, as.data.table(weighted))
}
fwrite(variant_sections, "data/derived/section_sensitivity.csv")

metrics <- c("income_median_equivalised", "income_mean_equivalised", "income_mean_per_person")
geographies <- c("region", "city")
methods <- c("entrance", "platform")
summaries <- list(); deciles <- list(); quintiles <- list(); cdfs <- list()
distributions <- list(); reverse_groups <- list(); smoothers <- list()
counter <- 0L
for (geography in geographies) {
  keep <- if (geography == "city") sections$CUMUN == cfg$project$city_code else rep(TRUE, nrow(sections))
  subset <- sections[keep, ]
  components_geo <- components[CUSEC %in% subset$CUSEC]
  for (metric in metrics) {
    g10 <- income_groups(subset, metric, 10L)
    g5 <- income_groups(subset, metric, 5L)
    for (method in methods) {
      counter <- counter + 1L
      score_col <- paste0("rail_score_", method)
      dt <- as.data.table(st_drop_geometry(subset))
      dt <- dt[is.finite(get(metric)) & section_population > 0]
      rho <- cor(dt[[metric]], dt[[score_col]], method = "spearman")
      building <- merge(components_geo[, .(component_key, CUSEC, estimated_population,
                                           building_score = get(score_col))],
                        dt[, .(CUSEC, income = get(metric))], by = "CUSEC", sort = FALSE)
      income_threshold <- weighted_quantile(building$income, building$estimated_population, .5)
      score_threshold <- weighted_quantile(building$building_score, building$estimated_population, .5)
      building[, quadrant := paste0(ifelse(income <= income_threshold, "lower_income", "higher_income"),
                                   "_", ifelse(building_score <= score_threshold, "lower_access", "higher_access"))]
      quad <- building[, .(components = .N, population = sum(estimated_population)), by = quadrant]
      quad[, population_share := population / sum(building$estimated_population)]
      summaries[[counter]] <- list(geography = geography, income_metric = metric, method = method,
        sections = nrow(dt), population = sum(dt$section_population), spearman_rho = rho,
        income_threshold = income_threshold, score_threshold = score_threshold,
        quadrants = quad)
      group_rows <- function(groups, n_groups) {
        x <- merge(dt, groups, by = "CUSEC", all = FALSE)
        z <- x[, {
          qs <- weighted_quantile(get(score_col), section_population, c(.1, .25, .5, .75, .9))
          list(sections = .N, population = sum(section_population),
               mean_score = weighted.mean(get(score_col), section_population),
               p10 = qs[1], p25 = qs[2], median_score = qs[3], p75 = qs[4], p90 = qs[5],
               income_min = min(get(metric)), income_max = max(get(metric)))
        }, by = group]
        z[, `:=`(population_share = population / sum(x$section_population),
                 geography = geography, income_metric = metric, method = method)]
        z
      }
      deciles[[counter]] <- group_rows(g10, 10L)
      quintiles[[counter]] <- group_rows(g5, 5L)
      fit <- stats::loess(y ~ x, data = data.frame(x = dt[[metric]], y = dt[[score_col]]), span = .5, degree = 1,
                          control = stats::loess.control(surface = "direct"))
      grid <- seq(min(dt[[metric]]), max(dt[[metric]]), length.out = 60L)
      smoothers[[counter]] <- data.table(geography = geography, income_metric = metric,
        method = method, income = grid, score = as.numeric(predict(fit, newdata = data.frame(x = grid))))
      cdfs[[counter]] <- score_cdf(components_geo, g5, method, geography, metric)
      distributions[[counter]] <- score_distribution(components_geo, g5, method, geography, metric)
      reverse_groups[[counter]] <- reverse_income_distribution(components_geo, g5, method, geography, metric)
    }
  }
}
dec <- rbindlist(deciles); quin <- rbindlist(quintiles); cdf <- rbindlist(cdfs); smooth <- rbindlist(smoothers)
dist <- rbindlist(distributions); reverse <- rbindlist(reverse_groups)
fwrite(dec, "data/derived/income_deciles.csv")
fwrite(quin, "data/derived/income_quintiles.csv")
fwrite(cdf, "data/derived/score_cdfs.csv")
fwrite(dist, "data/derived/score_distributions.csv")
fwrite(reverse, "data/derived/reverse_income_distributions.csv")
fwrite(smooth, "data/derived/scatter_smoothers.csv")

sens_rows <- list(); k <- 0L
for (geography in geographies) for (metric in metrics) for (method in methods) {
  base <- as.data.table(st_drop_geometry(sections))
  base <- base[(geography == "region" | CUMUN == cfg$project$city_code) & is.finite(get(metric)) & section_population > 0]
  scores <- variant_sections[match(base$CUSEC, CUSEC)]
  main <- scores[[paste0(method, "_d600_p2.5")]]
  g10 <- income_groups(sections[match(base$CUSEC, sections$CUSEC), ], metric, 10L)
  comp_base <- merge(components[CUSEC %in% base$CUSEC,
                                .(component_key, CUSEC, estimated_population)],
                     base[, .(CUSEC, income = get(metric))], by = "CUSEC", sort = FALSE)
  variant_components <- variants[[method]][match(comp_base$component_key, components$component_key), , drop = FALSE]
  main_income_threshold <- weighted_quantile(comp_base$income, comp_base$estimated_population, .5)
  main_building <- variant_components[, "d600_p2.5"]
  main_score_threshold <- weighted_quantile(main_building, comp_base$estimated_population, .5)
  main_quadrant <- (comp_base$income > main_income_threshold) * 2L + (main_building > main_score_threshold)
  for (name in grep(paste0("^", method, "_"), names(scores), value = TRUE)) {
    value <- scores[[name]]
    building_value <- variant_components[, sub(paste0("^", method, "_"), "", name)]
    score_threshold <- weighted_quantile(building_value, comp_base$estimated_population, .5)
    variant_quadrant <- (comp_base$income > main_income_threshold) * 2L + (building_value > score_threshold)
    changed_population_share <- sum(comp_base$estimated_population[variant_quadrant != main_quadrant]) /
                                sum(comp_base$estimated_population)
    g <- merge(data.table(CUSEC = base$CUSEC, section_population = base$section_population,
                          score = value), g10, by = "CUSEC")
    gap <- g[group == 10L, weighted.mean(score, section_population)] -
           g[group == 1L, weighted.mean(score, section_population)]
    k <- k + 1L
    sens_rows[[k]] <- data.table(geography, income_metric = metric, method,
      variant = sub(paste0("^", method, "_"), "", name),
      income_score_spearman = cor(base[[metric]], value, method = "spearman"),
      rank_spearman_vs_main = cor(main, value, method = "spearman"),
      top_bottom_decile_gap = gap,
      four_madrids_changed_population_share = changed_population_share)
  }
}
fwrite(rbindlist(sens_rows), "validation/generated/sensitivity_summary.csv")

dir.create("frontend/public/data", recursive = TRUE, showWarnings = FALSE)
section_public <- as.data.table(st_drop_geometry(sections))[, .(
  CUSEC, CUMUN, NMUN, district = substr(CUSEC, 6, 7), section_population,
  income_median_equivalised, income_mean_equivalised, income_mean_per_person,
  rail_score_entrance, rail_score_platform
)]
payload <- list(meta = list(income_year = 2023, income_section_reference = "2024-01-01",
                             population_reference = "2025-01-01", rail_snapshot = "2026-09-15",
                             distance_type = "straight_line_euclidean", component_count = nrow(components),
                             section_count = nrow(sections)),
                sections = section_public, summaries = summaries, deciles = dec,
                quintiles = quin, cdfs = cdf, distributions = dist,
                reverse_groups = reverse, smoothers = smooth)
write_json(payload, "frontend/public/data/analysis.json", auto_unbox = TRUE, digits = 10, na = "null")
file.copy("data/derived/section_scores.csv", "frontend/public/data/section_scores.csv", overwrite = TRUE)
file.copy("validation/generated/sensitivity_summary.csv", "frontend/public/data/sensitivity_summary.csv", overwrite = TRUE)

map_sections <- st_transform(st_simplify(sections, dTolerance = 15), 4326)
map_sections <- map_sections[, c("CUSEC", "CUMUN", "NMUN", metrics,
  "rail_score_entrance", "rail_score_platform")]
st_write(map_sections, "frontend/public/data/sections.geojson", delete_dsn = TRUE, quiet = TRUE)
message("Aggregated ", nrow(sections), " sections and prepared analysis payload")
