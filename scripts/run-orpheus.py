"""Apply server-only environment settings and invoke the installed Orpheus CLI."""
import json
import os
from pathlib import Path
import re
import runpy
import sys

from qobuz_web import QobuzWebError
from convert_audio import ConversionError, ensure_encoder, convert_downloads, normalize_options
from media_title import install_title_reporter
from worker_safety import install_network_safety, install_download_safety


def validate_urls(value):
    if not value.startswith('['):
        return None
    urls = json.loads(value)
    if not isinstance(urls, list) or not 1 <= len(urls) <= 50 or any(not isinstance(url, str) for url in urls) or len(set(urls)) != len(urls):
        raise ValueError('Invalid track batch')
    if any(not isinstance(url, str) or not re.fullmatch(r'https://open\.qobuz\.com/track/[a-zA-Z0-9]+', url) for url in urls):
        raise ValueError('Invalid track batch')
    return urls


def install_batch_downloads(urls):
    from orpheus.music_downloader import Downloader
    original = Downloader.download_track
    positions = {url.rsplit('/', 1)[-1]: index for index, url in enumerate(urls, 1)}

    def download(self, track_id, *args, **kwargs):
        previous = self.path
        folder = Path(os.environ['DOWNLOAD_DIR']) / f'{positions[str(track_id)]:02d}-{track_id}'
        folder.mkdir(parents=True, exist_ok=True)
        self.path = str(folder) + '/'
        try:
            return original(self, track_id, *args, **kwargs)
        except QobuzWebError:
            raise  # Authentication/infrastructure errors stop the batch.
        except Exception:
            print(f'=== Track {track_id} failed ===', flush=True)
        finally:
            self.path = previous
    Downloader.download_track = download


def main():
    if len(sys.argv) != 4 or sys.argv[3] not in {'hifi', 'lossless', 'high'}:
        raise ValueError('Expected: run-orpheus.py ORPHEUS_DIR QOBUZ_URL QUALITY')
    root, url, quality = Path(sys.argv[1]).resolve(), sys.argv[2], sys.argv[3]
    urls = validate_urls(url)
    batch = urls is not None
    output_format = os.environ.get('QWS_OUTPUT_FORMAT', 'original')
    try:
        format_options = normalize_options(output_format, json.loads(os.environ.get('QWS_FORMAT_OPTIONS', '{}')))
    except (ValueError, TypeError) as error:
        raise ConversionError('Некорректные настройки формата.') from error
    ensure_encoder(output_format)
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
        pending = ""

        def write(self, text):
            self.pending += text
            lines = self.pending.split('\n')
            self.pending = lines.pop()[-64000:]
            for line in lines:
                observe(line)
            if re.search(r'=== Track .+ failed ===|Tagging failed', text):
                self.failed = True
            return sys.__stdout__.write(text)

        def flush(self):
            sys.__stdout__.flush()

        def isatty(self):
            return False

    from modules.qobuz.interface import ModuleInterface
    observe = install_title_reporter(ModuleInterface, urls if batch else url)
    if batch:
        install_batch_downloads(urls)

    output = Output()
    sys.stdout = output
    sys.argv = ['orpheus.py', '-o', os.environ['DOWNLOAD_DIR'], *(urls if batch else [url])]
    runpy.run_path(str(root / 'orpheus.py'), run_name='__main__')
    convert_downloads(os.environ['DOWNLOAD_DIR'], output_format, format_options)
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
    except ConversionError as error:
        print(f'Конвертация: {error}', file=sys.stderr, flush=True)
        raise SystemExit(9)
    except QobuzWebError as error:
        print(f'Qobuz: {error}', file=sys.stderr, flush=True)
        raise SystemExit(3)
