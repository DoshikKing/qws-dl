"""Apply server-only environment settings and invoke the installed Orpheus CLI."""
import json
import os
from pathlib import Path
import re
import runpy
import sys

from qobuz_web import QobuzWebError
from media_title import install_title_reporter
from worker_safety import install_network_safety, install_download_safety


def main():
    if len(sys.argv) != 4 or sys.argv[3] not in {'hifi', 'lossless', 'high'}:
        raise ValueError('Expected: run-orpheus.py ORPHEUS_DIR QOBUZ_URL QUALITY')
    root, url, quality = Path(sys.argv[1]).resolve(), sys.argv[2], sys.argv[3]
    install_network_safety()
    os.chdir(root)
    sys.path.insert(0, str(root))
    install_download_safety(os.environ['DOWNLOAD_DIR'])
    from qobuz_web import install_web_api
    install_web_api()
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
    settings['global'].setdefault('formatting', {}).update({
        'album_format': '{artist} - {name}{explicit}',
        'track_filename_format': '{track_number}. {artist} - {name}',
        'single_full_path_format': '{artist} - {name}',
    })
    user_id, token = os.environ.get('QOBUZ_USER_ID'), os.environ.get('QOBUZ_AUTH_TOKEN')
    if not user_id or not token:
        raise QobuzWebError('Войдите в Qobuz через Настройки → Qobuz.')
    settings['modules']['qobuz'].update(username=user_id, password=token, app_id='', app_secret='')
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

    from modules.qobuz.interface import ModuleInterface
    install_title_reporter(ModuleInterface, url)

    output = Output()
    sys.stdout = output
    sys.argv = ['orpheus.py', '-o', os.environ['DOWNLOAD_DIR'], url]
    runpy.run_path(str(root / 'orpheus.py'), run_name='__main__')
    if os.environ.get('QWS_LYRICS') == '1':
        try:
            from lyrics import enrich_downloads
            enrich_downloads(os.environ['DOWNLOAD_DIR'], os.environ.get('QWS_LYRICS_CACHE', ''))
        except Exception:
            # Optional enrichment must never turn a successful music download into a failure.
            print('Не удалось добавить тексты; аудиофайлы сохранены.', flush=True)
    if output.failed:
        raise SystemExit(2)


if __name__ == '__main__':
    try:
        main()
    except QobuzWebError as error:
        print(f'Qobuz: {error}', file=sys.stderr, flush=True)
        raise SystemExit(3)
