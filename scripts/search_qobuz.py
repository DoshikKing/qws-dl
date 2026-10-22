"""Search Qobuz with the server's credentials, without modifying Orpheus settings."""
import contextlib
import json
import os
from pathlib import Path
import re
import sys

from qobuz_web import QobuzWebError, web_api_class

PAGE_SIZE = 20


def track_results(data, offset):
    tracks = []
    for item in data.get('tracks', {}).get('items', []):
        identifier = str(item.get('id', ''))
        if not re.fullmatch(r'[0-9]{1,32}', identifier):
            continue
        album = item.get('album') or {}
        artist = item.get('performer') or album.get('artist') or {}
        title = item.get('title') or 'Без названия'
        if item.get('version'):
            title += f' ({item["version"]})'
        tracks.append({
            'id': identifier,
            'url': f'https://open.qobuz.com/track/{identifier}',
            'title': str(title)[:500],
            'artist': str(artist.get('name') or 'Неизвестный исполнитель')[:500],
            'album': str(album.get('title') or '')[:500],
            'duration': max(0, int(item.get('duration') or 0)),
            'streamable': item.get('streamable') is True,
        })
    total = max(0, int(data.get('tracks', {}).get('total') or 0))
    return {'tracks': tracks[:PAGE_SIZE], 'total': total, 'offset': offset,
            'hasMore': offset + PAGE_SIZE < min(total, 1000)}


def search_tracks(query, offset):
    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 200:
        raise ValueError('Invalid query')
    if not isinstance(offset, int) or offset < 0 or offset > 980 or offset % PAGE_SIZE:
        raise ValueError('Invalid offset')
    from modules.qobuz.qobuz_api import Qobuz
    mode = os.environ.get('QOBUZ_AUTH_MODE') or 'web'
    if mode in {'web', 'token'}:
        api = web_api_class(Qobuz)('', '', RuntimeError)
        # The web adapter authenticates lazily, including explicit browser-token mode.
    elif mode == 'mobile':
        api = Qobuz(os.environ['QOBUZ_APP_ID'], os.environ['QOBUZ_APP_SECRET'], RuntimeError)
        api.login(os.environ['QOBUZ_USERNAME'], os.environ['QOBUZ_PASSWORD'])
    else:
        raise ValueError('Invalid auth mode')
    data = api._get('catalog/search', {
        'query': query.strip(), 'type': 'tracks', 'limit': PAGE_SIZE,
        'offset': offset, 'app_id': api.app_id,
    })
    return track_results(data, offset)


def main():
    root, query, offset = sys.argv[1:]
    sys.path.insert(0, str(Path(root).resolve()))
    # Libraries may print login progress: stdout is reserved for the JSON response.
    with contextlib.redirect_stdout(sys.stderr):
        result = search_tracks(query, int(offset))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except QobuzWebError as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        raise SystemExit(3)
    except Exception:
        # Never expose upstream response bodies, tokens, configuration or tracebacks.
        print(json.dumps({'error': 'Поиск Qobuz недоступен. Проверьте авторизацию и подключение сервера.'}, ensure_ascii=False))
        raise SystemExit(1)
