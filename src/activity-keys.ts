/**
 * Mapping: Apple Health Workout-Typ -> kanonische Keys.
 *
 * Uses the same target keys as Garmin Health Sync activity-keys.ts.
 * The Shortcut sends the HKWorkoutActivityType string (e.g. "Running").
 * Unknown types are passed through as lowercase+underscore.
 */
const APPLE_WORKOUT_MAP: Record<string, string> = {
	// Running
	"running":                          "running",
	"trail running":                    "trail_running",
	"treadmill running":                "treadmill",

	// Cycling
	"cycling":                          "cycling",
	"indoor cycling":                   "indoor_cycling",
	"hand cycling":                     "cycling",

	// Walking
	"walking":                          "walking",
	"indoor walking":                   "indoor_walking",

	// Hiking / Outdoor
	"hiking":                           "hiking",
	"climbing":                         "rock_climbing",

	// Swimming
	"swimming":                         "swimming",
	"pool swim":                        "pool_swimming",
	"open water swim":                  "open_water_swimming",

	// Winter Sports
	"downhill skiing":                  "skiing",
	"cross country skiing":             "cross_country_skiing",
	"snowboarding":                     "snowboarding",
	"snowshoeing":                      "snowshoeing",
	"skating sports":                   "ice_skating",

	// Water Sports
	"paddle sports":                    "kayaking",
	"rowing":                           "rowing",
	"indoor rowing":                    "indoor_rowing",
	"surfing sports":                   "surfing",
	"sailing":                          "sailing",

	// Gym / Fitness
	"traditional strength training":    "strength_training",
	"functional strength training":     "strength_training",
	"core training":                    "strength_training",
	"high intensity interval training": "hiit",
	"elliptical":                       "elliptical",
	"yoga":                             "yoga",
	"pilates":                          "pilates",
	"jump rope":                        "jump_rope",
	"stair climbing":                   "stair_stepper",
	"mixed cardio":                     "cardio",
	"barre":                            "gym_equipment",
	"flexibility":                      "yoga",
	"cooldown":                         "gym_equipment",

	// Racket Sports
	"tennis":                           "tennis",
	"badminton":                        "badminton",
	"squash":                           "squash",
	"table tennis":                     "table_tennis",
	"pickleball":                       "pickleball",
	"racquetball":                      "squash",

	// Combat / Martial Arts
	"boxing":                           "boxing",
	"kickboxing":                       "boxing",
	"martial arts":                     "martial_arts",
	"wrestling":                        "martial_arts",

	// Team Sports
	"soccer":                           "soccer",
	"basketball":                       "basketball",
	"volleyball":                       "volleyball",
	"rugby":                            "rugby",
	"baseball":                         "baseball",
	"softball":                         "softball",
	"cricket":                          "cricket",
	"hockey":                           "hockey",
	"lacrosse":                         "lacrosse",
	"american football":                "american_football",

	// Other
	"golf":                             "golf",
	"equestrian sports":                "horseback_riding",
	"dance":                            "dancing",
	"mind and body":                    "meditation",
	"social dance":                     "dancing",
	"other":                            "workout",
};

/** Category mapping for machine-readable training data (shared with Garmin) */
const CATEGORY_MAP: Record<string, string> = {
	// Cycling
	cycling: "cycling",
	indoor_cycling: "cycling",

	// Running
	running: "running",
	trail_running: "running",
	treadmill: "running",

	// Walking
	walking: "walking",
	indoor_walking: "walking",

	// Hiking / Outdoor
	hiking: "outdoor",
	rock_climbing: "outdoor",

	// Swimming
	swimming: "swimming",
	pool_swimming: "swimming",
	open_water_swimming: "swimming",

	// Winter Sports
	skiing: "winter",
	cross_country_skiing: "winter",
	snowboarding: "winter",
	snowshoeing: "winter",
	ice_skating: "winter",

	// Water Sports
	kayaking: "water",
	rowing: "water",
	indoor_rowing: "water",
	surfing: "water",
	sailing: "water",

	// Gym / Fitness
	strength_training: "gym",
	gym_equipment: "gym",
	elliptical: "gym",
	yoga: "gym",
	pilates: "gym",
	hiit: "gym",
	cardio: "gym",
	boxing: "gym",
	jump_rope: "gym",
	stair_stepper: "gym",
	martial_arts: "gym",

	// Racket Sports
	tennis: "racket",
	badminton: "racket",
	squash: "racket",
	table_tennis: "racket",
	pickleball: "racket",

	// Team Sports
	soccer: "team",
	basketball: "team",
	volleyball: "team",
	rugby: "team",
	baseball: "team",
	softball: "team",
	cricket: "team",
	hockey: "team",
	lacrosse: "team",
	american_football: "team",

	// Other
	golf: "other",
	horseback_riding: "other",
	dancing: "other",
	meditation: "other",
	workout: "other",
};

/**
 * Normalizes an Apple Health workout type string to a canonical key.
 * Unknown types are passed through as lowercase+underscore.
 */
export function normalizeAppleWorkoutType(rawType: string): string {
	const normalized = rawType.toLowerCase().trim();
	return APPLE_WORKOUT_MAP[normalized] ?? normalized.replace(/\s+/g, "_");
}

/**
 * Returns the category for an already-normalized activity key.
 * Falls back to "other".
 */
export function getActivityCategory(normalizedKey: string): string {
	return CATEGORY_MAP[normalizedKey] ?? "other";
}
