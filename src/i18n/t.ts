import { en, TranslationKeys } from "./en";
import { de } from "./de";

const translations: Record<string, Record<TranslationKeys, string>> = { en, de };

export function t(key: TranslationKeys, lang: string = "en"): string {
	return translations[lang]?.[key] ?? translations["en"]?.[key] ?? key;
}
