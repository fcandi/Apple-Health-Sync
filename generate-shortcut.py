#!/usr/bin/env python3
"""
Generates the Apple Health Sync iOS Shortcut as a .shortcut (plist) file.
v7 — Date inside JSON payload, skip-on-error for optional metrics.
Based on analysis of user's real shortcut plist structure.
"""
import plistlib
import uuid

def make_uuid():
    return str(uuid.uuid4()).upper()

def action_output_ref(action_uuid, output_name):
    """Plain reference — used inside attachmentsByRange (NO WFTextTokenAttachment wrapper)."""
    return {
        'OutputUUID': action_uuid,
        'Type': 'ActionOutput',
        'OutputName': output_name,
    }

def param_ref(action_uuid, output_name):
    """Wrapped reference — used for standalone action parameters."""
    return {
        'Value': action_output_ref(action_uuid, output_name),
        'WFSerializationType': 'WFTextTokenAttachment',
    }

def param_ref_as_text(action_uuid, output_name):
    """Reference as WFTextTokenString — for params that expect text input."""
    return {
        'Value': {
            'string': '\ufffc',
            'attachmentsByRange': {
                '{0, 1}': action_output_ref(action_uuid, output_name),
            },
        },
        'WFSerializationType': 'WFTextTokenString',
    }

def text_with_vars(text_parts):
    """Build WFTextTokenString. Variable refs are (uuid, output_name) tuples."""
    result_text = ""
    attachments = {}
    for part in text_parts:
        if isinstance(part, str):
            result_text += part
        elif isinstance(part, tuple):
            action_uuid, output_name = part
            pos = len(result_text)
            result_text += "\ufffc"
            range_key = "{" + str(pos) + ", 1}"
            attachments[range_key] = action_output_ref(action_uuid, output_name)
    value = {'string': result_text}
    if attachments:
        value['attachmentsByRange'] = attachments
    return {
        'Value': value,
        'WFSerializationType': 'WFTextTokenString',
    }

def health_find_action(action_uuid, display_name, group_by_day=True,
                        sort_latest=False, limit=None):
    filter_templates = [
        {
            'Bounded': True, 'Operator': 4, 'Removable': False, 'Property': 'Type',
            'Values': {'Enumeration': {'Value': display_name, 'WFSerializationType': 'WFStringSubstitutableState'}},
        },
        {
            'Operator': 1001, 'Removable': True, 'Property': 'Start Date',
            'Values': {'Unit': 16, 'Number': 1},
        },
    ]
    params = {
        'UUID': action_uuid,
        'WFContentItemFilter': {
            'Value': {
                'WFActionParameterFilterPrefix': 1,
                'WFContentPredicateBoundedDate': False,
                'WFActionParameterFilterTemplates': filter_templates,
            },
            'WFSerializationType': 'WFContentPredicateTableTemplate',
        },
    }
    if group_by_day:
        params['WFHKSampleFilteringGroupBy'] = 'Day'
    if sort_latest:
        params['WFContentItemSortProperty'] = 'Start Date'
        params['WFContentItemSortOrder'] = 'Latest First'
    if limit is not None:
        params['WFContentItemLimitEnabled'] = True
        params['WFContentItemLimitNumber'] = limit
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.filter.health.quantity',
        'WFWorkflowActionParameters': params,
    }


# --- UUIDs ---
uuid_adjust   = make_uuid()
uuid_format   = make_uuid()
uuid_steps    = make_uuid()
uuid_rhr      = make_uuid()
uuid_hrv      = make_uuid()
uuid_cal      = make_uuid()
uuid_exercise = make_uuid()
uuid_json     = make_uuid()
uuid_encode   = make_uuid()
uuid_url      = make_uuid()

actions = []

# === Action 1: Adjust Date — Subtract 1 Day ===
actions.append({
    'WFWorkflowActionIdentifier': 'is.workflow.actions.adjustdate',
    'WFWorkflowActionParameters': {
        'WFDuration': {
            'Value': {'Unit': 'days', 'Magnitude': '1'},
            'WFSerializationType': 'WFQuantityFieldValue',
        },
        'WFAdjustOperation': 'Subtract',
        'UUID': uuid_adjust,
    },
})

# === Action 2: Format Date (yyyy-MM-dd) ===
actions.append({
    'WFWorkflowActionIdentifier': 'is.workflow.actions.format.date',
    'WFWorkflowActionParameters': {
        'WFDateFormatStyle': 'Custom',
        'UUID': uuid_format,
        'WFDateFormat': 'yyyy-MM-dd',
        'WFDate': param_ref(uuid_adjust, 'Adjusted Date'),
    },
})

# === Health Queries ===
# All use Limit 1 to avoid multi-value problems
actions.append(health_find_action(uuid_steps, 'Steps', group_by_day=True))
actions.append(health_find_action(uuid_rhr, 'Resting Heart Rate',
    group_by_day=False, sort_latest=True, limit=1))
actions.append(health_find_action(uuid_hrv, 'Heart Rate Variability',
    group_by_day=False, sort_latest=True, limit=1))
actions.append(health_find_action(uuid_cal, 'Active Calories', group_by_day=True))
# Exercise Minutes — may show error dialog if no data exists (e.g. no Apple Watch)
# User taps OK, shortcut continues with empty value, plugin handles it gracefully
actions.append(health_find_action(uuid_exercise, 'Exercise Minutes', group_by_day=True, limit=1))

# === Text: JSON payload (date included in JSON for robustness) ===
json_parts = [
    '{"date":"',
    (uuid_format, 'Formatted Date'),
    '","metrics":{"steps":',
    (uuid_steps, 'Health-Messungen'),
    ',"resting_hr":',
    (uuid_rhr, 'Health-Messungen'),
    ',"hrv":',
    (uuid_hrv, 'Health-Messungen'),
    ',"calories_active":',
    (uuid_cal, 'Health-Messungen'),
    ',"intensity_min":',
    (uuid_exercise, 'Health-Messungen'),
    '}}',
]
actions.append({
    'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
    'WFWorkflowActionParameters': {
        'UUID': uuid_json,
        'WFTextActionText': text_with_vars(json_parts),
    },
})

# === URL Encode ===
actions.append({
    'WFWorkflowActionIdentifier': 'is.workflow.actions.urlencode',
    'WFWorkflowActionParameters': {
        'UUID': uuid_encode,
        'WFInput': param_ref_as_text(uuid_json, 'Text'),
    },
})

# === Text: Obsidian URL ===
url_parts = [
    'obsidian://apple-health-sync?data=',
    (uuid_encode, 'Text der codierten URL'),
    '&v=1',
]
actions.append({
    'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
    'WFWorkflowActionParameters': {
        'UUID': uuid_url,
        'WFTextActionText': text_with_vars(url_parts),
    },
})

# === Open URL ===
actions.append({
    'WFWorkflowActionIdentifier': 'is.workflow.actions.openurl',
    'WFWorkflowActionParameters': {
        'WFInput': param_ref(uuid_url, 'Text'),
        'UUID': make_uuid(),
    },
})

# === Build shortcut ===
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

print("Generated shortcut (v7)")
