weighted_quantile <- function(x, w, probs) {
  ok <- is.finite(x) & is.finite(w) & w > 0
  x <- x[ok]; w <- w[ok]
  if (!length(x)) return(rep(NA_real_, length(probs)))
  o <- order(x)
  x <- x[o]; w <- w[o]
  x[vapply(probs, function(p) which(cumsum(w) >= p * sum(w))[1], integer(1))]
}

income_groups <- function(sections, metric, n_groups) {
  dt <- data.table::as.data.table(sf::st_drop_geometry(sections))
  dt <- dt[is.finite(get(metric)) & section_population > 0]
  data.table::setorderv(dt, c(metric, "CUSEC"))
  total <- sum(dt$section_population)
  dt[, group := pmin(n_groups, pmax(1L,
    floor(((cumsum(section_population) - section_population / 2) / total) * n_groups) + 1L))]
  dt[, .(CUSEC, group)]
}

score_cdf <- function(components, group_lookup, method, geography, metric, n_bins = 180L) {
  dt <- merge(components[, .(CUSEC, estimated_population,
                              score = get(paste0("rail_score_", method)))],
              group_lookup, by = "CUSEC", all = FALSE, sort = FALSE)
  top <- max(dt$score)
  breaks <- seq(0, top * 1.000001, length.out = n_bins + 1L)
  dt[, bin := pmin(n_bins, pmax(1L, findInterval(score, breaks, all.inside = TRUE)))]
  inc <- dt[, .(population = sum(estimated_population)), by = .(group, bin)]
  grid <- data.table::CJ(group = 1:5, bin = 1:n_bins)
  grid <- merge(grid, inc, by = c("group", "bin"), all.x = TRUE)
  grid[is.na(population), population := 0]
  data.table::setorder(grid, group, bin)
  grid[, share := cumsum(population) / sum(population), by = group]
  grid[, `:=`(score = breaks[bin + 1L], method = method, geography = geography,
              income_metric = metric)]
  grid[, .(method, geography, income_metric, group, score, share)]
}

score_distribution <- function(components, group_lookup, method, geography, metric, n_bins = 24L) {
  dt <- merge(components[, .(CUSEC, estimated_population,
                              score = get(paste0("rail_score_", method)))],
              group_lookup, by = "CUSEC", all = FALSE, sort = FALSE)
  top <- max(dt$score) * 1.000001
  breaks <- sinh(seq(0, asinh(top / .05), length.out = n_bins + 1L)) * .05
  dt[, bin := pmin(n_bins, pmax(1L, findInterval(score, breaks, all.inside = TRUE)))]
  inc <- dt[, .(population = sum(estimated_population)), by = .(group, bin)]
  grid <- merge(data.table::CJ(group = 1:5, bin = 1:n_bins), inc,
                by = c("group", "bin"), all.x = TRUE)
  grid[is.na(population), population := 0]
  grid[, share := population / sum(population), by = group]
  grid[, `:=`(score_lower = breaks[bin], score_upper = breaks[bin + 1L],
              method = method, geography = geography, income_metric = metric)]
  grid[, .(method, geography, income_metric, group, bin, score_lower, score_upper, share)]
}

reverse_income_distribution <- function(components, section_quintiles, method, geography, metric) {
  dt <- merge(components[, .(component_key, CUSEC, estimated_population,
                              score = get(paste0("rail_score_", method)))],
              section_quintiles, by = "CUSEC", all = FALSE, sort = FALSE)
  data.table::setorderv(dt, c("score", "component_key"))
  dt[, score_decile := pmin(10L, pmax(1L,
    floor(((cumsum(estimated_population) - estimated_population / 2) /
             sum(estimated_population)) * 10) + 1L))]
  totals <- dt[, .(decile_population = sum(estimated_population),
                   score_min = min(score), score_max = max(score)), by = score_decile]
  cells <- dt[, .(population = sum(estimated_population)),
              by = .(score_decile, income_quintile = group)]
  cells <- merge(data.table::CJ(score_decile = 1:10, income_quintile = 1:5), cells,
                 by = c("score_decile", "income_quintile"), all.x = TRUE)
  cells[is.na(population), population := 0]
  cells <- merge(cells, totals, by = "score_decile")
  cells[, `:=`(share = population / decile_population,
               geography = geography, income_metric = metric, method = method)]
  cells[, .(geography, income_metric, method, score_decile, income_quintile,
            population, decile_population, share, score_min, score_max)]
}
