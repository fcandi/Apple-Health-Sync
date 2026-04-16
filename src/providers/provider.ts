/** Structured training data for machine-readable output */
export interface TrainingEntry {
	type: string;
	category: string;
	distance_km?: number;
	distance_mi?: number;
	duration_min?: number;
	avg_hr?: number;
	calories?: number;
}

/** Normalized health data — provider-independent */
export interface HealthData {
	/** Metrics as key-value pairs (normalized keys) */
	metrics: Record<string, number | string>;
	/** Activities/trainings as key-value pairs (human-readable) */
	activities: Record<string, string>;
	/** Structured training data (machine-readable, optional) */
	trainings?: TrainingEntry[];
	/** Start coordinates of the first activity with GPS */
	startLocation?: { lat: number; lon: number };
}
