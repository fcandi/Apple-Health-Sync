import type { TranslationKeys } from "./en";

export const de: Record<TranslationKeys, string> = {
	// Commands
	commandTriggerSync: "Gesundheitsdaten via Shortcut synchronisieren",

	// Settings — Shortcut
	settingsShortcutHeading: "iOS Shortcut",
	settingsShortcutInstall: "Shortcut installieren",
	settingsShortcutInstallDesc: "Installiere den iOS Shortcut, der Apple Health Daten an dieses Plugin sendet",
	settingsShortcutInstallButton: "Vollständigen Shortcut installieren",
	settingsShortcutName: "Shortcut-Name",
	settingsShortcutNameDesc: "Name des installierten Shortcuts (für den 'Sync auslösen' Befehl)",
	settingsLastSync: "Letzter Sync",
	settingsLastSyncNever: "Noch nie",

	// Settings — Daily Notes
	settingsDailyNoteHeading: "Daily Notes",
	settingsDailyNotePath: "Daily Notes Pfad",
	settingsDailyNotePathDesc: "Pfad zum Daily Notes Ordner",
	settingsDailyNoteFormat: "Daily Note Format",
	settingsDailyNoteFormatDesc: "Datumsformat für Daily Notes Dateinamen",
	settingsDailyNoteTemplate: "Vorlage für neue Notizen",
	settingsDailyNoteTemplateDesc: "Inhalt beim Erstellen einer neuen Daily Note (leer lassen für leere Notiz)",

	// Settings — Display
	settingsDisplayHeading: "Darstellung",
	settingsUnitSystem: "Einheitensystem",
	settingsUnitSystemDesc: "Darstellung von Distanz und Gewicht",
	unitMetric: "Metrisch (km, kg)",
	unitImperial: "Imperial (mi, lbs)",
	settingsPrefix: "Property-Präfix",
	settingsPrefixDesc: "'ohs_' Präfix vor alle Properties setzen (kompatibel mit Garmin Health Sync)",
	settingsWriteTrainings: "Maschinenlesbare Trainings",
	settingsWriteTrainingsDesc: "Strukturiertes 'trainings'-Feld im Frontmatter hinzufügen (für Dataview-Abfragen)",
	settingsLanguage: "Sprache",
	settingsLanguageDesc: "Sprache der Plugin-Oberfläche",

	// Settings — Metrics
	settingsMetricsStandard: "Standard-Metriken",
	settingsMetricsExtendedDesc: "Zusätzliche Metriken (klicken zum Aufklappen)",

	// Metric Labels — kompatibel mit Garmin Health Sync
	metric_steps: "Schritte",
	metric_sleep_duration: "Schlafdauer",
	metric_resting_hr: "Ruhe-Herzfrequenz",
	metric_hrv: "Herzratenvariabilität",
	metric_calories_active: "Aktive Kalorien",
	metric_intensity_min: "Bewegungsminuten",
	metric_spo2: "Blutsauerstoff",
	metric_respiration_rate: "Atemfrequenz",
	metric_calories_total: "Kalorien gesamt",
	metric_distance_km: "Distanz (km)",
	metric_floors: "Stockwerke",
	metric_sleep_deep: "Tiefschlaf",
	metric_sleep_light: "Core-Schlaf",
	metric_sleep_rem: "REM-Schlaf",
	metric_sleep_awake: "Wachzeit",
	metric_weight_kg: "Gewicht (kg)",
	metric_body_fat_pct: "Körperfettanteil",
	metric_distance_mi: "Distanz (mi)",
	metric_weight_lbs: "Gewicht (lbs)",

	// Metric Labels — Apple Health exklusiv
	metric_vo2max: "VO2 Max",
	metric_walking_hr_avg: "Geh-Herzfrequenz Ø",
	metric_stand_min: "Steh-Minuten",
	metric_wrist_temp: "Handgelenk-Temperatur",
	metric_mindful_min: "Achtsamkeits-Minuten",

	// Notices
	noticeSyncSuccess: "Gesundheitsdaten für {date} synchronisiert",
	noticeSyncNoData: "Keine Gesundheitsdaten empfangen",
	noticeSyncError: "Fehler beim Verarbeiten der Gesundheitsdaten",
	noticeInvalidData: "Ungültige Daten vom Shortcut empfangen",
	noticeInvalidDate: "Ungültiges Datumsformat empfangen",
};
