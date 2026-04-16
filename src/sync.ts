import { App } from "obsidian";
import type { HealthData } from "./providers/provider";
import { writeToDailyNote } from "./daily-note";
import type { HealthSyncSettings } from "./settings";
import { convertToImperial } from "./units";

export class SyncManager {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/** Write received health data to the daily note */
	async writeData(
		date: string,
		data: HealthData,
		settings: HealthSyncSettings
	): Promise<boolean> {
		const hasData = Object.keys(data.metrics).length > 0
			|| Object.keys(data.activities).length > 0;
		if (!hasData) return false;

		// Filter to enabled metrics only
		const filteredMetrics: Record<string, number | string> = {};
		for (const [key, value] of Object.entries(data.metrics)) {
			if (settings.enabledMetrics[key]) {
				filteredMetrics[key] = value;
			}
		}
		const filteredData: HealthData = {
			...data,
			metrics: filteredMetrics,
		};

		// Imperial conversion
		const outputData = settings.unitSystem === "imperial"
			? convertToImperial(filteredData)
			: filteredData;

		await writeToDailyNote(this.app, date, outputData, {
			dailyNotePath: settings.dailyNotePath,
			dailyNoteFormat: settings.dailyNoteFormat,
			prefix: settings.usePrefix ? "ohs_" : "",
			template: settings.dailyNoteTemplate,
			writeTrainings: settings.writeTrainings,
			writeWorkoutLocation: false, // No GPS in Shortcut MVP
		});

		return true;
	}
}
