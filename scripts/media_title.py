"""Reuse the metadata fetched by Orpheus, without an extra Qobuz request."""
from functools import wraps
import json
import os
from pathlib import Path
from urllib.parse import urlparse


def install_title_reporter(module, url):
    kind, media_id = urlparse(url).path.strip('/').split('/')
    kind = 'artist' if kind == 'interpreter' else kind
    method_name = f'get_{kind}_info'
    original = getattr(module, method_name)

    @wraps(original)
    def get_info(self, requested_id, *args, **kwargs):
        info = original(self, requested_id, *args, **kwargs)
        if str(requested_id) == media_id:
            artist = (', '.join(info.artists) if kind == 'track' else
                      getattr(info, 'artist', None) or getattr(info, 'creator', None))
            title = f'{artist} - {info.name}' if artist else info.name
            target = Path(os.environ['DOWNLOAD_DIR']) / '.qws-metadata.json'
            temporary = target.with_suffix('.json.tmp')
            temporary.write_text(json.dumps({'title': title}, ensure_ascii=False), encoding='utf-8')
            temporary.replace(target)
            print(f'Название: {title}', flush=True)
        return info

    setattr(module, method_name, get_info)
