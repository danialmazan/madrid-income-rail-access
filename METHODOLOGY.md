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

## Boarding-service bridge

The relational bridge keeps `station_id`, `line_id`, `mode`, and `platform_id` separate. A station-line pair is included only when an itinerary row links a station platform to that line. A platform-line row must then link back to the included station-line pair. Station names never serve as join keys.

The original station `LINEAS` descriptions list 531 station-line pairs. The itinerary bridge confirms 528. Three source listings are excluded: Metro 2 at Plaza de España and Metro 3 and 10 at Noviciado. Those reflect connected interchange services; no boarding platform at the named station confirms them in the itinerary table. The included 528 station-line pairs have 1,054 platform-line links. The four modes are Metro, Cercanías, Metro Ligero, and Tranvía de Parla; 27 distinct public lines are scored.

For the entrance method, each station has one or more official access points. Forty station points have no separately published entrance and use the Rail Density official station-point fallback; their `is_fallback` flag is preserved in the source origin table. The platform method uses only platforms connected to a confirmed station-line pair. All included pairs have at least one platform association.

## Score

For each residential component and each distinct rail line, let `d1` and `d2` be the straight-line EPSG:25830 distances in metres to the nearest and second-nearest **different** stations that serve the line. The entrance method uses each station's nearest entrance for both distances. The platform method uses the nearest appropriate platform for that station-line pair. Ties are resolved by the stable station ID.

`f(d) = 1 / (1 + (d / 600)^2.5)`

`LineScore = f(d1) + 0.1 × f(d2)`; when a line has only one station, its second term is zero. A line offered at another station does not become a new unique line. Different lines at one station each contribute a full first-station term. All lines are summed for the component. There is no 1,500 m cutoff and no walking-network model.

The calculation writes compact first/second station and distance tables by line and method, plus a versioned component-score table. Section scores are `sum(component population × component score) / sum(component population)`. The section is the unit for the scatter, Spearman coefficient, and smoother. Buildings only inherit section income to support maps and group distributions.

## Grouping and other figures

Within the chosen region or Madrid municipality and chosen income indicator, eligible sections are sorted by income and then `CUSEC`. Each whole section enters the decile or quintile whose population share contains its population midpoint. This avoids splitting sections and yields approximately equal resident populations. These are **groups of areas ranked by income**, not individual-income deciles. The published tables include actual group population shares.

Decile bars are population-weighted mean section scores; their spread marks are population-weighted section-score quartiles. Box plots use weighted 10th, 25th, 50th, 75th and 90th section-score percentiles. Cumulative curves use component scores and modelled resident weights within each area-income quintile. The Four Madrids use separate population-weighted medians of section income and section score as thresholds in the selected geography; ties fall on the lower side.

The fixed sensitivity grid is `D50 ∈ {500, 600, 700}` metres and `p ∈ {2.0, 2.5, 3.0}` for both entrance and platform origins. At `600/2.5`, the duplicate-line multiplier is additionally `{0, 0.05, 0.10, 0.20}`. The summary file reports income–score Spearman, section-rank Spearman against the main score, top-minus-bottom decile mean gap, and the population share whose Four Madrids quadrant changes. The main score was fixed in advance at `600/2.5/0.10`, without picking a specification from the observed relationship.

## Maps and interpretation

Income and income × access use 2024 section polygons. The score map uses actual residential component polygons at close zoom and a population-weighted 2 km square surface at wider zoom; the latter is a display generalisation, not the statistical unit. Missing income is neutral grey. The bivariate legend has text labels in addition to colour.

Income is ecological, the population is modelled, distance is straight-line and not actual walking time, service frequency is not modelled, and the score is a constructed opportunity index. These limits matter when interpreting any spatial association.
