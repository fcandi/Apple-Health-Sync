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
    json_parts.append('}}')

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
        '--mode', default='standard', choices=['standard', 'debug-workouts'],
        help='Shortcut-Modus: standard = normaler Sync; debug-workouts = Toolbox-Rohdaten-Test'
    )
    args = parser.parse_args()

    if args.mode == 'debug-workouts':
        actions = build_debug_workout_actions()
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

    if args.mode == 'debug-workouts':
        print(f'Generiert: {args.output} — {len(actions)} Aktionen, Modus: debug-workouts (Toolbox, 5 Workouts)')
    else:
        cooldown_desc = f'{args.cooldown}min Cooldown' if args.cooldown > 0 else 'kein Cooldown'
        print(
            f'Generiert: {args.output} — '
            f'{len(actions)} Aktionen, {len(METRICS)} Metriken, '
            f'{args.days} Tage, {cooldown_desc}'
        )


if __name__ == '__main__':
    main()
