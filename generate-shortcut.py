#!/usr/bin/env python3
"""
Apple Health Sync iOS Shortcut Generator — v10 (Option C).

Strategie: Shortcut liefert pro Metrik zwei parallele Listen (Werte + formatierte
Tagesdatums), Plugin filtert den gestrigen Kalendertag heraus. Gründe:

  - Kein 24h-Fenster-Problem (Plugin wählt per Tages-String, keine Datums-Arithmetik)
  - Zeitzonen-resistent (Shortcut und Plugin teilen denselben yyyy-MM-dd-String)
  - Shortcut bleibt schlank — jede Filter-Logikänderung = Plugin-Update via
    Obsidian-Store, kein manuelles Re-Install des Shortcuts
"""
import plistlib
import uuid


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
    """WFTextTokenAttachment — for standalone action parameters (WFDate, WFInput)."""
    return {
        'Value': action_output_ref(action_uuid, output_name),
        'WFSerializationType': 'WFTextTokenAttachment',
    }


def param_ref_as_text(action_uuid, output_name):
    """WFTextTokenString — for params that expect text input."""
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
    """Build WFTextTokenString. Parts sind entweder str oder
       (uuid, output_name) bzw. (uuid, output_name, date_fmt) für Inline-Datumsformat."""
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


# OutputNames — Apple lokalisiert nur einen Teil der Aktionen. Empirisch:
#   .adjustdate, .format.date, .gettext, .urlencode → fest englisch
#   .filter.health.quantity, .properties.health.quantity → lokalisiert (DE)
# Bei Mismatch bleibt die Variable im Text leer, daher pro Aktion richtig treffen.
OUT_ADJUSTED_DATE = 'Adjusted Date'
OUT_HEALTH = 'Health-Messungen'
OUT_START_DATE = 'Startdatum'
OUT_TEXT = 'Text'
OUT_URLENCODED = 'Text der codierten URL'


def health_find(action_uuid, display_name, days=3):
    """Find-Health-Samples mit Filter 'letzte N Tage' + Gruppieren nach Tag."""
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
    """Details-of-Health-Sample → Start Date (liefert parallele Liste zur Health-Liste)."""
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.properties.health.quantity',
        'WFWorkflowActionParameters': {
            'UUID': action_uuid,
            'WFContentItemPropertyName': 'Start Date',
            'WFInput': param_ref(health_uuid, OUT_HEALTH),
        },
    }


# --- Plan: pro Metrik 2 Aktionen (Find, Extract Start Date) — Formatierung inline ---
METRICS = [
    # (json_key, iOS-Typname)
    ('steps',           'Steps'),
    ('resting_hr',      'Resting Heart Rate'),
    ('hrv',             'Heart Rate Variability'),
    ('calories_active', 'Active Calories'),
    ('intensity_min',   'Exercise Time'),
]

# --- UUIDs für Date-Setup ---
uuid_yesterday = make_uuid()
uuid_json      = make_uuid()
uuid_encode    = make_uuid()
uuid_url       = make_uuid()

# Pro Metrik zwei UUIDs
metric_uuids = {
    key: (make_uuid(), make_uuid())  # find, extract
    for key, _ in METRICS
}

actions = []

# === 1. Gestern-Datum (Subtract 1 Day ohne Input nimmt aktuelle Zeit) ===
# Formatierung passiert inline im Text via Aggrandizement — keine format.date-Aktion.
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

# === 2. Pro Metrik: Find Health + Extract Start Date ===
for key, display_name in METRICS:
    u_find, u_extract = metric_uuids[key]
    actions.append(health_find(u_find, display_name, days=3))
    actions.append(extract_start_date(u_extract, u_find))

# === 3. JSON-Payload bauen — Datums inline formatiert via Aggrandizement ===
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

# === 7. URL-Encode ===
actions.append({
    'WFWorkflowActionIdentifier': 'is.workflow.actions.urlencode',
    'WFWorkflowActionParameters': {
        'UUID': uuid_encode,
        'WFInput': param_ref_as_text(uuid_json, OUT_TEXT),
    },
})

# === 8. Obsidian-URL ===
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

# === 9. URL öffnen ===
actions.append({
    'WFWorkflowActionIdentifier': 'is.workflow.actions.openurl',
    'WFWorkflowActionParameters': {
        'WFInput': param_ref(uuid_url, OUT_TEXT),
        'UUID': make_uuid(),
    },
})

# === Shortcut zusammenbauen ===
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

with open('Apple-Health-Sync.unsigned.shortcut', 'wb') as f:
    plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)

print(f'Generated shortcut v10 — {len(actions)} actions, {len(METRICS)} metrics, v=2 payload format')
