export interface MetricDefinition {
	key: string;
	type: "number" | "string";
	category: "standard" | "extended";
	defaultEnabled: boolean;
}

export const METRICS: MetricDefinition[] = [
	// Standard (enabled by default)
	{ key: "steps",           type: "number", category: "standard", defaultEnabled: true },
	{ key: "workout_types",   type: "string", category: "standard", defaultEnabled: true },
	{ key: "sleep_duration",  type: "string", category: "standard", defaultEnabled: true },
	{ key: "resting_hr",      type: "number", category: "standard", defaultEnabled: true },
	{ key: "hrv",             type: "number", category: "standard", defaultEnabled: true },
	{ key: "calories_active", type: "number", category: "standard", defaultEnabled: true },
	{ key: "intensity_min",   type: "number", category: "standard", defaultEnabled: true },

	// Extended — compatible with Garmin Health Sync
	{ key: "spo2",             type: "number", category: "extended", defaultEnabled: false },
	{ key: "respiration_rate", type: "number", category: "extended", defaultEnabled: false },
	{ key: "calories_total",   type: "number", category: "extended", defaultEnabled: false },
	{ key: "distance_km",     type: "number", category: "extended", defaultEnabled: false },
	{ key: "floors",           type: "number", category: "extended", defaultEnabled: false },
	{ key: "sleep_deep",      type: "string", category: "extended", defaultEnabled: false },
	{ key: "sleep_light",     type: "string", category: "extended", defaultEnabled: false },
	{ key: "sleep_rem",       type: "string", category: "extended", defaultEnabled: false },
	{ key: "sleep_awake",     type: "string", category: "extended", defaultEnabled: false },
	{ key: "weight_kg",       type: "number", category: "extended", defaultEnabled: false },
	{ key: "body_fat_pct",    type: "number", category: "extended", defaultEnabled: false },

	// Extended — Apple Health exclusive
	{ key: "vo2max",          type: "number", category: "extended", defaultEnabled: false },
	{ key: "walking_hr_avg",  type: "number", category: "extended", defaultEnabled: false },
	{ key: "stand_min",       type: "number", category: "extended", defaultEnabled: false },
	{ key: "wrist_temp",      type: "number", category: "extended", defaultEnabled: false },
	{ key: "mindful_min",     type: "number", category: "extended", defaultEnabled: false },
];

export function getDefaultEnabledMetrics(): Record<string, boolean> {
	const enabled: Record<string, boolean> = {};
	for (const m of METRICS) {
		enabled[m.key] = m.defaultEnabled;
	}
	return enabled;
}

export function applyPrefix(key: string, prefix: string): string {
	return prefix ? `${prefix}${key}` : key;
}
