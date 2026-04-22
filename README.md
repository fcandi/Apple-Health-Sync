# Apple Health Sync

Sync Apple Health data into your Obsidian Daily Notes — as frontmatter properties you can query with Dataview.

> **Mobile-friendly.** This plugin works on iOS/iPadOS through the Obsidian URL scheme. An iOS Shortcut (generated via the included Python script) reads from HealthKit and hands the data off to the plugin.

> **Status: `v0.1.0-beta.1`** — Shortcut-based MVP feature-complete. A native iOS app replacing the Shortcut is planned.

## Features

- **17 daily metrics** — steps, resting HR, HRV, SpO2, active/resting calories, distance, floors, weight, VO2 max, wrist temperature and more
- **Sleep stages** — Deep / Core / REM / Awake aggregated per wake-up day, format `7h 32min`
- **Workouts** — Hiking, Strength Training, Running etc. written as `hiking: 4.8 km · 63min · 190 kcal`, compatible with the Garmin Health Sync plugin's key naming
- **Multi-day payload** — one shortcut run covers up to 7 days of history; plugin writes each day's Daily Note separately
- **Dirty-check** — identical values are not re-written (avoids LiveSync churn)
- **Today is excluded** — partial days are never written
- **Smart detection** — auto-detects Daily Notes path & format from Periodic Notes or Obsidian's core plugin
- **Language auto-detection** — UI language set from Obsidian (EN, DE)

## Architecture

```
┌──────────────────┐   HealthKit    ┌─────────────────────┐     URL    ┌──────────────────┐
│ iOS Shortcut     │ ─────────────> │ obsidian://apple-   │ ─────────> │ Obsidian Plugin  │
│ (generated via   │                │  health-sync?data=  │            │ (writes to Daily │
│ generate-        │                │  <json>&v=2         │            │  Note frontmatter│
│ shortcut.py)     │                │                     │            │ via LiveSync)    │
└──────────────────┘                └─────────────────────┘            └──────────────────┘
                                             ▲
                                             │
                                 (future: native iOS app
                                  with direct HealthKit API)
```

The **protocol between data source and plugin** is documented in [`docs/PLUGIN_PROTOCOL.md`](docs/PLUGIN_PROTOCOL.md). A native iOS app replacing the Shortcut is planned in a separate repo.

## Frontmatter Output (typical day)

```yaml
---
steps: 10143
resting_hr: 67
hrv: 41
calories_active: 445
intensity_min: 76
distance_km: 8.1
sleep_duration: 7h 12min
sleep_deep: 1h 35min
sleep_light: 4h 20min
sleep_rem: 1h 17min
sleep_awake: 28min
hiking: 4.8 km · 63min · 190 kcal
---
```

## Setup

1. **Install the plugin** via [BRAT](https://github.com/TfTHacker/obsidian42-brat): `fcandi/Apple-Health-Sync`
2. **Install the [Toolbox Pro for Shortcuts](https://toolboxpro.app/)** app on your iPhone (required for workout data — Apple Shortcuts has no native workout query)
3. **Generate the shortcut:**
   ```bash
   python3 generate-shortcut.py --days 7 --cooldown 0 -o Apple-Health-Sync.unsigned.shortcut
   shortcuts sign --mode anyone --input Apple-Health-Sync.unsigned.shortcut --output Apple-Health-Sync.shortcut
   ```
4. **Transfer** `Apple-Health-Sync.shortcut` to the iPhone (AirDrop or iCloud) and run it daily

## Known limitations (Shortcut-based MVP)

- **Manual trigger only** — Automations via "Open App" triggers are unreliable due to HealthKit lock-state and app-switching quirks
- **No workout heart rate** — Toolbox Pro's `GetWorkoutsIntent` doesn't expose average HR
- **No Sleep Score** — Apple exposes the score only in the Health UI, not via HealthKit API
- **HealthKit-blocked when iPhone locked** — time-based automations fail during the night
- **Requires Toolbox Pro** — iOS Shortcuts has no native workout query; Toolbox fills the gap

A native iOS app (planned for `v0.2.0+`) will solve most of these by using HealthKit directly.

## Roadmap

- [ ] **Native iOS app** — replaces the Shortcut, solves the limitations above (separate repo)
- [ ] **Backfill UI** in the plugin (bulk-sync date ranges)
- [ ] **Workout location** (reverse-geocoded, like Garmin Health Sync has)

## Related

- [Garmin Health Sync](https://github.com/fcandi/Garmin-Health-Sync) — sister plugin for Garmin Connect, same frontmatter key naming

## License

MIT
