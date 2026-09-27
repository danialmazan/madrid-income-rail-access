#!/usr/bin/env Rscript
source("R/score_tail.R")
first <- matrix(c(
  100, 400, 900, 1000, 1500,
  200, 500, 500, 1400, 2000,
  1200, 1300, 1400, 1500, 1600
), nrow = 3, byrow = TRUE)
second <- matrix(Inf, nrow(first), ncol(first))
threshold3 <- protected_distance(first, 3L)
threshold4 <- protected_distance(first, 4L)
stopifnot(identical(threshold3, c(1000, 1000, 1400)),
          identical(threshold4, c(1000, 1400, 1500)))
main <- score_tail_components(first, second, threshold3)
raw <- rowSums(distance_decay(first))
manual_tail <- distance_decay(threshold3) *
  (1 - exp(-main$tail_raw / distance_decay(threshold3)))
stopifnot(max(abs(main$tail - manual_tail)) < 1e-12,
          max(abs(main$full + main$tail - main$total)) < 1e-12,
          all(main$total < raw),
          all(main$tail <= main$tail_cap))
four <- score_tail_components(first, second, threshold4)
half_cap <- score_tail_components(first, second, threshold3, eta = .5)
double_cap <- score_tail_components(first, second, threshold3, eta = 2)
stopifnot(all(is.finite(four$total)),
          all(half_cap$total <= main$total),
          all(double_cap$total >= main$total))
message("Tail-score formula, threshold ties, and sensitivity ordering passed")
