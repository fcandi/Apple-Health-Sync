export const en = {
	// Commands
	commandTriggerSync: "Trigger health sync via Shortcut",

	// Settings — Shortcut
	settingsShortcutHeading: "iOS Shortcut",
	settingsShortcutInstall: "Install Shortcut",
	settingsShortcutInstallDesc: "Install the iOS Shortcut that sends Apple Health data to this plugin",
	settingsShortcutInstallButton: "Install full Shortcut",
	settingsShortcutName: "Shortcut name",
	settingsShortcutNameDesc: "Name of the installed Shortcut (for the 'trigger sync' command)",
	settingsLastSync: "Last sync",
	settingsLastSyncNever: "Never",

	// Settings — Daily Notes
	settingsDailyNoteHeading: "Daily notes",
	settingsDailyNotePath: "Daily notes path",
	settingsDailyNotePathDesc: "Path to your daily notes folder",
	settingsDailyNoteFormat: "Daily note format",
	settingsDailyNoteFormatDesc: "Date format for daily notes filenames",
	settingsDailyNoteTemplate: "New note template",
	settingsDailyNoteTemplateDesc: "Content added when creating a new daily note (leave empty for a blank note)",

	// Settings — Display
	settingsDisplayHeading: "Display",
	settingsUnitSystem: "Unit system",
	settingsUnitSystemDesc: "Choose how distance and weight are displayed",
	unitMetric: "Metric (km, kg)",
	unitImperial: "Imperial (mi, lbs)",
	settingsPrefix: "Property prefix",
	settingsPrefixDesc: "Add 'ohs_' prefix to all properties (compatible with Garmin Health Sync)",
	settingsWriteTrainings: "Machine-readable trainings",
	settingsWriteTrainingsDesc: "Add structured 'trainings' field to frontmatter (for Dataview queries)",
	settingsLanguage: "Language",
	settingsLanguageDesc: "Plugin UI language",

	// Settings — Metrics
	settingsMetricsStandard: "Standard metrics",
	settingsMetricsExtendedDesc: "Additional metrics (click to expand)",

	// Metric Labels — compatible with Garmin Health Sync
	metric_steps: "Steps",
	metric_sleep_duration: "Sleep duration",
	metric_resting_hr: "Resting heart rate",
	metric_hrv: "Heart rate variability",
	metric_calories_active: "Active calories",
	metric_intensity_min: "Exercise minutes",
	metric_spo2: "Blood oxygen",
	metric_respiration_rate: "Respiration rate",
	metric_calories_total: "Total calories",
	metric_distance_km: "Distance (km)",
	metric_floors: "Flights climbed",
	metric_sleep_deep: "Deep sleep",
	metric_sleep_light: "Core sleep",
	metric_sleep_rem: "REM sleep",
	metric_sleep_awake: "Awake time",
	metric_weight_kg: "Weight (kg)",
	metric_body_fat_pct: "Body fat %",
	metric_distance_mi: "Distance (mi)",
	metric_weight_lbs: "Weight (lbs)",

	// Metric Labels — Apple Health exclusive
	metric_vo2max: "VO2 max",
	metric_walking_hr_avg: "Walking heart rate avg",
	metric_stand_min: "Stand minutes",
	metric_wrist_temp: "Wrist temperature",
	metric_mindful_min: "Mindful minutes",

	// Notices
	noticeSyncSuccess: "Health data synced for {date}",
	noticeSyncNoData: "No health data received",
	noticeSyncError: "Error processing health data",
	noticeInvalidData: "Invalid data received from Shortcut",
	noticeInvalidDate: "Invalid date format received",
};

export type TranslationKeys = keyof typeof en;
