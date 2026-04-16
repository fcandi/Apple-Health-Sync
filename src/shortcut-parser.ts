import type { HealthData, TrainingEntry } from "./providers/provider";
import { normalizeAppleWorkoutType, getActivityCategory } from "./activity-keys";

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Parses the JSON payload from the iOS Shortcut and produces a HealthData object.
 * Validates types (only number and string values are accepted for metrics).
 * Maps workout types to canonical keys.
 */
export function parseShortcutPayload(
	payload: { metrics?: Record<string, unknown>; workouts?: unknown[] },
	_version: string
): HealthData {
	const metrics: Record<string, number | string> = {};
	const activities: Record<string, string> = {};
	const trainings: TrainingEntry[] = [];

	// Metrics — accept number and string values, skip null/undefined
	if (payload.metrics) {
		for (const [key, value] of Object.entries(payload.metrics)) {
			if (value == null) continue;
			if (typeof value === "number" || typeof value === "string") {
				metrics[key] = value;
			}
		}
	}

	// Workouts — map to canonical keys and build display strings
	if (Array.isArray(payload.workouts)) {
		for (const raw of payload.workouts) {
			const w = raw as Record<string, unknown>;
			const rawType = typeof w.type === "string" ? w.type : "workout";
			const normalizedType = normalizeAppleWorkoutType(rawType);
			const category = getActivityCategory(normalizedType);

			// Human-readable display string (same format as Garmin plugin)
			const parts: string[] = [];
			if (w.distance_km) parts.push(`${round1(Number(w.distance_km))} km`);
			if (w.duration_min) parts.push(`${Math.round(Number(w.duration_min))}min`);
			if (w.calories) parts.push(`${Math.round(Number(w.calories))} kcal`);

			if (parts.length > 0) {
				// Group multiple workouts of the same type
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
