"""Apply server-only environment settings and invoke the installed Orpheus CLI."""
import json
import os
from pathlib import Path
import re
import runpy
import sys


def main():
    if len(sys.argv) != 4 or sys.argv[3] not in {'hifi', 'lossless', 'high'}:
        raise ValueError('Expected: run-orpheus.py ORPHEUS_DIR QOBUZ_URL QUALITY')
    root, url, quality = Path(sys.argv[1]).resolve(), sys.argv[2], sys.argv[3]
    os.chdir(root)
    sys.path.insert(0, str(root))
    os.umask(0o077)
    config_dir = root / 'config'
    config_dir.mkdir(mode=0o700, exist_ok=True)
    config_dir.chmod(0o700)
    for private_file in config_dir.iterdir():
        if private_file.is_file():
            private_file.chmod(0o600)
    # Constructing the core refreshes defaults but does not authenticate.
    from orpheus.core import Orpheus
    Orpheus(False)
    config_path = root / 'config/settings.json'
    settings = json.loads(config_path.read_text())
    settings['global']['general']['download_quality'] = quality
    settings['global']['advanced']['debug_mode'] = False
    for field in ('username', 'password', 'app_id', 'app_secret'):
        value = os.environ.get('QOBUZ_' + field.upper(), '')
        if not value:
            raise ValueError('Missing QOBUZ_' + field.upper())
        settings['modules']['qobuz'][field] = value
    config_path.chmod(0o600)
    config_path.write_text(json.dumps(settings, indent=2))

    # Upstream can return exit 0 even when individual tracks fail.
    class Output:
        failed = False

        def write(self, text):
            if re.search(r'=== Track .+ failed ===|Tagging failed', text):
                self.failed = True
            return sys.__stdout__.write(text)

        def flush(self):
            sys.__stdout__.flush()

        def isatty(self):
            return False

    output = Output()
    sys.stdout = output
    sys.argv = ['orpheus.py', '-o', os.environ['DOWNLOAD_DIR'], url]
    runpy.run_path(str(root / 'orpheus.py'), run_name='__main__')
    if output.failed:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
