distance_decay <- function(d, half = 600, shape = 2.5) {
  ifelse(is.finite(d), 1 / (1 + (d / half)^shape), 0)
}

protected_distance <- function(first, count = 3L, floor_m = 1000) {
  stopifnot(is.matrix(first), count >= 1L, count <= ncol(first), floor_m > 0)
  nearest <- matrix(Inf, nrow(first), count)
  for (line in seq_len(ncol(first))) {
    carry <- first[, line]
    for (rank in seq_len(count)) {
      previous <- nearest[, rank]
      nearest[, rank] <- pmin(previous, carry)
      carry <- pmax(previous, carry)
    }
  }
  pmax(floor_m, nearest[, count])
}

score_tail_components <- function(first, second, protected_m,
                                  half = 600, shape = 2.5, duplicate = 0.1, eta = 1) {
  stopifnot(is.matrix(first), identical(dim(first), dim(second)),
            length(protected_m) == nrow(first), half > 0, shape > 0,
            duplicate >= 0, eta > 0)
  full <- tail_raw <- numeric(nrow(first))
  for (line in seq_len(ncol(first))) {
    line_score <- distance_decay(first[, line], half, shape) +
      duplicate * distance_decay(second[, line], half, shape)
    inside <- first[, line] <= protected_m
    full <- full + ifelse(inside, line_score, 0)
    tail_raw <- tail_raw + ifelse(inside, 0, line_score)
  }
  cap <- eta * distance_decay(protected_m, half, shape)
  tail <- ifelse(tail_raw > 0 & cap > 0,
                 cap * -expm1(-tail_raw / pmax(cap, .Machine$double.xmin)), 0)
  list(full = full, tail_raw = tail_raw, tail_cap = cap,
       tail = tail, total = full + tail)
}
