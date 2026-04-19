import { App } from "obsidian";
import type { HealthData } from "./providers/provider";
import { writeToDailyNote } from "./daily-note";
import type { HealthSyncSettings } from "./settings";
import { convertToImperial } from "./units";

export interface SyncResult {
	/** Days actually written (dirty-check passed) */
	written: number;
	/** Days where the dailly note was already up to date */
	unchanged: number;
	/** Days with no data after filtering */
	empty: number;
}

export class SyncManager {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/** Writes one or more days of health data to their respective daily notes. */
	async writeData(
		dateToData: Record<string, HealthData>,
		settings: HealthSyncSettings
	): Promise<SyncResult> {
		const result: SyncResult = { written: 0, unchanged: 0, empty: 0 };

		for (const [date, data] of Object.entries(dateToData)) {
			const hasData = Object.keys(data.metrics).length > 0
				|| Object.keys(data.activities).length > 0;
			if (!hasData) {
				result.empty++;
				continue;
			}

			const filteredMetrics: Record<string, number | string> = {};
			for (const [key, value] of Object.entries(data.metrics)) {
				if (settings.enabledMetrics[key]) {
					filteredMetrics[key] = value;
				}
			}
			const filteredData: HealthData = { ...data, metrics: filteredMetrics };

			const outputData = settings.unitSystem === "imperial"
				? convertToImperial(filteredData)
				: filteredData;

			const didWrite = await writeToDailyNote(this.app, date, outputData, {
				dailyNotePath: settings.dailyNotePath,
				dailyNoteFormat: settings.dailyNoteFormat,
				prefix: settings.usePrefix ? "ohs_" : "",
				template: settings.dailyNoteTemplate,
				writeTrainings: settings.writeTrainings,
				writeWorkoutLocation: false,
			});

			if (didWrite) result.written++;
			else result.unchanged++;
		}

		return result;
	}
}
