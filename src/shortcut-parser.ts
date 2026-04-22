import type { HealthData, TrainingEntry } from "./providers/provider";
import { normalizeAppleWorkoutType, getActivityCategory } from "./activity-keys";

type VDPair = { v: string | number; d: string };

function isVDPair(value: unknown): value is VDPair {
	return (
		typeof value === "object" &&
		value !== null &&
		"v" in value &&
		"d" in value
	);
}

/**
 * Metriken bei denen ein Tag mehrere Buckets haben kann (z.B. Reise-Zeitzonenwechsel):
 * Point-in-time values werden gemittelt, Zähler summiert.
 */
const AVG_METRICS = new Set([
	"resting_hr", "hrv", "spo2", "respiration_rate",
	"walking_hr_avg", "wrist_temp", "weight_kg",
	"body_fat_pct", "vo2max",
]);

/**
 * Metriken, die als Integer gespeichert werden (keine Nachkommastellen).
 * Float-Artefakte aus HealthKit-Aggregation (z.B. 464.1249999999994) werden weggerundet.
 */
const INT_METRICS = new Set([
	"steps", "resting_hr", "hrv",
	"calories_active", "calories_total", "calories_resting",
	"intensity_min", "floors", "stand_min", "mindful_min",
	"spo2", "respiration_rate", "walking_hr_avg",
]);

/** Metriken, die auf 1 Nachkommastelle gerundet werden (Gewicht, Distanz, etc.). */
const DECIMAL1_METRICS = new Set([
	"distance_km", "distance_mi", "weight_kg", "weight_lbs",
	"body_fat_pct", "vo2max", "wrist_temp",
]);

/**
 * Metriken, die niemals sinnvoll 0 sein können (Vitalwerte, Gewicht, VO2max etc.).
 * iOS' "Fehlende ausfüllen"-Option produziert bei Tagen ohne Messung 0-Werte.
 * Für diese Metriken skippen wir 0 — bestehender Frontmatter-Wert bleibt dann erhalten.
 */
const SKIP_IF_ZERO = new Set([
	"resting_hr", "hrv", "walking_hr_avg",
	"spo2", "respiration_rate",
	"weight_kg", "weight_lbs", "body_fat_pct", "vo2max",
	"wrist_temp",
]);

function roundForKey(key: string, n: number): number {
	if (INT_METRICS.has(key)) return Math.round(n);
	if (DECIMAL1_METRICS.has(key)) return Math.round(n * 10) / 10;
	return n;
}

function parseNumList(raw: unknown): number[] {
	// parseFloat statt Number — iOS fügt Werte oft mit Einheit ein ("12985 count"),
	// parseFloat ignoriert den Textteil nach der Zahl.
	return String(raw)
		.split(/\n+/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => parseFloat(s))
		.filter((n) => Number.isFinite(n));
}

/**
 * Normalisiert iOS-Datums-Strings zu "yyyy-MM-dd".
 * iOS ignoriert teils custom Aggrandizement-Formate und fällt auf Device-Locale zurück.
 * Unterstützt:
 *   - ISO:   "2026-04-16" oder "2026-04-16T00:00:00"
 *   - DE:    "16.04.2026, 00:00" oder "16.04.2026"
 *   - EN:    "Apr 16, 2026" oder "4/16/26" (zukunftssicher)
 */
function normalizeDate(s: string): string {
	const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

	const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
	if (de) {
		return `${de[3]}-${de[2]!.padStart(2, "0")}-${de[1]!.padStart(2, "0")}`;
	}

	// EN-Slash "4/16/26" oder "4/16/2026"
	const enSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
	if (enSlash) {
		const yr = enSlash[3]!.length === 2 ? `20${enSlash[3]}` : enSlash[3]!;
		return `${yr}-${enSlash[1]!.padStart(2, "0")}-${enSlash[2]!.padStart(2, "0")}`;
	}

	// EN-Monatsname "Apr 16, 2026"
	const enName = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
	if (enName) {
		const months: Record<string, string> = {
			jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
			jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
		};
		const m = months[enName[1]!.slice(0, 3).toLowerCase()];
		if (m) return `${enName[3]}-${m}-${enName[2]!.padStart(2, "0")}`;
	}

	return s;
}

function parseStrList(raw: unknown): string[] {
	return String(raw)
		.split(/\n+/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map(normalizeDate);
}

/** iOS serialisiert Zahlen mit DE-Locale ("63,2", "4,84 km") — `,` zu `.` vor parseFloat.
 * parseFloat stoppt an Einheit-Suffixen (" km", " kcal") automatisch. */
function parseLocaleNum(s: string | undefined, fallback = NaN): number {
	if (!s) return fallback;
	const n = parseFloat(s.trim().replace(",", "."));
	return Number.isFinite(n) ? n : fallback;
}

/** Eine Zeile pro Workout (parallele Listen via Toolbox Property-Aggrandizement). */
function splitWorkoutList(raw: unknown): string[] {
	if (typeof raw !== "string") return [];
	return raw.split(/\n|\\n/).map((s) => s.trim());
}

type ParsedWorkoutSource = {
	type?: unknown;
	duration?: unknown;
	distance?: unknown;
	calories?: unknown;
	startTime?: unknown;
};

type WorkoutGroup = { count: number; distanceKm: number; durationMin: number; calories: number };

type SleepSource = {
	start?: unknown;
	end?: unknown;
	duration?: unknown;
	value?: unknown;
};

/** iOS-Sleep-Stage (DE/EN) → Plugin-Metrik-Key. InBed wird ignoriert. */
const SLEEP_STAGE_MAP: Record<string, string> = {
	tief: "sleep_deep",
	kern: "sleep_light",
	rem: "sleep_rem",
	wach: "sleep_awake",
	deep: "sleep_deep",
	core: "sleep_light",
	awake: "sleep_awake",
	"im bett": "",
	"in bed": "",
};

/** Parst iOS-Duration: "30" (Sekunden), "4:31" (MM:SS), "1:23:45" (H:MM:SS). */
function parseDurationToSeconds(s: string): number {
	const t = s.trim();
	if (!t) return 0;
	const parts = t.split(":").map((p) => parseInt(p, 10));
	if (parts.some((n) => !Number.isFinite(n))) return 0;
	if (parts.length === 1) return parts[0]!;
	if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
	if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
	return 0;
}

/** Sekunden → "Xh Ymin" (bzw. "Ymin" wenn <1h). Leer wenn 0. */
function secondsToHoursMin(seconds: number): string {
	if (seconds <= 0) return "";
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	if (h === 0) return `${m}min`;
	return `${h}h ${m}min`;
}


/**
 * v=2-Format: Werte und Datums als parallele Listen. Plugin pickt den Eintrag
 * passend zu targetDate. Mehrere Matches (Zeitzonenwechsel) → Summe bzw.
 * Durchschnitt je nach Metrik-Typ.
 */
function resolveVD(pair: VDPair, key: string, targetDate: string): number | null {
	const values = parseNumList(pair.v);
	const dates = parseStrList(pair.d);

	if (values.length === 0 || dates.length === 0) return null;
	if (values.length !== dates.length) {
		console.warn(
			`Apple Health Sync: values/dates length mismatch for ${key}:`,
			values.length, "vs", dates.length
		);
		return values.length === 1 ? roundForKey(key, values[0]!) : null;
	}

	const matches: number[] = [];
	for (let i = 0; i < dates.length; i++) {
		if (dates[i] === targetDate) matches.push(values[i]!);
	}

	if (matches.length === 0) return null;

	const aggregated = matches.length === 1
		? matches[0]!
		: (AVG_METRICS.has(key)
			? matches.reduce((a, b) => a + b, 0) / matches.length
			: matches.reduce((a, b) => a + b, 0));

	if (SKIP_IF_ZERO.has(key) && aggregated === 0) return null;
	return roundForKey(key, aggregated);
}

/**
 * Collects all unique dates referenced in a v=2 payload. Used by the
 * multi-day variant to iterate over every day the shortcut returned.
 */
export function extractPayloadDates(
	payload: { metrics?: Record<string, unknown>; sleep?: unknown }
): string[] {
	const dates = new Set<string>();
	if (payload.metrics) {
		for (const value of Object.values(payload.metrics)) {
			if (isVDPair(value)) {
				for (const d of parseStrList(value.d)) dates.add(d);
			}
		}
	}
	// Sleep-Wake-up-Dates einbeziehen — falls Schlaf-Nacht auf Tag ohne Metriken fällt
	if (payload.sleep) {
		const s = payload.sleep as SleepSource;
		for (const end of splitWorkoutList(s.end)) {
			const d = normalizeDate(end);
			if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.add(d);
		}
	}
	return Array.from(dates).sort();
}

/**
 * Multi-day variant: parses the payload once per day it contains and
 * returns a map of date → HealthData.
 */
export function parseShortcutPayloadMultiDay(
	payload: { metrics?: Record<string, unknown>; workouts?: unknown; sleep?: unknown },
	version: string
): Record<string, HealthData> {
	const out: Record<string, HealthData> = {};
	for (const date of extractPayloadDates(payload)) {
		out[date] = parseShortcutPayload(payload, version, date);
	}
	return out;
}

/**
 * Parses the JSON payload from the iOS Shortcut and produces a HealthData object.
 * Supports two payload formats:
 *   v=1: metrics.X is a number or simple string
 *   v=2: metrics.X is { v: "<values list>", d: "<yyyy-MM-dd list>" } — plugin
 *        picks the entry matching targetDate
 */
export function parseShortcutPayload(
	payload: { metrics?: Record<string, unknown>; workouts?: unknown; sleep?: unknown },
	_version: string,
	targetDate: string
): HealthData {
	const metrics: Record<string, number | string> = {};
	const activities: Record<string, string> = {};
	const trainings: TrainingEntry[] = [];

	if (payload.metrics) {
		for (const [key, value] of Object.entries(payload.metrics)) {
			if (value == null) continue;

			if (isVDPair(value)) {
				const resolved = resolveVD(value, key, targetDate);
				if (resolved !== null) metrics[key] = resolved;
			} else if (typeof value === "number" || typeof value === "string") {
				metrics[key] = value;
			}
		}

		// Synthetische Metriken
		// calories_total = active + resting (wenn beide vorhanden)
		if (typeof metrics.calories_active === "number" &&
			typeof metrics.calories_resting === "number") {
			metrics.calories_total = roundForKey(
				"calories_total",
				metrics.calories_active + metrics.calories_resting
			);
		}
		// body_fat_pct: HealthKit liefert Fraktion (0.18) → in Prozent umrechnen
		if (typeof metrics.body_fat_pct === "number" && metrics.body_fat_pct < 1) {
			metrics.body_fat_pct = roundForKey("body_fat_pct", metrics.body_fat_pct * 100);
		}
	}

	// Workouts — parallele Property-Listen von Toolbox GetWorkoutsIntent.
	// Format identisch zum Garmin-Plugin: "4.7 km · 97min · 315 kcal" (outdoor)
	// bzw. "30min · 155 kcal" (gym). Ø bpm nicht, weil Toolbox keine HR liefert.
	if (payload.workouts) {
		const w = payload.workouts as ParsedWorkoutSource;
		const types = splitWorkoutList(w.type);
		const durations = splitWorkoutList(w.duration);
		const distances = splitWorkoutList(w.distance);
		const cals = splitWorkoutList(w.calories);
		const starts = splitWorkoutList(w.startTime);
		const n = Math.min(types.length, durations.length, starts.length);

		const grouped = new Map<string, WorkoutGroup>();
		for (let i = 0; i < n; i++) {
			const t = types[i]!;
			const startDate = normalizeDate(starts[i]!);
			if (!t || startDate !== targetDate) continue;

			const durMin = parseLocaleNum(durations[i]);
			if (!Number.isFinite(durMin) || durMin <= 0) continue;

			const distKm = parseLocaleNum(distances[i], 0);
			const cal = parseLocaleNum(cals[i], 0);

			const normalizedType = normalizeAppleWorkoutType(t);
			const g = grouped.get(normalizedType)
				?? { count: 0, distanceKm: 0, durationMin: 0, calories: 0 };
			g.count += 1;
			g.durationMin += durMin;
			g.distanceKm += distKm;
			g.calories += cal;
			grouped.set(normalizedType, g);
		}

		for (const [normalizedType, data] of grouped) {
			const parts: string[] = [];
			if (data.count > 1) parts.push(`${data.count}x`);
			if (data.distanceKm > 0) parts.push(`${Math.round(data.distanceKm * 10) / 10} km`);
			if (data.durationMin > 0) parts.push(`${Math.round(data.durationMin)}min`);
			if (data.calories > 0) parts.push(`${Math.round(data.calories)} kcal`);

			activities[normalizedType] = parts.join(" \u00b7 ");

			const category = getActivityCategory(normalizedType);
			const entry: TrainingEntry = { type: normalizedType, category };
			if (data.distanceKm > 0) entry.distance_km = Math.round(data.distanceKm * 10) / 10;
			if (data.durationMin > 0) entry.duration_min = Math.round(data.durationMin);
			if (data.calories > 0) entry.calories = Math.round(data.calories);
			trainings.push(entry);
		}
	}

	// Sleep — Segmente werden per End-Date (Wake-up) dem Ziel-Tag zugeordnet.
	// sleep_duration = Summe aus Deep + Kern/Light + REM (ohne Wach, ohne InBed).
	if (payload.sleep) {
		const s = payload.sleep as SleepSource;
		const ends = splitWorkoutList(s.end);
		const durations = splitWorkoutList(s.duration);
		const values = splitWorkoutList(s.value);
		const n = Math.min(ends.length, durations.length, values.length);

		const stageSec: Record<string, number> = {
			sleep_deep: 0, sleep_light: 0, sleep_rem: 0, sleep_awake: 0,
		};
		let any = false;
		for (let i = 0; i < n; i++) {
			const wakeDate = normalizeDate(ends[i]!);
			if (wakeDate !== targetDate) continue;
			const stageKey = SLEEP_STAGE_MAP[values[i]!.trim().toLowerCase()];
			if (!stageKey) continue;
			const sec = parseDurationToSeconds(durations[i]!);
			if (sec <= 0) continue;
			stageSec[stageKey]! += sec;
			any = true;
		}

		if (any) {
			const total = stageSec.sleep_deep! + stageSec.sleep_light! + stageSec.sleep_rem!;
			const fmt: Record<string, string> = {
				sleep_duration: secondsToHoursMin(total),
				sleep_deep:     secondsToHoursMin(stageSec.sleep_deep!),
				sleep_light:    secondsToHoursMin(stageSec.sleep_light!),
				sleep_rem:      secondsToHoursMin(stageSec.sleep_rem!),
				sleep_awake:    secondsToHoursMin(stageSec.sleep_awake!),
			};
			for (const [k, v] of Object.entries(fmt)) {
				if (v) metrics[k] = v;
			}
		}
	}

	return { metrics, activities, trainings };
}
