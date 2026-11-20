"""Reuse the metadata fetched by Orpheus, without an extra Qobuz request."""
from functools import wraps
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse


def install_title_reporter(module, url):
    kind, media_id = urlparse(url).path.strip('/').split('/')
    kind = 'artist' if kind == 'interpreter' else kind
    method_name = f'get_{kind}_info'
    original = getattr(module, method_name)
    metadata = {}
    target = Path(os.environ['DOWNLOAD_DIR']) / '.qws-metadata.json'

    def save():
        temporary = target.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
        temporary.replace(target)

    def clean(value):
        return re.sub(r'[\x00-\x1f\x7f]', ' ', str(value or '')).strip()[:500]

    def update(track_id, status):
        track = next((item for item in metadata.get('tracks', []) if item['id'] == str(track_id)), None)
        if track and track['status'] != status:
            track['status'] = status
            save()

    def observe(line):
        match = re.fullmatch(r'\s*=== Track ([a-zA-Z0-9]+) (downloaded|failed|skipped) ===\s*', line)
        if match:
            update(match[1], {'downloaded': 'completed', 'failed': 'failed', 'skipped': 'skipped'}[match[2]])

    @wraps(original)
    def get_info(self, requested_id, *args, **kwargs):
        info = original(self, requested_id, *args, **kwargs)
        if str(requested_id) == media_id:
            artist = (', '.join(info.artists) if kind == 'track' else
                      getattr(info, 'artist', None) or getattr(info, 'creator', None))
            title = f'{artist} - {info.name}' if artist else info.name
            metadata['title'] = clean(title)
            if kind == 'album' and hasattr(info, 'tracks'):
                data = getattr(info, 'track_extra_kwargs', {}).get('data', {})
                metadata['tracks'] = []
                for index, track_id in enumerate(info.tracks, 1):
                    track_id = str(track_id)
                    if not re.fullmatch(r'[a-zA-Z0-9]{1,100}', track_id):
                        continue
                    raw = data.get(track_id, {})
                    name = raw.get('title') or f'Трек {index}'
                    if raw.get('work'):
                        name = f"{raw['work']} - {name}"
                    if raw.get('version'):
                        name += f" ({raw['version']})"
                    metadata['tracks'].append({'id': track_id, 'title': clean(name),
                        'artist': clean((raw.get('performer') or {}).get('name') or artist),
                        'number': index, 'status': 'pending'})
            save()
            print(f'Название: {title}', flush=True)
        return info

    setattr(module, method_name, get_info)

    if kind == 'album' and hasattr(module, 'get_track_info'):
        original_track = module.get_track_info

        @wraps(original_track)
        def get_track(self, track_id, *args, **kwargs):
            update(track_id, 'running')
            try:
                return original_track(self, track_id, *args, **kwargs)
            except Exception:
                update(track_id, 'failed')
                raise

        module.get_track_info = get_track
    return observe
