# Apple Health Sync — Plugin Protocol

> Spezifikation der Schnittstelle zwischen **Datenquelle** (iOS Shortcut / native App) und dem **Obsidian-Plugin** `apple-health-sync`.
>
> Dieses Dokument kann in das Repo einer neuen Datenquelle (z.B. nativer iOS-App) übernommen werden.

## Stand

- **Plugin:** `0.1.0-beta.1` (Repo `fcandi/Apple-Health-Sync`)
- **Payload-Version:** `v=2`
- **Letzte Validierung:** 2026-04-22 mit Shortcut `Apple-Health-Sync-v23.shortcut`

---

## 1. URL-Schema

Das Plugin registriert sich als Obsidian-Protokoll-Handler:

```
obsidian://apple-health-sync?data=<urlencoded JSON>&v=2
```

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `data` | URL-encoded JSON | ja | Payload (siehe §2) |
| `v` | String | empfohlen | Payload-Version (`2` = aktuell) |
| `date` | `YYYY-MM-DD` | optional | Fallback-Datum wenn keine per-Metric-Daten im Payload |

### Debug-Parameter (nicht Teil des Haupt-Flows)

| Parameter | Zweck |
|---|---|
| `workout_debug=<text>` | Speichert Raw-Text nach `_apple-health-sync/workout-debug-raw.md` |
| `sleep_debug=<text>` | Speichert Raw-Text nach `_apple-health-sync/sleep-debug-raw.md` |

### Limits / Caveats

- iOS URL-Scheme-Payloads werden erfahrungsgemäß bei ~16 KB abgeschnitten. 7 Tage ≈ 2–3 KB, 30 Tage ≈ 8–10 KB. **Begrenze den Payload auf Bedarfs-Daten.**
- Das Plugin **cleant** die Payload vor `JSON.parse`:
  - Literale Newlines (`\n`) werden zu `\\n` escaped (iOS liefert mehrzeilige Werte mit echten LFs)
  - Leere Werte (`:,` und `:}`) werden zu `:null` korrigiert

---

## 2. JSON-Payload

Top-Level-Struktur:

```json
{
  "date": "2026-04-21",
  "metrics": { ... },
  "workouts": { ... },
  "sleep": { ... }
}
```

Alle Felder sind **optional** — sende nur was du hast.

### 2.1 `metrics` — Numerische Tagesmetriken

Format pro Metrik: `{ "v": "<value list>", "d": "<date list>" }` (parallele Listen, Newline-separiert).

Newlines können als `\n` oder literale Zeilenumbrüche gesendet werden; das Plugin normalisiert beides.

```json
"metrics": {
  "steps":           { "v": "8579\n10143\n12985", "d": "2026-04-17\n2026-04-18\n2026-04-19" },
  "resting_hr":      { "v": "65\n67\n66",          "d": "2026-04-17\n2026-04-18\n2026-04-19" },
  "distance_km":     { "v": "6.4\n8.1\n9.2",       "d": "..." }
}
```

**Datums-Parsing (automatisch):**
- ISO `2026-04-21` oder `2026-04-21T00:00:00`
- DE `21.04.2026, 00:00` oder `21.04.2026`
- EN `Apr 21, 2026`, `4/21/26`, `4/21/2026`

**Zahlen-Parsing (automatisch):**
- `parseFloat` stoppt an Einheit-Suffixen → `"12985 count"` → `12985`
- Komma als Dezimaltrenner wird zu Punkt konvertiert (`"4,84"` → `4.84`)

### 2.1.1 Unterstützte Metrik-Keys

Metriken sind in `src/metrics.ts` definiert. Das Plugin schreibt nur aktivierte Metriken; Unbekannte werden ignoriert.

**Standard (default enabled):**

| Key | Typ | HealthKit-Quelle |
|---|---|---|
| `steps` | number | Steps |
| `sleep_duration` | string | aggregiert aus Sleep-Stages |
| `resting_hr` | number | Resting Heart Rate |
| `hrv` | number | Heart Rate Variability |
| `calories_active` | number | Active Calories |
| `intensity_min` | number | Exercise Time |

**Extended (default disabled):**

| Key | Typ | Quelle |
|---|---|---|
| `spo2` | number | Oxygen Saturation |
| `respiration_rate` | number | Respiratory Rate |
| `calories_total` | number | `calories_active + calories_resting` (synthetisch) |
| `calories_resting` | number | Resting Calories |
| `distance_km` | number | Walking + Running Distance |
| `floors` | number | Flights Climbed |
| `sleep_deep`, `sleep_light`, `sleep_rem`, `sleep_awake` | string | Sleep-Stages |
| `weight_kg` | number | Weight |
| `body_fat_pct` | number | Body Fat Percentage (HealthKit liefert Fraktion <1; Plugin multipliziert ×100) |
| `vo2max` | number | VO2 Max |
| `walking_hr_avg` | number | Walking Heart Rate Average |
| `stand_min` | number | Stand Time |
| `wrist_temp` | number | Sleep Wrist Temperature |
| `mindful_min` | number | Mindful Session |

### 2.1.2 Rundung und Skip-Regeln

Werden vom Plugin automatisch angewendet:

**Integer-Metriken** (aufgerundet): `steps`, `resting_hr`, `hrv`, `calories_*`, `intensity_min`, `floors`, `stand_min`, `mindful_min`, `spo2`, `respiration_rate`, `walking_hr_avg`.

**1-Dezimal-Metriken**: `distance_km`, `distance_mi`, `weight_kg`, `weight_lbs`, `body_fat_pct`, `vo2max`, `wrist_temp`.

**`SKIP_IF_ZERO`** (Wert 0 = kein Write, bestehender Wert bleibt erhalten): alle Vitalwerte + Körpermaße (`resting_hr`, `hrv`, `walking_hr_avg`, `spo2`, `respiration_rate`, `weight_*`, `body_fat_pct`, `vo2max`, `wrist_temp`).

**Mittelung**: Bei Mehrfach-Samples am gleichen Tag (z.B. Zeitzonenwechsel) werden Point-in-time-Werte (HR, HRV, SpO2, Gewicht, …) **gemittelt**, Zähler (Steps, Kalorien, Distanz, Minuten) **summiert**.

### 2.2 `workouts` — Parallel-Listen pro Property

Ein Eintrag pro Workout, Newline-separiert. Alle Felder optional, aber konsistent gleich lang.

```json
"workouts": {
  "type":      "Hiking\nTraditional Strength Training",
  "duration":  "63,2\n45,5",
  "distance":  "4,84 km\n0 km",
  "calories":  "190 kcal\n155 kcal",
  "startTime": "21.04.2026, 16:01\n21.04.2026, 18:30"
}
```

**Parsing-Regeln:**
- `duration`: Minuten (Dezimal mit `,` oder `.`)
- `distance`: Einheit-Suffix wird abgeschnitten (`"4,84 km"` → `4.84`)
- `calories`: dito (`"190 kcal"` → `190`)
- `startTime`: Datum (siehe §2.1 Parser) — wird auf `YYYY-MM-DD` normalisiert und dem Ziel-Tag zugeordnet
- `type`: Display-Name wird via `src/activity-keys.ts::normalizeAppleWorkoutType` zu canonical key normalisiert (z.B. `"Traditional Strength Training"` → `strength_training`)

**Output im Daily Note (pro Tag):**
```yaml
hiking: 4.8 km · 63min · 190 kcal
strength_training: 46min · 155 kcal
```

- Mehrere Workouts gleichen Typs am selben Tag werden summiert: `2x · 9.4 km · 126min · 380 kcal`
- Distanz wird nur geschrieben wenn > 0
- Kalorien nur wenn > 0
- `Ø bpm` fehlt (Shortcut-Quelle hat keine HR — zukünftige App kann es liefern via optionales Feld `avgHr` pro Workout)

### 2.3 `sleep` — Segment-Listen

Ein Eintrag pro Sleep-Stage-Segment.

```json
"sleep": {
  "start":    "20.04.2026, 23:43\n21.04.2026, 00:10\n...",
  "end":      "21.04.2026, 00:10\n21.04.2026, 00:27\n...",
  "duration": "27:15\n16:40\n...",
  "value":    "Kern\nTief\n..."
}
```

**Parsing-Regeln:**
- `duration`: iOS-Format — `"30"` (Sekunden, wenn <60s), `"MM:SS"`, `"H:MM:SS"`
- `value`: Sleep-Stage als lokalisierter String
  - DE: `Tief` / `Kern` / `REM` / `Wach` / `Im Bett`
  - EN: `Deep` / `Core` / `REM` / `Awake` / `In Bed`
  - Mapping in `src/shortcut-parser.ts::SLEEP_STAGE_MAP`
- **InBed wird ignoriert** (zählt nicht zu `sleep_duration`)

**Nacht-Zuordnung:** Segmente werden per **End-Date (Wake-up-Time)** dem Ziel-Tag zugeordnet. Wer am 20. um 23:43 einschläft und am 21. um 07:13 aufwacht, bekommt den Schlaf am 21. einge­tragen.

**Output im Daily Note:**
```yaml
sleep_duration: 7h 2min
sleep_deep: 1h 25min
sleep_light: 4h 10min
sleep_rem: 1h 27min
sleep_awake: 25min
```

- `sleep_duration = sleep_deep + sleep_light + sleep_rem` (ohne Wach/InBed)
- Format: `Xh Ymin` (bzw. `Ymin` wenn <1h)
- Nicht-Native: Apple **exposed keinen Sleep-Score** via HealthKit (auch nicht in iOS 26). Falls eine native App einen eigenen Score berechnet, sollte sie ihn als neue Metrik `sleep_score` (number, 0-100) senden — das Plugin hat den Slot frei.

---

## 3. Plugin-Verhalten

### 3.1 Cooldown

- Plugin hat eine Cooldown-Einstellung (`syncCooldownMinutes`, default `0`). Bei `> 0`: Payload wird verworfen, wenn letzter erfolgreicher Sync weniger als N Minuten her
- **Bypass:** Wurde der Sync via Obsidian-Command (`trigger-health-sync`) <60s vorher ausgelöst, wird der Cooldown ignoriert

### 3.2 Heute-Ausschluss

Das Plugin schreibt **niemals Daten für den aktuellen Kalendertag** (Tag ist bis Mitternacht unvollständig). Eine Quelle darf Today-Daten mitsenden — sie werden serverseitig verworfen.

### 3.3 Dirty-Check

Vor dem Schreiben vergleicht das Plugin die neuen Werte mit dem bestehenden Frontmatter. **Identische Werte → kein Write** (schont LiveSync-Transaktionen).

### 3.4 Multi-Day-Payload

Das Plugin parst `metrics` pro in `d`-Listen vorkommendem Datum einzeln. Eine Payload darf also problemlos 7+ Tage enthalten — alle werden separat in die jeweilige Daily Note geschrieben (außer heute).

Sleep-Wake-up-Dates werden ebenfalls als Tage berücksichtigt (falls eine Nacht keine anderen Metriken hat).

### 3.5 Daily-Note-Pfad

Das Plugin erkennt automatisch:
- Periodic Notes Plugin-Konfiguration (Folder + Format)
- Obsidian Core Daily Notes
- Fallback: Root-Ordner, `YYYY-MM-DD.md`

---

## 4. URL-Encoding & Newlines — typischer Absender-Flow

```
1. JSON-Objekt als String bauen (literale LFs OK in Werten)
2. URL-encodeComponent() auf den String
3. URL bauen: obsidian://apple-health-sync?data=<encoded>&v=2
4. URL öffnen (iOS: openURL, macOS: NSWorkspace)
```

Das Plugin macht:
```
1. URL-decode (automatisch durch Obsidian-Framework)
2. replace /\n/g with "\\n"   // literale LF → JSON-valid
3. replace /:,/g with ":null," // leere Properties
4. replace /:}/g with ":null}" // letzter leerer Wert
5. JSON.parse
```

---

## 5. Minimales Valid-Beispiel

```json
{
  "metrics": {
    "steps": { "v": "8579", "d": "2026-04-20" }
  }
}
```

URL:
```
obsidian://apple-health-sync?data=%7B%22metrics%22%3A%7B%22steps%22%3A%7B%22v%22%3A%228579%22%2C%22d%22%3A%222026-04-20%22%7D%7D%7D&v=2
```

Ergebnis im Daily Note `2026-04-20.md`:
```yaml
---
steps: 8579
---
```

---

## 6. Referenz-Implementierungen

- **Shortcut-Generator (Python):** `generate-shortcut.py` — erzeugt iOS-Shortcut-Plist-Dateien, siehe Main-Build `build_actions()`
- **Parser-Logik:** `src/shortcut-parser.ts` — maßgeblich für Payload-Format
- **Activity-Key-Normalisierung:** `src/activity-keys.ts` — Apple-HK-Typen → canonical keys (gleiche Keys wie Garmin Health Sync für Cross-Plugin-Kompatibilität)
- **Metriken-Definition:** `src/metrics.ts` — authoritative Liste der erkannten Keys

## 7. Nicht-dokumentiertes Verhalten / Gotchas

- **iOS DE-Locale** liefert `"4,84"` statt `"4.84"` — Plugin normalisiert automatisch
- **Shortcuts Property-Aggrandizement:** Der Key heißt `PropertyName` (nicht `WFPropertyName`!), Werte sind interne camelCase-Identifier (`duration`, `totalDistance`) — nicht UI-Labels (`Dauer`, `Total Distance`)
- **HealthKit Category-Samples** (Sleep) unterstützen **nicht** `WFPropertyVariableAggrandizement`. Stattdessen: `is.workflow.actions.properties.health.quantity` mit `WFContentItemPropertyName` verwenden (DE-lokalisierter OutputName wie `Startdatum`, `Enddatum`, `Dauer`, `Wert`)
- **Toolbox Pro** (`com.alexhay.ToolboxProForShortcuts`) war im Shortcut-MVP nötig für Workouts — iOS bietet keine native Workout-Query. Bei nativer App: direkter `HKWorkoutType`-Zugriff
- **`Shortcut-Signing`:** Geteilte Shortcuts sind AEA-encrypted. Key-Extraktion: Cert aus AEA-AuthData (`magic 30 82`) → `openssl x509 -inform DER -pubkey -noout > key.pem` → `aea decrypt -sign-pub key.pem`. **Nicht** das alte `hex:...` Format verwenden!
