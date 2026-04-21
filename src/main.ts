import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, HealthSyncSettings, HealthSyncSettingTab } from "./settings";
import { SyncManager } from "./sync";
import { parseShortcutPayload, parseShortcutPayloadMultiDay } from "./shortcut-parser";
import type { HealthData } from "./providers/provider";
import { t } from "./i18n/t";

export default class AppleHealthSyncPlugin extends Plugin {
	settings: HealthSyncSettings;
	private syncManager: SyncManager;
	/** Timestamp of the last manual trigger. Lets the URI handler bypass the cooldown when the user explicitly fired the Obsidian command. */
	private manualTriggerAt = 0;
	private static readonly MANUAL_TRIGGER_WINDOW_MS = 60_000;

	async onload() {
		await this.loadSettings();
		this.autoDetectDailyNotePath();

		this.syncManager = new SyncManager(this.app);

		// URI Handler — core of the plugin
		this.registerObsidianProtocolHandler("apple-health-sync", (params) => {
			void this.handleHealthSyncUri(params);
		});

		// Command: Trigger Sync (opens Shortcut via URL scheme)
		this.addCommand({
			id: "trigger-health-sync",
			name: t("commandTriggerSync", this.settings.language),
			callback: () => this.triggerShortcut(),
		});

		// Settings Tab
		this.addSettingTab(new HealthSyncSettingTab(this.app, this));
	}

	private async handleHealthSyncUri(params: Record<string, string>) {
		// Debug-Modus: raw Workout-Daten vom Toolbox-Test-Shortcut entgegennehmen
		if (params.workout_debug !== undefined) {
			await this.writeWorkoutDebugFile(params.workout_debug);
			new Notice("Apple Health Sync: Workout-Debug gespeichert → _apple-health-sync/workout-debug-raw.md");
			return;
		}

		const { data, v } = params;
		let { date } = params;

		if (!data) {
			new Notice(t("noticeInvalidData", this.settings.language), 8000);
			console.error("Apple Health Sync: empty data param. All params:", Object.keys(params).join(", "));
			return;
		}

		// Cooldown: Skip if previous successful sync is too recent.
		// Bypassed if the Obsidian "trigger sync" command was fired <60s ago — that's an explicit user intent.
		const cooldownMinutes = this.settings.syncCooldownMinutes;
		const manualBypass = Date.now() - this.manualTriggerAt < AppleHealthSyncPlugin.MANUAL_TRIGGER_WINDOW_MS;
		if (cooldownMinutes > 0 && !manualBypass && this.settings.lastSyncTime > 0) {
			const elapsedMs = Date.now() - this.settings.lastSyncTime;
			const cooldownMs = cooldownMinutes * 60_000;
			if (elapsedMs < cooldownMs) {
				const remainingMin = Math.ceil((cooldownMs - elapsedMs) / 60_000);
				console.debug(`Apple Health Sync: skipped (cooldown — ${remainingMin}min remaining of ${cooldownMinutes}min)`);
				await this.writeSkippedDebugFile(remainingMin, cooldownMinutes);
				return;
			}
		}

		try {
			// iOS-Listen in Text-Variablen enthalten rohe Newlines — in JSON-Strings
			// technisch ungültig. Vor JSON.parse zu \n escapen.
			const cleanedData = data
				.replace(/\n/g, "\\n")
				.replace(/:,/g, ":null,")
				.replace(/:}/g, ":null}");
			console.debug("Apple Health Sync: cleaned data:", cleanedData.substring(0, 200));
			const payload = JSON.parse(cleanedData) as { date?: string; metrics?: Record<string, unknown>; workouts?: unknown[] };

			if (!date && payload.date) {
				date = payload.date;
			}
			if (!date) {
				const d = new Date();
				d.setDate(d.getDate() - 1);
				date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
			}

			if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
				new Notice(t("noticeInvalidDate", this.settings.language));
				return;
			}

			// Prefer multi-day parsing (v=2 payload with {v,d} pairs).
			// Fall back to single-day when the payload has no date info per metric.
			const multiDayData = parseShortcutPayloadMultiDay(payload, v ?? "2");
			let dateToData: Record<string, HealthData>;
			if (Object.keys(multiDayData).length > 0) {
				dateToData = multiDayData;
			} else {
				const single = parseShortcutPayload(payload, v ?? "1", date);
				dateToData = { [date]: single };
			}

			// Exclude today — partial data should not be written.
			const todayLocal = (() => {
				const n = new Date();
				return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
			})();
			for (const d of Object.keys(dateToData)) {
				if (d >= todayLocal) delete dateToData[d];
			}

			const totalMetricKeys = payload.metrics ? Object.keys(payload.metrics).length : 0;
			const syncDays = Object.keys(dateToData).sort();
			console.debug("Apple Health Sync: parsed", syncDays.length, "days (" + syncDays.join(",") + "), totalMetricKeys:", totalMetricKeys);

			const result = await this.syncManager.writeData(dateToData, this.settings);
			await this.writeDebugFile(payload, dateToData, syncDays, result, cleanedData);
			const writtenPlusUnchanged = result.written + result.unchanged;

			if (writtenPlusUnchanged > 0) {
				// Track the most recent day that had data
				this.settings.lastSyncDate = syncDays[syncDays.length - 1] ?? date;
				this.settings.lastSyncTime = Date.now();
				await this.saveSettings();
				new Notice(
					t("noticeSyncSuccess", this.settings.language)
						.replace("{written}", String(result.written))
						.replace("{unchanged}", String(result.unchanged))
						.replace("{total}", String(writtenPlusUnchanged))
				);
			} else {
				const base = `${t("noticeSyncNoData", this.settings.language)} (0/${totalMetricKeys} · ${date})`;
				const snippet = cleanedData.length > 400
					? cleanedData.substring(0, 400) + "…"
					: cleanedData;
				new Notice(`${base}\n\n${snippet}`, 30000);
			}
		} catch (error) {
			console.error("Apple Health Sync: URI handler error", error);
			new Notice(t("noticeSyncError", this.settings.language));
		}
	}

	/** Schreibt den rohen Toolbox-Output in workout-debug-raw.md für manuelle Analyse. */
	private async writeWorkoutDebugFile(raw: string): Promise<void> {
		const lines = [
			`# Workout Debug — Raw Output`,
			`**Empfangen:** ${new Date().toLocaleString()}`,
			`**Länge:** ${raw.length} Zeichen`,
			``,
			`## Rohtext (iOS String-Darstellung der Workout-Objekte)`,
			``,
			"```",
			raw,
			"```",
		];
		const folder = "_apple-health-sync";
		const path = `${folder}/workout-debug-raw.md`;
		if (!this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, lines.join("\n"));
		} else {
			await this.app.vault.create(path, lines.join("\n"));
		}
	}

	/** Writes a short debug note when sync is skipped due to cooldown. */
	private async writeSkippedDebugFile(remainingMin: number, cooldownMin: number): Promise<void> {
		const lines = [
			`# Apple Health Sync — Debug`,
			`**Letzter Sync:** ${new Date().toLocaleString()}`,
			``,
			`## Ergebnis`,
			`**ÜBERSPRUNGEN** — Cooldown aktiv (noch ${remainingMin} von ${cooldownMin} Minuten)`,
			``,
			`→ Cooldown in den Plugin-Einstellungen auf 0 setzen zum Debuggen.`,
		];
		await this.writeDebugContent(lines.join("\n"));
	}

	/** Writes a sync debug file to _apple-health-sync/debug.md in the vault. */
	private async writeDebugFile(
		payload: { metrics?: Record<string, unknown> },
		dateToData: Record<string, HealthData>,
		syncDays: string[],
		result: { written: number; unchanged: number; empty: number },
		rawPayload: string
	): Promise<void> {
		try {
			const lines: string[] = [
				`# Apple Health Sync — Debug`,
				`**Letzter Sync:** ${new Date().toLocaleString()}`,
				``,
				`## Ergebnis`,
				`| | |`,
				`|---|---|`,
				`| Geschrieben | ${result.written} |`,
				`| Unverändert | ${result.unchanged} |`,
				`| Leer (kein Wert) | ${result.empty} |`,
				`| Tage im Payload | ${syncDays.length} |`,
				``,
				`## Metriken pro Tag`,
				``,
			];

			for (const day of syncDays) {
				const metrics = dateToData[day]?.metrics ?? {};
				lines.push(`### ${day}`);
				if (Object.keys(metrics).length === 0) {
					lines.push("*(keine Daten)*");
				} else {
					for (const [key, val] of Object.entries(metrics)) {
						lines.push(`- **${key}:** ${val}`);
					}
				}
				lines.push("");
			}

			lines.push(`## Roher Payload (erste 800 Zeichen)`, "```json");
			lines.push(rawPayload.substring(0, 800));
			lines.push("```");

			await this.writeDebugContent(lines.join("\n"));
		} catch (e) {
			console.error("Apple Health Sync: debug write failed", e);
		}
	}

	private async writeDebugContent(content: string): Promise<void> {
		const folder = "_apple-health-sync";
		const path = `${folder}/debug.md`;
		if (!this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
		} else {
			await this.app.vault.create(path, content);
		}
	}

	/** Opens the iOS Shortcut via URL scheme */
	private triggerShortcut() {
		this.manualTriggerAt = Date.now();
		const shortcutName = this.settings.shortcutName || "Apple Health Sync";
		const encoded = encodeURIComponent(shortcutName);
		window.open(`shortcuts://run-shortcut?name=${encoded}`);
	}

	/** Detect path and format from Periodic Notes / Daily Notes if not manually configured */
	private autoDetectDailyNotePath(): void {
		if (this.settings.dailyNotePath) return;

		// Periodic Notes Plugin
		const periodicNotes = (this.app as unknown as { plugins: { plugins: Record<string, { settings?: { daily?: { folder?: string; format?: string } } }> } })
			?.plugins?.plugins?.["periodic-notes"];
		if (periodicNotes?.settings?.daily?.folder) {
			this.settings.dailyNotePath = periodicNotes.settings.daily.folder;
			if (periodicNotes.settings.daily.format) {
				this.settings.dailyNoteFormat = periodicNotes.settings.daily.format;
			}
			console.debug("Apple Health Sync: Auto-detected daily note path from Periodic Notes:", this.settings.dailyNotePath);
			return;
		}

		// Daily Notes Core Plugin
		const dailyNotes = (this.app as unknown as { internalPlugins: { plugins: Record<string, { instance?: { options?: { folder?: string; format?: string } } }> } })
			?.internalPlugins?.plugins?.["daily-notes"];
		if (dailyNotes?.instance?.options?.folder) {
			this.settings.dailyNotePath = dailyNotes.instance.options.folder;
			if (dailyNotes.instance.options.format) {
				this.settings.dailyNoteFormat = dailyNotes.instance.options.format;
			}
			console.debug("Apple Health Sync: Auto-detected daily note path from Daily Notes:", this.settings.dailyNotePath);
			return;
		}
	}

	async loadSettings() {
		const saved = await this.loadData() as Partial<HealthSyncSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		const defaults = DEFAULT_SETTINGS.enabledMetrics;
		for (const key of Object.keys(defaults)) {
			if (this.settings.enabledMetrics[key] === undefined) {
				this.settings.enabledMetrics[key] = defaults[key]!;
			}
		}

		// Detect language from Obsidian on first launch
		if (!saved?.language) {
			const obsidianLang = document.documentElement.lang?.slice(0, 2) ?? "en";
			const supported = ["en", "de"];
			this.settings.language = supported.includes(obsidianLang) ? obsidianLang : "en";
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
