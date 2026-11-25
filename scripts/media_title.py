"""Reuse the metadata fetched by Orpheus, without an extra Qobuz request."""
from functools import wraps
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse


def install_title_reporter(module, url):
    batch = isinstance(url, list)
    urls = url if batch else [url]
    kind, media_id = urlparse(urls[0]).path.strip('/').split('/')
    kind = 'artist' if kind == 'interpreter' else kind
    method_name = f'get_{kind}_info'
    original = getattr(module, method_name)
    metadata = {'title': f'Подборка треков · {len(urls)}', 'tracks': [
        {'id': value.rsplit('/', 1)[-1], 'title': f'Трек {index}', 'artist': '', 'number': index, 'status': 'pending'}
        for index, value in enumerate(urls, 1)]} if batch else {}
    current_track = None
    download_error = None
    target = Path(os.environ['DOWNLOAD_DIR']) / '.qws-metadata.json'

    def save():
        temporary = target.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
        temporary.replace(target)

    def clean(value):
        return re.sub(r'[\x00-\x1f\x7f]', ' ', str(value or '')).strip()[:500]

    def update(track_id, status, error=None):
        track = next((item for item in metadata.get('tracks', []) if item['id'] == str(track_id)), None)
        if track and track['status'] != status:
            track['status'] = status
            track['error'] = error if status == 'failed' else None
            save()

    def observe(line):
        nonlocal download_error
        if line.strip().startswith('Warning: Track download failed:'):
            # Never expose upstream exception text: it can contain signed URLs/tokens.
            download_error = 'Не удалось скачать аудиофайл.'
            for marker, message in (
                ('попытки докачки исчерпаны', 'Соединение прервано; попытки докачки исчерпаны.'),
                ('Лимит', 'Лимит загрузки или свободного места исчерпан.'),
                ('диапазон', 'Сервер вернул некорректный диапазон файла.'),
                ('версия файла', 'Версия файла изменилась при докачке.'),
            ):
                if marker.casefold() in line.casefold():
                    download_error = message
                    break
        match = re.fullmatch(r'\s*=== Track ([a-zA-Z0-9]+) (downloaded|failed|skipped) ===\s*', line)
        if match:
            update(match[1], {'downloaded': 'completed', 'failed': 'failed', 'skipped': 'skipped'}[match[2]],
                   download_error if match[1] == current_track and download_error else 'Не удалось скачать аудиофайл.')

    @wraps(original)
    def get_info(self, requested_id, *args, **kwargs):
        nonlocal current_track, download_error
        if batch:
            current_track, download_error = str(requested_id), None
            update(requested_id, 'running')
        try:
            info = original(self, requested_id, *args, **kwargs)
        except Exception:
            if batch:
                update(requested_id, 'failed', 'Не удалось получить данные трека Qobuz.')
            raise
        if batch:
            track = next((item for item in metadata['tracks'] if item['id'] == str(requested_id)), None)
            if track:
                track.update(title=clean(info.name), artist=clean(', '.join(info.artists)))
                save()
            return info
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
    if batch:
        save()

    if kind == 'album' and hasattr(module, 'get_track_info'):
        original_track = module.get_track_info

        @wraps(original_track)
        def get_track(self, track_id, *args, **kwargs):
            nonlocal current_track, download_error
            current_track, download_error = str(track_id), None
            update(track_id, 'running')
            try:
                return original_track(self, track_id, *args, **kwargs)
            except Exception:
                update(track_id, 'failed', 'Не удалось получить данные трека Qobuz.')
                raise

        module.get_track_info = get_track
    return observe
