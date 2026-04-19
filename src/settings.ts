import { App, PluginSettingTab, Setting } from "obsidian";
import type AppleHealthSyncPlugin from "./main";
import { METRICS, getDefaultEnabledMetrics } from "./metrics";
import { t } from "./i18n/t";
import type { TranslationKeys } from "./i18n/en";

/** Maps internal metric keys to their imperial i18n label when unit system is imperial */
const IMPERIAL_LABEL_MAP: Partial<Record<string, TranslationKeys>> = {
	distance_km: "metric_distance_mi",
	weight_kg: "metric_weight_lbs",
};

export type UnitSystem = "metric" | "imperial";

export interface HealthSyncSettings {
	// Shortcut
	shortcutName: string;
	shortcutIcloudUrl: string;
	lastSyncDate: string;
	lastSyncTime: number;
	syncCooldownMinutes: number;

	// Daily Notes
	dailyNotePath: string;
	dailyNoteFormat: string;
	dailyNoteTemplate: string;

	// Display
	usePrefix: boolean;
	unitSystem: UnitSystem;
	enabledMetrics: Record<string, boolean>;
	writeTrainings: boolean;

	// UI
	language: string;
}

export const DEFAULT_SETTINGS: HealthSyncSettings = {
	shortcutName: "Apple Health Sync",
	shortcutIcloudUrl: "",
	lastSyncDate: "",
	lastSyncTime: 0,
	syncCooldownMinutes: 0,

	dailyNotePath: "",
	dailyNoteFormat: "YYYY-MM-DD",
	dailyNoteTemplate: "",

	usePrefix: false,
	unitSystem: "metric",
	enabledMetrics: getDefaultEnabledMetrics(),
	writeTrainings: false,

	language: "en",
};

export class HealthSyncSettingTab extends PluginSettingTab {
	plugin: AppleHealthSyncPlugin;

	constructor(app: App, plugin: AppleHealthSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const lang = this.plugin.settings.language;
		containerEl.empty();

		// Language
		new Setting(containerEl)
			.setName(t("settingsLanguage", lang))
			.setDesc(t("settingsLanguageDesc", lang))
			.addDropdown(drop => drop
				.addOption("en", "English")
				.addOption("de", "Deutsch")
				.setValue(this.plugin.settings.language)
				.onChange(async (value) => {
					this.plugin.settings.language = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		// --- iOS Shortcut ---
		new Setting(containerEl)
			.setName(t("settingsShortcutHeading", lang))
			.setHeading();

		// Install Shortcut button
		const installSetting = new Setting(containerEl)
			.setName(t("settingsShortcutInstall", lang))
			.setDesc(t("settingsShortcutInstallDesc", lang));

		if (this.plugin.settings.shortcutIcloudUrl) {
			installSetting.addButton(btn => btn
				.setButtonText(t("settingsShortcutInstallButton", lang))
				.setCta()
				.onClick(() => {
					window.open(this.plugin.settings.shortcutIcloudUrl);
				}));
		}

		// Shortcut Name
		new Setting(containerEl)
			.setName(t("settingsShortcutName", lang))
			.setDesc(t("settingsShortcutNameDesc", lang))
			.addText(text => text
				.setValue(this.plugin.settings.shortcutName)
				.onChange(async (value) => {
					this.plugin.settings.shortcutName = value;
					await this.plugin.saveSettings();
				}));

		// Cooldown
		new Setting(containerEl)
			.setName(t("settingsSyncCooldown", lang))
			.setDesc(t("settingsSyncCooldownDesc", lang))
			.addText(text => text
				.setValue(String(this.plugin.settings.syncCooldownMinutes))
				.onChange(async (value) => {
					const n = parseInt(value, 10);
					this.plugin.settings.syncCooldownMinutes = Number.isFinite(n) && n >= 0 ? n : 0;
					await this.plugin.saveSettings();
				}));

		// Last Sync display
		const lastSyncText = this.plugin.settings.lastSyncDate
			? `${this.plugin.settings.lastSyncDate} (${new Date(this.plugin.settings.lastSyncTime).toLocaleTimeString()})`
			: t("settingsLastSyncNever", lang);
		new Setting(containerEl)
			.setName(t("settingsLastSync", lang))
			.setDesc(lastSyncText);

		// --- Daily Notes ---
		new Setting(containerEl)
			.setName(t("settingsDailyNoteHeading", lang))
			.setHeading();

		new Setting(containerEl)
			.setName(t("settingsDailyNotePath", lang))
			.setDesc(t("settingsDailyNotePathDesc", lang))
			.addText(text => text
				.setValue(this.plugin.settings.dailyNotePath)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotePath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t("settingsDailyNoteFormat", lang))
			.setDesc(t("settingsDailyNoteFormatDesc", lang))
			.addText(text => text
				.setValue(this.plugin.settings.dailyNoteFormat)
				.onChange(async (value) => {
					this.plugin.settings.dailyNoteFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t("settingsDailyNoteTemplate", lang))
			.setDesc(t("settingsDailyNoteTemplateDesc", lang))
			.addTextArea(text => {
				text.setPlaceholder("")
					.setValue(this.plugin.settings.dailyNoteTemplate)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 4;
			});

		// --- Display ---
		new Setting(containerEl)
			.setName(t("settingsDisplayHeading", lang))
			.setHeading();

		// Unit System
		new Setting(containerEl)
			.setName(t("settingsUnitSystem", lang))
			.setDesc(t("settingsUnitSystemDesc", lang))
			.addDropdown(drop => drop
				.addOption("metric", t("unitMetric", lang))
				.addOption("imperial", t("unitImperial", lang))
				.setValue(this.plugin.settings.unitSystem)
				.onChange(async (value) => {
					this.plugin.settings.unitSystem = value as UnitSystem;
					await this.plugin.saveSettings();
					this.display();
				}));

		// Prefix
		new Setting(containerEl)
			.setName(t("settingsPrefix", lang))
			.setDesc(t("settingsPrefixDesc", lang))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.usePrefix)
				.onChange(async (value) => {
					this.plugin.settings.usePrefix = value;
					await this.plugin.saveSettings();
				}));

		// Machine-readable trainings
		new Setting(containerEl)
			.setName(t("settingsWriteTrainings", lang))
			.setDesc(t("settingsWriteTrainingsDesc", lang))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.writeTrainings)
				.onChange(async (value) => {
					this.plugin.settings.writeTrainings = value;
					await this.plugin.saveSettings();
				}));

		// --- Standard metrics ---
		const isImperial = this.plugin.settings.unitSystem === "imperial";
		new Setting(containerEl)
			.setName(t("settingsMetricsStandard", lang))
			.setHeading();

		for (const metric of METRICS.filter(m => m.category === "standard")) {
			const labelKey = (isImperial && IMPERIAL_LABEL_MAP[metric.key]) || `metric_${metric.key}` as TranslationKeys;
			new Setting(containerEl)
				.setName(t(labelKey, lang))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enabledMetrics[metric.key] ?? metric.defaultEnabled)
					.onChange(async (value) => {
						this.plugin.settings.enabledMetrics[metric.key] = value;
						await this.plugin.saveSettings();
					}));
		}

		// --- Extended metrics (collapsed) ---
		const extDetails = containerEl.createEl("details");
		extDetails.createEl("summary", { text: t("settingsMetricsExtendedDesc", lang) });

		for (const metric of METRICS.filter(m => m.category === "extended")) {
			const labelKey = (isImperial && IMPERIAL_LABEL_MAP[metric.key]) || `metric_${metric.key}` as TranslationKeys;
			new Setting(extDetails)
				.setName(t(labelKey, lang))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enabledMetrics[metric.key] ?? metric.defaultEnabled)
					.onChange(async (value) => {
						this.plugin.settings.enabledMetrics[metric.key] = value;
						await this.plugin.saveSettings();
					}));
		}
	}
}
