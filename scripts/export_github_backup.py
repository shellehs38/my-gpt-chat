"""Export accessible GitHub data to a private snapshot. Never print tokens or bodies."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

CHUNK = 40 * 1024 * 1024
SECRET = re.compile(rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|(?:glpat-|ghp_|gho_|ghs_)[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{40,}')
ENDPOINTS = {
    'repository': '', 'issues': '/issues?state=all&per_page=100',
    'issue-comments': '/issues/comments?per_page=100',
    'pulls': '/pulls?state=all&per_page=100',
    'review-comments': '/pulls/comments?per_page=100',
    'labels': '/labels?per_page=100', 'milestones': '/milestones?state=all&per_page=100',
    'releases': '/releases?per_page=100', 'environments': '/environments?per_page=100',
    'rulesets': '/rulesets?per_page=100', 'collaborators': '/collaborators?per_page=100',
    'workflows': '/actions/workflows?per_page=100',
    'artifacts': '/actions/artifacts?per_page=100', 'runs': '/actions/runs?per_page=100',
    'secret-names': '/actions/secrets?per_page=100',
}


def parse_pages(text):
    pages = []
    decoder = json.JSONDecoder()
    remaining = text.lstrip()
    while remaining:
        value, end = decoder.raw_decode(remaining)
        pages.append(value)
        remaining = remaining[end:].lstrip()
    return pages


def api(route):
    result = subprocess.run(['gh', 'api', route, '--paginate'], capture_output=True)
    if result.returncode:
        match = re.search(rb'HTTP (\d+)', result.stderr)
        return None, match.group(1).decode() if match else 'unavailable'
    return parse_pages(result.stdout.decode()), 'saved'


def flatten(pages, key=None):
    return [row for page in (pages or []) for row in (page if isinstance(page, list) else page.get(key, []))]


def export(repo, out):
    out.mkdir(parents=True, exist_ok=True)
    coverage = []
    manifest = []
    metadata = {}

    def save_bytes(name, data):
        if SECRET.search(data):
            coverage.append({'resource': name, 'status': 'quarantined_credential_pattern'})
            return
        path = out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        manifest.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})

    def download(route, name, binary_asset=False):
        with tempfile.TemporaryFile() as stream:
            args = ['gh', 'api', route]
            if binary_asset:
                args += ['-H', 'Accept: application/octet-stream']
            result = subprocess.run(args, stdout=stream, stderr=subprocess.PIPE)
            if result.returncode:
                match = re.search(rb'HTTP (\d+)', result.stderr)
                coverage.append({'resource': name, 'status': match.group(1).decode() if match else 'download_failed'})
                return
            stream.seek(0)
            digest = hashlib.sha256()
            part = 0
            while True:
                data = stream.read(CHUNK)
                if not data:
                    break
                digest.update(data)
                save_bytes(name + f'.part{part:04d}', data)
                part += 1
            coverage.append({'resource': name, 'status': 'downloaded', 'parts': part, 'sha256': digest.hexdigest()})

    prefix = 'repos/' + repo
    for name, suffix in ENDPOINTS.items():
        data, status = api(prefix + suffix)
        coverage.append({'resource': name, 'status': status})
        metadata[name] = data
        if data is not None:
            save_bytes('metadata/' + name + '.json', json.dumps(data, ensure_ascii=False, indent=2).encode())
    for pr in flatten(metadata.get('pulls')):
        data, status = api(prefix + f'/pulls/{pr["number"]}/reviews?per_page=100')
        coverage.append({'resource': f'pr-{pr["number"]}-reviews', 'status': status})
        if data is not None:
            save_bytes(f'metadata/reviews/{pr["number"]}.json', json.dumps(data, ensure_ascii=False).encode())
    for release in flatten(metadata.get('releases')):
        for asset in release.get('assets', []):
            download(prefix + f'/releases/assets/{asset["id"]}', f'release-assets/{asset["id"]}.bin', binary_asset=True)
    for artifact in flatten(metadata.get('artifacts'), 'artifacts'):
        if artifact.get('expired'):
            coverage.append({'resource': 'artifact-' + str(artifact['id']), 'status': 'expired'})
        else:
            download(prefix + f'/actions/artifacts/{artifact["id"]}/zip', f'artifacts/{artifact["id"]}.zip')
    for run in flatten(metadata.get('runs'), 'workflow_runs'):
        if run.get('status') == 'completed':
            download(prefix + f'/actions/runs/{run["id"]}/logs', f'logs/{run["id"]}.zip')
    # Only names/metadata can be queried; GitHub cannot return stored secret values.
    coverage += [{'resource': name, 'status': 'not_exported'} for name in ['secret-values', 'webhook-configuration', 'wiki', 'lfs-objects', 'discussion-attachments', 'projects-boards']]
    save_bytes('COVERAGE.json', json.dumps(coverage, ensure_ascii=False, indent=2).encode())
    (out / 'FILES.json').write_text(json.dumps(manifest, indent=2))
    (out / 'README.md').write_text('GitHub export. Coverage and exclusions are in COVERAGE.json. Each binary is split into ordered .part0000, .part0001 files; concatenate in numeric order and verify the full SHA256 in COVERAGE.json. FILES.json lists individual chunk hashes. Secret values, external databases and all chat histories are not part of this export.\n')
    required = ['repository', 'issues', 'pulls', 'issue-comments', 'review-comments', 'releases']
    return all(metadata.get(name) is not None for name in required)
