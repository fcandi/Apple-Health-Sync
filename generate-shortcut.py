#!/usr/bin/env python3
"""
Apple Health Sync iOS Shortcut Generator — v11

Neuerungen gegenüber v10:
  --days      Tage Historie (default 5; Catchup: 14)
  --cooldown  Minuten Cooldown (default 60; 0 = kein Pre-Check)
  -o          Output-Dateiname

Pre-Check-Block (wenn cooldown > 0):
  1. State-File aus iCloud Drive lesen (apple-health-sync-state.txt)
  2. Falls Datei enthält "T" (= valider ISO-Timestamp) → Differenz prüfen
  3. Falls Differenz < cooldown Minuten → Shortcut beenden (Stop)
  Fallback: kein iCloud / Datei fehlt → "contains T" = false → kein Stop →
  Shortcut läuft normal → Plugin-Cooldown als zweite Verteidigung.
"""
import plistlib
import uuid
import argparse


def make_uuid():
    return str(uuid.uuid4()).upper()


def action_output_ref(action_uuid, output_name):
    """Plain reference — used inside attachmentsByRange."""
    return {
        'OutputUUID': action_uuid,
        'Type': 'ActionOutput',
        'OutputName': output_name,
    }


def param_ref(action_uuid, output_name):
    """WFTextTokenAttachment — für standalone action parameters."""
    return {
        'Value': action_output_ref(action_uuid, output_name),
        'WFSerializationType': 'WFTextTokenAttachment',
    }


def param_ref_as_text(action_uuid, output_name):
    """WFTextTokenString — für Params die Text-Input erwarten."""
    return {
        'Value': {
            'string': '\ufffc',
            'attachmentsByRange': {
                '{0, 1}': action_output_ref(action_uuid, output_name),
            },
        },
        'WFSerializationType': 'WFTextTokenString',
    }


def date_aggrandizement(fmt):
    """iOS-Inline-Datumsformat ohne separate format.date-Aktion."""
    return {
        'Type': 'WFFormattedDateAggrandizement',
        'WFFormattedDateFormatStyle': 'Custom',
        'WFFormattedDateFormat': {
            'Value': {'string': fmt},
            'WFSerializationType': 'WFTextTokenString',
        },
    }


def text_with_vars(text_parts):
    """Build WFTextTokenString aus str + (uuid, output_name[, fmt]) Tupeln."""
    result_text = ''
    attachments = {}
    for part in text_parts:
        if isinstance(part, str):
            result_text += part
        elif isinstance(part, tuple):
            pos = len(result_text)
            result_text += '\ufffc'
            range_key = '{' + str(pos) + ', 1}'
            if len(part) == 3:
                action_uuid, output_name, fmt = part
                ref = action_output_ref(action_uuid, output_name)
                ref['Aggrandizements'] = [date_aggrandizement(fmt)]
                attachments[range_key] = ref
            else:
                action_uuid, output_name = part
                attachments[range_key] = action_output_ref(action_uuid, output_name)
    value = {'string': result_text}
    if attachments:
        value['attachmentsByRange'] = attachments
    return {
        'Value': value,
        'WFSerializationType': 'WFTextTokenString',
    }


# OutputNames — Apple lokalisiert einen Teil der Aktionen ins DE.
OUT_ADJUSTED_DATE = 'Angepasstes Datum'
OUT_DATE          = 'Datum'
OUT_TIME_BETWEEN  = 'Zeit zwischen Daten'
OUT_FILE          = 'Datei'
OUT_HEALTH        = 'Health-Messungen'
OUT_START_DATE    = 'Startdatum'
OUT_TEXT          = 'Text'
OUT_URLENCODED    = 'Text der codierten URL'

# HealthKit Display-Namen (exakt so wie iOS sie kennt)
METRICS = [
    # Standard
    ('steps',            'Steps'),
    ('resting_hr',       'Resting Heart Rate'),
    ('hrv',              'Heart Rate Variability'),
    ('calories_active',  'Active Calories'),
    ('intensity_min',    'Exercise Time'),
    # Extended — Garmin-kompatibel
    ('calories_resting', 'Resting Calories'),
    ('spo2',             'Oxygen Saturation'),
    ('respiration_rate', 'Respiratory Rate'),
    ('distance_km',      'Walking + Running Distance'),
    ('floors',           'Flights Climbed'),
    ('weight_kg',        'Weight'),
    ('body_fat_pct',     'Body Fat Percentage'),
    # Extended — Apple-exklusiv
    ('vo2max',           'VO2 Max'),
    ('walking_hr_avg',   'Walking Heart Rate Average'),
    ('stand_min',        'Stand Time'),
    ('wrist_temp',       'Sleep Wrist Temperature'),
    ('mindful_min',      'Mindful Session'),
]

STATE_FILENAME = 'apple-health-sync-state.txt'


def health_find(action_uuid, display_name, days):
    filter_templates = [
        {
            'Bounded': True, 'Operator': 4, 'Removable': False, 'Property': 'Type',
            'Values': {'Enumeration': {'Value': display_name,
                                       'WFSerializationType': 'WFStringSubstitutableState'}},
        },
        {
            'Bounded': True, 'Operator': 1001, 'Removable': False, 'Property': 'Start Date',
            'Values': {'Unit': 16, 'Number': str(days)},
        },
    ]
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.filter.health.quantity',
        'WFWorkflowActionParameters': {
            'UUID': action_uuid,
            'WFHKSampleFilteringGroupBy': 'Day',
            'WFContentItemFilter': {
                'Value': {
                    'WFActionParameterFilterPrefix': 1,
                    'WFContentPredicateBoundedDate': False,
                    'WFActionParameterFilterTemplates': filter_templates,
                },
                'WFSerializationType': 'WFContentPredicateTableTemplate',
            },
        },
    }


def extract_start_date(action_uuid, health_uuid):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.properties.health.quantity',
        'WFWorkflowActionParameters': {
            'UUID': action_uuid,
            'WFContentItemPropertyName': 'Start Date',
            'WFInput': param_ref(health_uuid, OUT_HEALTH),
        },
    }


def build_actions(days: int, cooldown: int) -> list:
    actions = []

    # UUIDs
    uuid_yesterday       = make_uuid()
    uuid_current_date    = make_uuid()
    uuid_state_read      = make_uuid()
    uuid_time_diff       = make_uuid()
    uuid_if_file_group   = make_uuid()
    uuid_if_cool_group   = make_uuid()
    uuid_json            = make_uuid()
    uuid_encode          = make_uuid()
    uuid_url             = make_uuid()
    uuid_state_text      = make_uuid()
    uuid_workouts        = make_uuid()
    uuid_workouts_text   = make_uuid()

    metric_uuids = {key: (make_uuid(), make_uuid()) for key, _ in METRICS}

    # ── 1. Gestern-Datum (für JSON-Payload) ──────────────────────────────────
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.adjustdate',
        'WFWorkflowActionParameters': {
            'UUID': uuid_yesterday,
            'WFAdjustOperation': 'Subtract',
            'WFDuration': {
                'Value': {'Unit': 'days', 'Magnitude': '1'},
                'WFSerializationType': 'WFQuantityFieldValue',
            },
        },
    })

    # ── Pre-Check-Block (nur wenn cooldown > 0) ───────────────────────────────
    if cooldown > 0:

        # 2. Current Date
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.date',
            'WFWorkflowActionParameters': {
                'UUID': uuid_current_date,
                'WFDateActionMode': 'Current Date',
            },
        })

        # 3. Get State-File aus iCloud Drive (Shortcuts-Ordner).
        #    WFGetFilePath = Dateiname relativ zum iCloud-Shortcuts-Ordner.
        #    WFFileErrorIfNotFound: False → kein Fehler wenn nicht vorhanden.
        #    Fallback für Nutzer ohne iCloud: Output ist leer → "contains T" = false
        #    → Pre-Check-Block wird übersprungen → Shortcut läuft normal.
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.file',
            'WFWorkflowActionParameters': {
                'UUID': uuid_state_read,
                'WFGetFilePath': {
                    'Value': {'string': STATE_FILENAME},
                    'WFSerializationType': 'WFTextTokenString',
                },
                'WFFileErrorIfNotFound': False,
            },
        })

        # 4. If state-file enthält "T" (= valider ISO-Timestamp "yyyy-MM-ddTHH:mm:ss")
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.conditional',
            'WFWorkflowActionParameters': {
                'UUID': make_uuid(),
                'WFInput': {
                    'Type': 'Variable',
                    'Variable': param_ref(uuid_state_read, OUT_FILE),
                },
                'WFControlFlowMode': 0,
                'GroupingIdentifier': uuid_if_file_group,
                'WFCondition': 2,                    # contains
                'WFConditionalActionString': 'T',
            },
        })

        # 5. Zeit zwischen State-Datei-Datum und Jetzt (in Minuten)
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.gettimebetweendates',
            'WFWorkflowActionParameters': {
                'UUID': uuid_time_diff,
                # WFInput = älteres Datum (= State-File-Inhalt, von iOS als Date geparst)
                'WFInput': param_ref_as_text(uuid_state_read, OUT_FILE),
                # WFTimeUntilFromDate = neueres Datum (= jetzt)
                'WFTimeUntilFromDate': {
                    'Value': {
                        'string': '\ufffc',
                        'attachmentsByRange': {'{0, 1}': {'Type': 'CurrentDate'}},
                    },
                    'WFSerializationType': 'WFTextTokenString',
                },
                'WFTimeUntilUnit': 'Minutes',
            },
        })

        # 6. If Zeit < cooldown Minuten → Stop Shortcut
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.conditional',
            'WFWorkflowActionParameters': {
                'UUID': make_uuid(),
                'WFInput': {
                    'Type': 'Variable',
                    'Variable': param_ref(uuid_time_diff, OUT_TIME_BETWEEN),
                },
                'WFControlFlowMode': 0,
                'GroupingIdentifier': uuid_if_cool_group,
                'WFCondition': 4,                    # is less than
                'WFConditionalActionNumber': cooldown,
            },
        })

        # 7. Stop Shortcut
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.exit',
            'WFWorkflowActionParameters': {'UUID': make_uuid()},
        })

        # 8. End If (Cooldown)
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.conditional',
            'WFWorkflowActionParameters': {
                'UUID': make_uuid(),
                'GroupingIdentifier': uuid_if_cool_group,
                'WFControlFlowMode': 2,
            },
        })

        # 9. End If (File-Check)
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.conditional',
            'WFWorkflowActionParameters': {
                'UUID': make_uuid(),
                'GroupingIdentifier': uuid_if_file_group,
                'WFControlFlowMode': 2,
            },
        })

    # ── Haptic Feedback (nach Pre-Check-Pass) ─────────────────────────────────
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.vibrate',
        'WFWorkflowActionParameters': {'UUID': make_uuid()},
    })

    # ── Workouts (Toolbox, letzte 20 — Text-Parsing-Approach) ────────────────
    actions.append({
        'WFWorkflowActionIdentifier': 'com.alexhay.ToolboxProForShortcuts.GetWorkoutsIntent',
        'WFWorkflowActionParameters': {
            'UUID': uuid_workouts,
            'workoutType': 'All',
            'limit': '20',
            'useDateRange': False,
        },
    })
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_workouts_text,
            'WFTextActionText': text_with_vars([(uuid_workouts, 'Workouts')]),
        },
    })

    # ── HealthKit Queries (pro Metrik: Find + Extract Start Date) ─────────────
    for key, display_name in METRICS:
        u_find, u_extract = metric_uuids[key]
        actions.append(health_find(u_find, display_name, days))
        actions.append(extract_start_date(u_extract, u_find))

    # ── JSON-Payload bauen ────────────────────────────────────────────────────
    DATE_FMT = 'yyyy-MM-dd'
    json_parts = ['{"date":"', (uuid_yesterday, OUT_ADJUSTED_DATE, DATE_FMT), '","metrics":{']
    for i, (key, _) in enumerate(METRICS):
        u_find, u_extract = metric_uuids[key]
        if i > 0:
            json_parts.append(',')
        json_parts.append(f'"{key}":' + '{"v":"')
        json_parts.append((u_find, OUT_HEALTH))
        json_parts.append('","d":"')
        json_parts.append((u_extract, OUT_START_DATE, DATE_FMT))
        json_parts.append('"}')
    json_parts.append('},"workouts_raw":"')
    json_parts.append((uuid_workouts_text, OUT_TEXT))
    json_parts.append('"}')

    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_json,
            'WFTextActionText': text_with_vars(json_parts),
        },
    })

    # ── URL-Encode + Obsidian-URL ─────────────────────────────────────────────
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.urlencode',
        'WFWorkflowActionParameters': {
            'UUID': uuid_encode,
            'WFInput': param_ref_as_text(uuid_json, OUT_TEXT),
        },
    })

    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_url,
            'WFTextActionText': text_with_vars([
                'obsidian://apple-health-sync?data=',
                (uuid_encode, OUT_URLENCODED),
                '&v=2',
            ]),
        },
    })

    # ── URL öffnen (triggert Obsidian) ────────────────────────────────────────
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.openurl',
        'WFWorkflowActionParameters': {
            'WFInput': param_ref(uuid_url, OUT_TEXT),
            'UUID': make_uuid(),
        },
    })

    # ── State-File schreiben (nur wenn cooldown > 0) ──────────────────────────
    if cooldown > 0:
        # ISO-Timestamp des aktuellen Datums als Text
        ISO_FMT = "yyyy-MM-dd'T'HH:mm:ss"
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
            'WFWorkflowActionParameters': {
                'UUID': uuid_state_text,
                'WFTextActionText': text_with_vars([
                    (uuid_current_date, OUT_DATE, ISO_FMT),
                ]),
            },
        })

        # State-File in iCloud Drive speichern (Overwrite)
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.documentpicker.save',
            'WFWorkflowActionParameters': {
                'UUID': make_uuid(),
                'WFInput': param_ref_as_text(uuid_state_text, OUT_TEXT),
                'WFSaveFileShouldOverwrite': True,
                'WFSaveFileShowDocumentPicker': False,
                'WFFileDestinationPath': {
                    'Value': {'string': STATE_FILENAME},
                    'WFSerializationType': 'WFTextTokenString',
                },
            },
        })

    return actions


def build_debug_workout_actions() -> list:
    """Minimalster Debug-Shortcut: Toolbox GetWorkoutsIntent → raw Text → Obsidian.
    Ziel: herausfinden welche Felder/Format das Toolbox-Workout-Objekt hat."""
    actions = []

    uuid_workouts = make_uuid()
    uuid_raw      = make_uuid()
    uuid_encoded  = make_uuid()
    uuid_url      = make_uuid()

    # 1. Toolbox: letzte 5 Workouts holen (Limit klein → URL bleibt handhabbar)
    actions.append({
        'WFWorkflowActionIdentifier': 'com.alexhay.ToolboxProForShortcuts.GetWorkoutsIntent',
        'WFWorkflowActionParameters': {
            'UUID': uuid_workouts,
            'workoutType': 'All',
            'limit': '5',
            'useDateRange': False,
        },
    })

    # 2. Als Text — iOS serialisiert die Workout-Objekte in ihre String-Darstellung
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_raw,
            'WFTextActionText': text_with_vars([(uuid_workouts, 'Workouts')]),
        },
    })

    # 3. URL-Encode
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.urlencode',
        'WFWorkflowActionParameters': {
            'UUID': uuid_encoded,
            'WFInput': param_ref_as_text(uuid_raw, OUT_TEXT),
        },
    })

    # 4. Obsidian-URL mit workout_debug-Parameter
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_url,
            'WFTextActionText': text_with_vars([
                'obsidian://apple-health-sync?workout_debug=',
                (uuid_encoded, OUT_URLENCODED),
            ]),
        },
    })

    # 5. URL öffnen → Obsidian-Plugin empfängt und speichert
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.openurl',
        'WFWorkflowActionParameters': {
            'WFInput': param_ref(uuid_url, OUT_TEXT),
            'UUID': make_uuid(),
        },
    })

    return actions


def build_debug_workout2_actions() -> list:
    """Debug v2: Versucht Workout-Properties via properties.health.workout zu extrahieren.
    Output zeigt ob/welche Properties das Toolbox-Objekt freigibt."""
    actions = []

    uuid_workouts  = make_uuid()
    uuid_text      = make_uuid()
    uuid_duration  = make_uuid()
    uuid_distance  = make_uuid()
    uuid_calories  = make_uuid()
    uuid_startdate = make_uuid()
    uuid_enddate   = make_uuid()
    uuid_combined  = make_uuid()
    uuid_encoded   = make_uuid()
    uuid_url       = make_uuid()

    # 1. Toolbox: 3 Workouts
    actions.append({
        'WFWorkflowActionIdentifier': 'com.alexhay.ToolboxProForShortcuts.GetWorkoutsIntent',
        'WFWorkflowActionParameters': {
            'UUID': uuid_workouts,
            'workoutType': 'All',
            'limit': '3',
            'useDateRange': False,
        },
    })

    # 2. Bekannte Text-Baseline
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_text,
            'WFTextActionText': text_with_vars([(uuid_workouts, 'Workouts')]),
        },
    })

    # 3–7. Property-Extraktion — Identifier/OutputNames sind Kandidaten; leer = falsch geraten
    PROP_ACTIONS = [
        (uuid_duration,  'Duration',               'Dauer'),
        (uuid_distance,  'Distance',               'Distanz'),
        (uuid_calories,  'Active Energy Burned',   'Verbrannte aktive Energie'),
        (uuid_startdate, 'Start Date',             'Startdatum'),
        (uuid_enddate,   'End Date',               'Enddatum'),
    ]
    for prop_uuid, prop_name, _ in PROP_ACTIONS:
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.properties.health.workout',
            'WFWorkflowActionParameters': {
                'UUID': prop_uuid,
                'WFContentItemPropertyName': prop_name,
                'WFInput': param_ref(uuid_workouts, 'Workouts'),
            },
        })

    # 8. Alles kombinieren — OutputNames auf DE geraten (leere Sektion = falscher Name)
    combined_parts = ['=TEXT=\n', (uuid_text, OUT_TEXT)]
    for prop_uuid, _, out_name_de in PROP_ACTIONS:
        combined_parts.append(f'\n={out_name_de.upper()}=\n')
        combined_parts.append((prop_uuid, out_name_de))
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_combined,
            'WFTextActionText': text_with_vars(combined_parts),
        },
    })

    # 9. URL-Encode
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.urlencode',
        'WFWorkflowActionParameters': {
            'UUID': uuid_encoded,
            'WFInput': param_ref_as_text(uuid_combined, OUT_TEXT),
        },
    })

    # 10. Obsidian-URL
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_url,
            'WFTextActionText': text_with_vars([
                'obsidian://apple-health-sync?workout_debug=',
                (uuid_encoded, OUT_URLENCODED),
            ]),
        },
    })

    # 11. URL öffnen
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.openurl',
        'WFWorkflowActionParameters': {
            'WFInput': param_ref(uuid_url, OUT_TEXT),
            'UUID': make_uuid(),
        },
    })

    return actions


def build_debug_workout3_actions() -> list:
    """Debug v3: Zwei parallele Ansätze.
    Ansatz A: is.workflow.actions.properties.workout (ohne .health — andere Hypothese).
    Ansatz B: Repeat-Loop, jedes Item als Text — sehen was Repeat Item liefert."""
    actions = []

    uuid_workouts   = make_uuid()
    uuid_text       = make_uuid()   # Baseline
    # Ansatz A: properties.workout
    uuid_dur_a      = make_uuid()
    uuid_dist_a     = make_uuid()
    uuid_cal_a      = make_uuid()
    uuid_start_a    = make_uuid()
    # Ansatz B: Repeat-Loop
    uuid_repeat     = make_uuid()
    uuid_item_text  = make_uuid()
    uuid_list_var   = make_uuid()   # Variable die im Loop befüllt wird
    uuid_repeat_end = make_uuid()
    uuid_combined   = make_uuid()
    uuid_encoded    = make_uuid()
    uuid_url        = make_uuid()

    # 1. Toolbox: 3 Workouts
    actions.append({
        'WFWorkflowActionIdentifier': 'com.alexhay.ToolboxProForShortcuts.GetWorkoutsIntent',
        'WFWorkflowActionParameters': {
            'UUID': uuid_workouts,
            'workoutType': 'All',
            'limit': '3',
            'useDateRange': False,
        },
    })

    # 2. Baseline Text
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_text,
            'WFTextActionText': text_with_vars([(uuid_workouts, 'Workouts')]),
        },
    })

    # ── Ansatz A: properties.workout (ohne .health) ───────────────────────────
    for prop_uuid, prop_name in [
        (uuid_dur_a,   'Duration'),
        (uuid_dist_a,  'Distance'),
        (uuid_cal_a,   'Active Energy Burned'),
        (uuid_start_a, 'Start Date'),
    ]:
        actions.append({
            'WFWorkflowActionIdentifier': 'is.workflow.actions.properties.workout',
            'WFWorkflowActionParameters': {
                'UUID': prop_uuid,
                'WFContentItemPropertyName': prop_name,
                'WFInput': param_ref(uuid_workouts, 'Workouts'),
            },
        })

    # ── Ansatz B: Repeat-Loop, Repeat Item als Text ───────────────────────────
    # Repeat Item OutputName auf DE: 'Repeat-Element' (häufigste Variante)
    REPEAT_ITEM_OUT = 'Repeat-Element'

    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.repeat.each',
        'WFWorkflowActionParameters': {
            'UUID': uuid_repeat,
            'WFInput': {
                'Type': 'Variable',
                'Variable': param_ref(uuid_workouts, 'Workouts'),
            },
            'WFControlFlowMode': 0,
        },
    })

    # Text des aktuellen Repeat Items
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_item_text,
            'WFTextActionText': text_with_vars([(uuid_repeat, REPEAT_ITEM_OUT)]),
        },
    })

    # Zur Liste hinzufügen
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.appendvariable',
        'WFWorkflowActionParameters': {
            'WFInput': param_ref(uuid_item_text, OUT_TEXT),
            'WFVariableName': 'LoopItems',
        },
    })

    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.repeat.each',
        'WFWorkflowActionParameters': {
            'UUID': uuid_repeat_end,
            'GroupingIdentifier': uuid_repeat,
            'WFControlFlowMode': 2,
        },
    })

    # ── Alles kombinieren ─────────────────────────────────────────────────────
    # Ansatz A OutputNames geraten (DE); leer = falsch geraten oder Action unbekannt
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_combined,
            'WFTextActionText': text_with_vars([
                '=BASELINE=\n', (uuid_text, OUT_TEXT),
                '\n\n=A:DURATION=\n', (uuid_dur_a, 'Dauer'),
                '\n=A:DISTANCE=\n', (uuid_dist_a, 'Distanz'),
                '\n=A:CALORIES=\n', (uuid_cal_a, 'Verbrannte aktive Energie'),
                '\n=A:START=\n', (uuid_start_a, 'Startdatum'),
                '\n\n=B:LOOP_ITEMS=\n',
                (uuid_list_var, 'LoopItems'),
            ]),
        },
    })

    # URL-Encode + öffnen
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.urlencode',
        'WFWorkflowActionParameters': {
            'UUID': uuid_encoded,
            'WFInput': param_ref_as_text(uuid_combined, OUT_TEXT),
        },
    })
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': uuid_url,
            'WFTextActionText': text_with_vars([
                'obsidian://apple-health-sync?workout_debug=',
                (uuid_encoded, OUT_URLENCODED),
            ]),
        },
    })
    actions.append({
        'WFWorkflowActionIdentifier': 'is.workflow.actions.openurl',
        'WFWorkflowActionParameters': {
            'WFInput': param_ref(uuid_url, OUT_TEXT),
            'UUID': make_uuid(),
        },
    })

    return actions


def main():
    parser = argparse.ArgumentParser(
        description='Apple Health Sync iOS Shortcut Generator'
    )
    parser.add_argument(
        '--days', type=int, default=5,
        help='Tage Historie (default: 5; Catchup: 14)'
    )
    parser.add_argument(
        '--cooldown', type=int, default=60,
        help='Cooldown-Minuten vor erneutem Sync (default: 60; 0 = kein Pre-Check)'
    )
    parser.add_argument(
        '-o', '--output', default='Apple-Health-Sync.unsigned.shortcut',
        help='Output-Dateiname'
    )
    parser.add_argument(
        '--mode', default='standard',
        choices=['standard', 'debug-workouts', 'debug-workouts2', 'debug-workouts3'],
        help='Shortcut-Modus'
    )
    args = parser.parse_args()

    if args.mode == 'debug-workouts':
        actions = build_debug_workout_actions()
    elif args.mode == 'debug-workouts2':
        actions = build_debug_workout2_actions()
    elif args.mode == 'debug-workouts3':
        actions = build_debug_workout3_actions()
    else:
        actions = build_actions(args.days, args.cooldown)

    shortcut = {
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowIcon': {
            'WFWorkflowIconStartColor': 4282601983,
            'WFWorkflowIconGlyphNumber': 59511,
        },
        'WFWorkflowClientVersion': '2602.0.5',
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowHasOutputFallback': False,
        'WFWorkflowActions': actions,
        'WFWorkflowInputContentItemClasses': [
            'WFStringContentItem',
            'WFDateContentItem',
        ],
        'WFWorkflowTypes': [],
        'WFWorkflowHasShortcutInputVariables': False,
        'WFWorkflowImportQuestions': [],
    }

    with open(args.output, 'wb') as f:
        plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)

    if args.mode != 'standard':
        print(f'Generiert: {args.output} — {len(actions)} Aktionen, Modus: {args.mode}')
    else:
        cooldown_desc = f'{args.cooldown}min Cooldown' if args.cooldown > 0 else 'kein Cooldown'
        print(
            f'Generiert: {args.output} — '
            f'{len(actions)} Aktionen, {len(METRICS)} Metriken, '
            f'{args.days} Tage, {cooldown_desc}'
        )


if __name__ == '__main__':
    main()
