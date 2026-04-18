import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, HealthSyncSettings, HealthSyncSettingTab } from "./settings";
import { SyncManager } from "./sync";
import { parseShortcutPayload } from "./shortcut-parser";
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

			const healthData = parseShortcutPayload(payload, v ?? "1", date);
			const metricCount = Object.keys(healthData.metrics).length;
			const totalMetricKeys = payload.metrics ? Object.keys(payload.metrics).length : 0;
			console.debug("Apple Health Sync: parsed", metricCount, "of", totalMetricKeys,
				"metrics for", date, "— keys:", Object.keys(healthData.metrics).join(","));

			const success = await this.syncManager.writeData(
				date, healthData, this.settings
			);

			if (success) {
				this.settings.lastSyncDate = date;
				this.settings.lastSyncTime = Date.now();
				await this.saveSettings();
				new Notice(
					t("noticeSyncSuccess", this.settings.language)
						.replace("{date}", date)
				);
			} else {
				const base = `${t("noticeSyncNoData", this.settings.language)} (${metricCount}/${totalMetricKeys} · ${date})`;
				if (metricCount === 0) {
					const snippet = cleanedData.length > 400
						? cleanedData.substring(0, 400) + "…"
						: cleanedData;
					new Notice(`${base}\n\n${snippet}`, 30000);
				} else {
					new Notice(base, 10000);
				}
			}
		} catch (error) {
			console.error("Apple Health Sync: URI handler error", error);
			new Notice(t("noticeSyncError", this.settings.language));
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
