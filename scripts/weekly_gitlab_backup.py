"""Save append-only Git snapshots; never delete or force-update destination refs."""
import datetime
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import json
import hashlib
from export_github_backup import export


def git(*args, env=None):
    return subprocess.check_output(['git', *args], env=env, stderr=subprocess.PIPE).decode()


def targets(rows, stamp):
    result = {}
    for row in rows:
        oid, ref = row.split()
        if ref == 'refs/remotes/origin/HEAD':
            continue
        if ref.startswith('refs/remotes/github-pull/'):
            dest = 'refs/heads/backups/' + stamp + '/pull-requests/' + ref[len('refs/remotes/github-pull/'):]
        elif ref.startswith('refs/remotes/origin/'):
            dest = 'refs/heads/backups/' + stamp + '/branches/' + ref[len('refs/remotes/origin/'):]
        elif ref.startswith('refs/tags/'):
            dest = 'refs/tags/backups/' + stamp + '/' + ref[len('refs/tags/'):]
        else:
            continue
        result[dest] = oid
    return result


def main():
    secret = os.environ.pop('GITLAB_BACKUP_SSH_KEY', '')
    if not secret.strip():
        raise SystemExit('Missing repository secret GITLAB_BACKUP_SSH_KEY; backup is not configured.')
    repo = os.environ['GITHUB_REPOSITORY'].split('/')[-1]
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + os.environ['GITHUB_RUN_ID'] + '-' + os.environ.get('GITHUB_RUN_ATTEMPT', '1')
    rows = git('for-each-ref', '--format=%(objectname) %(refname)', 'refs/remotes/origin', 'refs/remotes/github-pull', 'refs/tags').splitlines()
    expected = targets(rows, stamp)
    if not expected:
        raise SystemExit('No references to back up')
    git('fsck', '--full')
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        key = root / 'key'
        key.write_text(secret)
        key.chmod(0o600)
        env = os.environ.copy()
        env['GIT_TERMINAL_PROMPT'] = '0'
        env['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=' + shlex.quote(str(Path('scripts/gitlab_known_hosts').resolve())) + ' -i ' + shlex.quote(str(key))
        url = 'git@gitlab.com:svoi-ludi-group/' + repo + '.git'
        data_dir = root / 'export'
        metadata_ok = export(os.environ['GITHUB_REPOSITORY'], data_dir)
        git('init', '-b', 'main', str(data_dir))
        git('-C', str(data_dir), 'config', 'user.name', 'GitHub Backup')
        git('-C', str(data_dir), 'config', 'user.email', 'backup@localhost.invalid')
        git('-C', str(data_dir), 'add', '.')
        git('-C', str(data_dir), 'commit', '-m', 'GitHub data snapshot ' + stamp)
        data_ref = 'refs/heads/backups/' + stamp + '/metadata'
        data_sha = git('-C', str(data_dir), 'rev-parse', 'HEAD').strip()
        git('-C', str(data_dir), 'push', '--atomic', url, 'HEAD:' + data_ref, env=env)
        git('push', '--atomic', url, *[oid + ':' + ref for ref, oid in expected.items()], env=env)
        remote = {line.split()[1]: line.split()[0] for line in git('ls-remote', url, env=env).splitlines()}
        if any(remote.get(ref) != oid for ref, oid in expected.items()):
            raise SystemExit('Backup reference mismatch')
        restored = root / 'restored.git'
        git('clone', '--mirror', url, str(restored), env=env)
        git('-C', str(restored), 'fsck', '--full', env=env)
        if git('-C', str(restored), 'rev-parse', data_ref).strip() != data_sha:
            raise SystemExit('Metadata snapshot mismatch')
        for item in json.loads((data_dir / 'FILES.json').read_text()):
            content = subprocess.check_output(['git', '-C', str(restored), 'show', data_sha + ':' + item['path']], env=env, stderr=subprocess.PIPE)
            if hashlib.sha256(content).hexdigest() != item['sha256']:
                raise SystemExit('Export file checksum mismatch')
    if not metadata_ok:
        raise SystemExit('Git copied, but required GitHub metadata export was incomplete; inspect COVERAGE.json')
    message = f'{repo}: {len(expected)} refs and metadata file checksums verified; restore fsck passed; snapshot {stamp}\n'
    print(message)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write(message)

if __name__ == '__main__':
    main()
