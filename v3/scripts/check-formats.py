#!/usr/bin/env python3
"""Optional independent format check. Needs jsonschema and PyYAML, not used at runtime."""
from pathlib import Path
import json
import sys
try:
    import yaml
    from jsonschema import Draft7Validator, FormatChecker
except ImportError as exc:
    raise SystemExit('Optional check requires Python packages jsonschema and PyYAML; Pulso itself does not require them.') from exc
root = Path(__file__).resolve().parents[1]
schemas = {}
for file in (root / 'schemas').glob('*.json'):
    value = json.loads(file.read_text(encoding='utf8'))
    Draft7Validator.check_schema(value)
    schemas[file.name.replace('.schema.json', '')] = value
json_count = 0
for file in (root / 'templates').glob('*.json'):
    Draft7Validator(schemas[file.stem], format_checker=FormatChecker()).validate(json.loads(file.read_text(encoding='utf8')))
    json_count += 1
yaml_count = 0
for file in list((root / 'adapters').rglob('*.md')) + list((root / 'skills').rglob('SKILL.md')):
    text = file.read_text(encoding='utf8')
    assert text.startswith('---\n'), file
    front = yaml.safe_load(text.split('---', 2)[1])
    assert isinstance(front, dict), file
    assert isinstance(front.get('description'), str), file
    assert front['description'].strip(), file
    if file.name == 'SKILL.md':
        assert front['name'] == file.parent.name, file
    yaml_count += 1
print(json.dumps({'status': 'PASS', 'schemasDraft07': len(schemas), 'jsonExamples': json_count,
                  'yamlFrontmatters': yaml_count, 'nativeHostExecution': 'NOT_RUN'}, indent=2))
