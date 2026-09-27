# Methodology and source audit

## Observation and dates

The statistical observation is one census section. The main comparison pairs the INE ADRH 2023 median income per consumption unit with the population-weighted mean entrance-based Rail Access Score of residential components in that section. It is descriptive. It does not identify a causal effect.

The income reference is 2023; the section boundaries are dated 1 January 2024; modelled residential population comes from the sibling Rail Density project's 1 January 2025 allocation; and the rail input snapshot is dated 15 September 2026. These are deliberately mixed reference dates and cannot describe one simultaneous historical state.

## Official sources and keys

| Input | Source | Key / use |
| --- | --- | --- |
| ADRH table 31097 | [INE CSV](https://www.ine.es/jaxiT3/files/t/es/csv_bd/31097.csv) | Ten-character `CUSEC`, year 2023; indicator IDs `382441` (median equivalised), `383098` (mean equivalised), `284048` (mean net per person). |
| Census sections | [INE 2024 archive](https://www.ine.es/prodyser/cartografia/seccionado_2024.zip) | 4,480 Madrid-province polygons, official `CUSEC` after construction from province, municipality, district and section fields. |
| Rail itineraries | [CRTM M4](https://services5.arcgis.com/UxADft6QPcvFyDU1/ArcGIS/rest/services/M4_Red/FeatureServer/5), [M5](https://services5.arcgis.com/UxADft6QPcvFyDU1/ArcGIS/rest/services/M5_Red/FeatureServer/5), [M10](https://services5.arcgis.com/UxADft6QPcvFyDU1/ArcGIS/rest/services/M10_Red/FeatureServer/5) | `IDFANDEN` identifies a platform; `NUMEROLINEAUSUARIO` identifies the advertised boarding line. |
| Population, canonical stations, entrances, platforms | Sibling `rail_density` derived files | Stable `component_key`, `station_id`, `origin_id` / `platform_id`, and station-source identifiers. Input SHA-256 values and byte counts are recorded in `data/raw/source_manifest.json`. |

`CUSEC` is retained as text. The existing Rail Density 2025 sections contain 4,518 polygons, so their section codes are not used to join the 2023 ADRH values. Every existing component point is reassigned spatially in EPSG:25830 to the 2024 polygons. The population total of 7,113,886 is preserved. Fifty-seven component points outside the polygon cover because of boundary precision are assigned to the nearest 2024 section and counted in the geography audit. The allocation itself is reused; Catastro allocation is not rerun.

The Rail Density source stores Madrid municipality's Catastro components under source code `28900`. Analysis geography is always the official 2024 INE `CUSEC` (municipality prefix `28079`). Geometry tiles join components by `component_key`, then use the reassigned `CUSEC` for the city filter.

The INE CSV is tab separated despite its `.csv` extension. Suppressed and blank values stay missing. For each equivalised measure, six of the 4,480 sections lack a value, representing 498 modelled residents; mean income per person has no missing section. Missing sections remain in maps as No data and are excluded from income comparisons. The source has additional empty 2023 longitudinal rows for section identifiers that are not part of the 2024 Madrid polygon set; they are not treated as separate 2024 sections.

The 4,474 published Madrid median-equivalised-income section values contain only 85 distinct numbers, all on €350 increments. The scatter plots the published numbers without x-axis rounding; this source precision produces vertical columns of points. The two mean-income indicators do not follow that €350 pattern. The INE methodology describes the indicator but does not state why the published section medians use these increments, so the analysis makes no claim about the underlying interpolation or disclosure procedure.

## Boarding-service bridge

The relational bridge keeps `station_id`, `line_id`, `mode`, and `platform_id` separate. A station-line pair is included only when an itinerary row links a station platform to that line. A platform-line row must then link back to the included station-line pair. Station names never serve as join keys.

The original station `LINEAS` descriptions list 531 station-line pairs. The itinerary bridge confirms 528. Three source listings are excluded: Metro 2 at Plaza de España and Metro 3 and 10 at Noviciado. Those reflect connected interchange services; no boarding platform at the named station confirms them in the itinerary table. The included 528 station-line pairs have 1,054 platform-line links. The four modes are Metro, Cercanías, Metro Ligero, and Tranvía de Parla; 27 distinct public lines are scored.

For the entrance method, each station has one or more official access points. Forty station points have no separately published entrance and use the Rail Density official station-point fallback; their `is_fallback` flag is preserved in the source origin table. The platform method uses only platforms connected to a confirmed station-line pair. All included pairs have at least one platform association.

## Score

For each residential component and each distinct rail line, let `d1` and `d2` be the straight-line EPSG:25830 distances in metres to the nearest and second-nearest **different** stations that serve the line. The entrance method uses each station's nearest entrance for both distances. The platform method uses the nearest appropriate platform for that station-line pair. Ties are resolved by the stable station ID.

`f(d) = 1 / (1 + (d / 600)^2.5)`

`LineScore = f(d1) + 0.1 × f(d2)`; when a line has only one station, its second term is zero. A line offered at another station does not become a new unique line. Different lines at one station each contribute a full first-station term.

Order distinct lines by `d1` and set `D* = max(1,000 m, d(3))`, where `d(3)` is the third-smallest nearest-station distance. Every line with `d1 ≤ D*` contributes its full `LineScore`; let their sum be `A`. Sum the other line scores as `R`. With `TailCap = η f(D*)`, the distant-line contribution is `TailScore = TailCap × (1 − exp(−R / TailCap))`, and `BuildingRailScore = A + TailScore`. The main score uses three protected lines and `η = 1`. Ties at `D*` all receive full contributions. This is a diminishing-return treatment, not a hard cutoff; lines beyond `D*` still affect the score. There is no walking-network model.

The calculation writes compact first/second station and distance tables by line and method, plus a versioned component-score table. Section scores are `sum(component population × component score) / sum(component population)`. The section is the unit for the scatter, Spearman coefficient, and smoother. Buildings only inherit section income to support maps and group distributions.

## Grouping and other figures

Within the chosen region or Madrid municipality and chosen income indicator, eligible sections are sorted by income and then `CUSEC`. Each whole section enters the decile or quintile whose population share contains its population midpoint. This avoids splitting sections and yields approximately equal resident populations. These are **groups of areas ranked by income**, not individual-income deciles. The published tables include actual group population shares.

The income-decile figure uses weighted 10th, 25th, 50th, 75th and 90th percentiles of **section** Rail Access Scores, plus a separate weighted mean marker. Each of the ten groups contains approximately one tenth of the eligible resident population. The mean and median need not coincide.

The building-score distribution assigns each residential component its section's income quintile and totals modelled residents in 24 score intervals, spaced evenly on an asinh-transformed score scale. Each income-quintile distribution sums to 100%; the chart x-axis uses the corresponding nonlinear scale so the interval widths appear evenly spaced. The reverse chart ranks individual residential components by Rail Access Score and assigns whole components to approximate equal-population score deciles. It then shows each score decile's resident share across the five inherited section-income quintiles. This does not treat building incomes as independent observations.

The three interactive building examples are selected deterministically from real Madrid municipality residential components: nearby single-line stations, several stations with multiple lines, and repeated access to one line. Their line ledger reads the exact nearest/second-nearest station tables and reconciles full protected lines plus the adjusted distant-line tail to the stored building entrance score. The diagram shows contributing entrances within 1,000 m. The ledger shows every full-contribution line, the raw distant-line sum, tail cap, adjusted tail, and final score.

The Four Madrids use each component's own Rail Access Score and the income inherited from its census section. Separate resident-weighted medians of inherited section income and **building** score define the thresholds for the selected geography and access point. Ties fall on the lower side. The cards count residents and residential components; one census section can contribute buildings to more than one access category. The scatter, Spearman coefficient and income-decile box plot continue to use one observation per section. The sensitivity table's Four Madrids change share is also calculated over building populations.

The fixed sensitivity grid is `D50 ∈ {500, 600, 700}` metres and `p ∈ {2.0, 2.5, 3.0}` for both entrance and platform origins. At `600/2.5`, the duplicate-line multiplier is additionally `{0, 0.05, 0.10, 0.20}`. The tail grid crosses protected-line counts `{3, 4}` with `η ∈ {0.5, 1, 2}`. Every sensitivity version uses the same first/second-station distance tables; its own decay function also sets `TailCap`. The summary file reports income–score Spearman, section-rank Spearman against the main score, top-minus-bottom decile mean gap, and the population share whose Four Madrids quadrant changes. The main score is `600/2.5/0.10`, three protected lines and `η = 1`; it is not chosen from the observed relationship.

## Maps and interpretation

The income map uses 2024 section polygons. Rail score and income × access use actual residential component polygons at close zoom. The score overview uses population-weighted 2 km squares; the combined overview shows each square's most populous building-level Four Madrids category. These are display generalisations, not statistical units. Missing income is dark grey, distinct from the lightest income category. The bivariate legend has text labels in addition to colour.

The `file://` page uses SVG/GeoJSON and spatially indexed, gzip-compressed building chunks because local file URLs cannot provide the byte-range HTTP requests used by PMTiles. It loads building chunks near the visible map area and switches to the 2 km generalisation when zoomed far out. The HTTP preview uses MapLibre component PMTiles at close zoom. Both views use the same building scores, inherited income, thresholds and four-quadrant palette.

Income is ecological, the population is modelled, distance is straight-line and not actual walking time, service frequency is not modelled, and the score is a constructed opportunity index. These limits matter when interpreting any spatial association.

The address tool sends typed queries of at least four characters to the Photon search service for autocomplete, constrained to the Madrid region. It does not display a result map until the user presses **Find my score**. That map uses the OpenFreeMap street basemap and loads only spatial chunks near the chosen address; it highlights modelled residential components whose projected reference point lies within 100 m. Clicking a component recomputes its entrance or platform score from the published CRTM origin/line table, shows the protected-line and capped-tail ledger, and connects the component to its contributing first/second stations within 1,000 m. This feature needs an internet connection for address search and the street basemap; the published building and station data remain local.
