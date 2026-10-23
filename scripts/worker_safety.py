"""Safety boundaries for the pinned upstream libraries, applied in worker processes."""
from functools import wraps
import os
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit

import requests


def install_network_safety():
    original = requests.sessions.Session.request
    if getattr(original, '_qws_safe', False):
        return

    @wraps(original)
    def request(self, method, url, **kwargs):
        # Upstream explicitly passes verify=False; never let it disable CA trust.
        kwargs['verify'] = os.environ.get('REQUESTS_CA_BUNDLE') or True
        if kwargs.get('timeout') is None:
            kwargs['timeout'] = 30
        return original(self, method, url, **kwargs)

    request._qws_safe = True
    requests.sessions.Session.request = request


def install_download_safety(directory):
    from utils import utils
    from qobuz_web import QobuzWebError
    root = Path(directory).resolve(strict=True)
    maximum = int(os.environ.get('MAX_JOB_BYTES', 10 * 1024**3))
    reserve = int(os.environ.get('MIN_FREE_BYTES', 1024**3))
    downloaded = 0
    original_name, original_path = utils.sanitise_name, utils.fix_byte_limit

    def name(value):
        clean = re.sub(r'[\x00-\x1f\x7f]', '', original_name(value)).strip()
        if clean in ('', '.', '..'):
            return '_'
        return '_' + clean if clean.startswith('.qws-') else clean

    def path(value, *args, **kwargs):
        target = Path(original_path(value, *args, **kwargs)).resolve()
        if not target.is_relative_to(root) or target == root:
            raise QobuzWebError('Недопустимый путь файла загрузки.')
        return str(target)

    def temporary():
        folder = root / '.qws-work'
        folder.mkdir(mode=0o700, exist_ok=True)
        return str(folder / os.urandom(16).hex())

    def download(url, file_location, headers=None, enable_progress_bar=False,
                 indent_level=0, artwork_settings=None):
        nonlocal downloaded
        if urlsplit(url).scheme != 'https':
            raise QobuzWebError('Для загрузки требуется HTTPS.')
        target = Path(file_location).resolve()
        if not target.is_relative_to(root) or target == root:
            raise QobuzWebError('Недопустимый путь файла загрузки.')
        if target.is_file():
            return
        with utils.r_session.get(url, stream=True, headers=headers or {}, timeout=30) as response:
            response.raise_for_status()
            if int(response.headers.get('content-length', 0)) > maximum - downloaded:
                raise QobuzWebError('Лимит размера загрузки исчерпан.')
            with target.open('xb') as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    if downloaded + len(chunk) > maximum or shutil.disk_usage(root).free < reserve + len(chunk):
                        raise QobuzWebError('Лимит загрузки или свободного места исчерпан.')
                    output.write(chunk)
                    downloaded += len(chunk)
        if artwork_settings and artwork_settings.get('should_resize', False):
            from PIL import Image
            resolution = artwork_settings.get('resolution', 1400)
            image_format = artwork_settings.get('format', 'jpeg')
            image_format = 'jpeg' if image_format == 'jpg' else image_format
            quality = 70 if artwork_settings.get('compression') == 'high' else 90
            with Image.open(target) as image:
                image = image.resize((resolution, resolution), Image.Resampling.BICUBIC)
                image.save(target, image_format, **({} if image_format == 'png' else {'quality': quality}))

    utils.sanitise_name = name
    utils.fix_byte_limit = path
    utils.create_temp_filename = temporary
    utils.download_file = download
