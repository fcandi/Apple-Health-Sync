import type { HealthData, TrainingEntry } from "./providers/provider";
import { normalizeAppleWorkoutType, getActivityCategory } from "./activity-keys";

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

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

/**
 * Parst den Toolbox-Workout-Rohtext ("Hiking 2026-04-21 at 16:01\n...").
 * Gibt die einzigartigen Workout-Typ-Strings für targetDate zurück (in Reihenfolge).
 */
function parseWorkoutsRawToTypes(raw: unknown, targetDate: string): string[] {
	if (typeof raw !== "string" || !raw.trim()) return [];
	const seen = new Set<string>();
	for (const line of raw.split(/\n|\\n/)) {
		const m = line.trim().match(/^(.+?) (\d{4}-\d{2}-\d{2}) at \d{2}:\d{2}/);
		if (m && m[2] === targetDate) seen.add(m[1]!.trim());
	}
	return Array.from(seen);
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
	payload: { metrics?: Record<string, unknown> }
): string[] {
	const dates = new Set<string>();
	if (!payload.metrics) return [];
	for (const value of Object.values(payload.metrics)) {
		if (isVDPair(value)) {
			for (const d of parseStrList(value.d)) dates.add(d);
		}
	}
	return Array.from(dates).sort();
}

/**
 * Multi-day variant: parses the payload once per day it contains and
 * returns a map of date → HealthData.
 */
export function parseShortcutPayloadMultiDay(
	payload: { metrics?: Record<string, unknown>; workouts?: unknown[]; workouts_raw?: unknown },
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
	payload: { metrics?: Record<string, unknown>; workouts?: unknown[]; workouts_raw?: unknown },
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

	// Workouts aus Toolbox-Rohtext → activities + trainings (wie Garmin-Plugin)
	// Temporär bis eigene App; single-workout-Tag bekommt duration+distance, multi-Tag nur Typ.
	if (payload.workouts_raw) {
		const rawTypes = parseWorkoutsRawToTypes(payload.workouts_raw, targetDate);
		if (rawTypes.length > 0) {
			for (const rawType of rawTypes) {
				const normalizedType = normalizeAppleWorkoutType(rawType);
				const category = getActivityCategory(normalizedType);
				activities[normalizedType] = "";
				trainings.push({ type: normalizedType, category });
			}
		}
	}

	if (Array.isArray(payload.workouts)) {
		for (const raw of payload.workouts) {
			const w = raw as Record<string, unknown>;
			const rawType = typeof w.type === "string" ? w.type : "workout";
			const normalizedType = normalizeAppleWorkoutType(rawType);
			const category = getActivityCategory(normalizedType);

			const parts: string[] = [];
			if (w.distance_km) parts.push(`${round1(Number(w.distance_km))} km`);
			if (w.duration_min) parts.push(`${Math.round(Number(w.duration_min))}min`);
			if (w.calories) parts.push(`${Math.round(Number(w.calories))} kcal`);

			if (parts.length > 0) {
				if (activities[normalizedType]) {
					activities[normalizedType] += ` + ${parts.join(" \u00b7 ")}`;
				} else {
					activities[normalizedType] = parts.join(" \u00b7 ");
				}
			}

			const entry: TrainingEntry = { type: normalizedType, category };
			if (w.distance_km) entry.distance_km = round1(Number(w.distance_km));
			if (w.duration_min) entry.duration_min = Math.round(Number(w.duration_min));
			if (w.calories) entry.calories = Math.round(Number(w.calories));
			trainings.push(entry);
		}
	}

	return { metrics, activities, trainings };
}
