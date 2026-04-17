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

function parseNumList(raw: unknown): number[] {
	// parseFloat statt Number — iOS fügt Werte oft mit Einheit ein ("12985 count"),
	// parseFloat ignoriert den Textteil nach der Zahl.
	return String(raw)
		.split(/[\n,]+/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => parseFloat(s))
		.filter((n) => Number.isFinite(n));
}

function parseStrList(raw: unknown): string[] {
	return String(raw)
		.split(/[\n,]+/)
		.map((s) => s.trim())
		.filter(Boolean);
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
		return values.length === 1 ? values[0]! : null;
	}

	const matches: number[] = [];
	for (let i = 0; i < dates.length; i++) {
		if (dates[i] === targetDate) matches.push(values[i]!);
	}

	if (matches.length === 0) return null;
	if (matches.length === 1) return matches[0]!;

	const sum = matches.reduce((a, b) => a + b, 0);
	return AVG_METRICS.has(key) ? sum / matches.length : sum;
}

/**
 * Parses the JSON payload from the iOS Shortcut and produces a HealthData object.
 * Supports two payload formats:
 *   v=1: metrics.X is a number or simple string
 *   v=2: metrics.X is { v: "<values list>", d: "<yyyy-MM-dd list>" } — plugin
 *        picks the entry matching targetDate
 */
export function parseShortcutPayload(
	payload: { metrics?: Record<string, unknown>; workouts?: unknown[] },
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
