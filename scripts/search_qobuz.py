"""Search Qobuz with the server's credentials, without modifying Orpheus settings."""
import contextlib
import json
from pathlib import Path
import re
import sys

from qobuz_web import QobuzWebError, web_api_class

PAGE_SIZE = 20


def image_url(image):
    """Return public Qobuz artwork only, without provider query strings or credentials."""
    from urllib.parse import urlsplit
    if isinstance(image, str):
        image = {'small': image}
    if not isinstance(image, dict):
        return None
    for size in ('small', 'medium', 'thumbnail', 'large'):
        value = image.get(size)
        if not isinstance(value, str) or len(value) > 2048:
            continue
        try:
            url = urlsplit(value)
            if (url.scheme == 'https' and url.hostname == 'static.qobuz.com'
                    and url.username is None and url.password is None and not url.port
                    and not re.search(r'[\x00-\x20\x7f\\]', value)):
                return f'https://static.qobuz.com{url.path}'
        except ValueError:
            continue
    return None


def number(value, maximum=10000000):
    try:
        return min(maximum, max(0, int(value or 0)))
    except (ValueError, TypeError, OverflowError):
        return 0


def catalog_results(data, offset, kind='tracks'):
    collection = data.get(kind) or {}
    items = []
    for item in collection.get('items', [])[:PAGE_SIZE]:
        identifier = str(item.get('id', ''))
        pattern = r'[a-zA-Z0-9]{1,64}' if kind == 'albums' else r'[0-9]{1,32}'
        if not re.fullmatch(pattern, identifier):
            continue
        media = {'tracks': 'track', 'albums': 'album', 'artists': 'artist'}[kind]
        result = {'id': identifier, 'url': f'https://open.qobuz.com/{media}/{identifier}'}
        if kind == 'artists':
            result.update(title=str(item.get('name') or 'Неизвестный исполнитель')[:500],
                          cover=image_url(item.get('image')) or image_url(item.get('picture')),
                          albumCount=number(item['albums_count']) if item.get('albums_count') is not None else None,
                          streamable=True)
        else:
            album = (item.get('album') or {}) if kind == 'tracks' else item
            artist = item.get('performer') or album.get('artist') or {}
            title = str(item.get('title') or 'Без названия')
            if item.get('version'):
                title += f' ({item["version"]})'
            result.update(title=title[:500], artist=str(artist.get('name') or 'Неизвестный исполнитель')[:500],
                          cover=image_url(album.get('image')), streamable=item.get('streamable') is True)
            if kind == 'tracks':
                result.update(album=str(album.get('title') or '')[:500], duration=number(item.get('duration')))
            else:
                release = str(item.get('release_date_original') or '')
                result.update(trackCount=number(item['tracks_count']) if item.get('tracks_count') is not None else None,
                              year=release[:4] if re.fullmatch(r'\d{4}-\d{2}-\d{2}', release) else None)
        items.append(result)
    total = number(collection.get('total'))
    return {kind: items, 'total': total, 'offset': offset,
            'hasMore': offset + PAGE_SIZE < min(total, 1000)}


def search_catalog(query, offset, kind='tracks'):
    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 200 or re.search(r'[\x00-\x1f\x7f]', query):
        raise ValueError('Invalid query')
    if type(offset) is not int or offset < 0 or offset > 980 or offset % PAGE_SIZE:
        raise ValueError('Invalid offset')
    if kind not in ('tracks', 'albums', 'artists'):
        raise ValueError('Invalid search type')
    from modules.qobuz.qobuz_api import Qobuz
    api = web_api_class(Qobuz)('', '', RuntimeError)
    data = api._get('catalog/search', {
        'query': query.strip(), 'type': kind, 'limit': PAGE_SIZE,
        'offset': offset, 'app_id': api.app_id,
    })
    return catalog_results(data, offset, kind)


def main():
    from worker_safety import install_network_safety
    install_network_safety()
    if len(sys.argv) not in (4, 5):
        raise ValueError('Invalid arguments')
    root, query, offset = sys.argv[1:4]
    kind = sys.argv[4] if len(sys.argv) == 5 else 'tracks'
    sys.path.insert(0, str(Path(root).resolve()))
    # Libraries may print login progress: stdout is reserved for the JSON response.
    with contextlib.redirect_stdout(sys.stderr):
        result = search_catalog(query, int(offset), kind)
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
