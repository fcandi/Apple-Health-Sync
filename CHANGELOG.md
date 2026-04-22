# Changelog

## `v0.1.0-beta.1` — 2026-04-22 · Shortcut-based MVP feature-complete

Milestone marking the end of the alpha cycle. Metrics, workouts and sleep are all sourced via an iOS Shortcut + Toolbox Pro app.

**Highlights seit der letzten Version:**

- **Sleep-Tracking** (alpha.26) — Stages (Deep / Core / REM / Awake) via HealthKit-Segmente, aggregiert per Wake-up-Tag, Format `7h 32min`
- **Echte Per-Workout-Duration** (alpha.23) — Property-Aggrandizement mit `PropertyName` (statt des gesuchten `WFPropertyName`) liefert Duration/Distance/Calories pro Workout
- **Garmin-kompatibles Format** (alpha.24) — `hiking: 4.7 km · 97min · 315 kcal`, same frontmatter keys as the Garmin Health Sync sister plugin

**Offizielles Übergabe-Dokument für die nächste Phase (native iOS App):** [`docs/PLUGIN_PROTOCOL.md`](docs/PLUGIN_PROTOCOL.md).

---

## Pre-beta alphas (2026-04-19 — 2026-04-22)

Compressed — see GitHub release history for details.

- `alpha.26` — Sleep-Integration (HealthKit-Segmente + Stage-Aggregation)
- `alpha.25` — Sleep-Debug-Handler
- `alpha.24` — Garmin-Format für Activity-Strings
- `alpha.23` — Property-Aggrandizement-Durchbruch, echte Workout-Duration
- `alpha.18–22` — Workout-Discovery (Toolbox GetWorkoutsIntent, Property-Namen-Reverse-Engineering)
- `alpha.13–17` — Multi-day payload (v=2), today-exclusion, dirty-check, debug-note, cooldown defaults
- `alpha.1–12` — initial plugin, 17 quantity metrics, date parsing, auto-detection
