"""Optional LRCLIB enrichment. Never send Qobuz credentials or audio to LRCLIB."""
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time
import unicodedata

import mutagen
from mutagen.flac import FLAC
from mutagen.id3 import ID3, SYLT, USLT
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis
import requests

MAX_RESPONSE = 1024 * 1024
USER_AGENT = 'QWS-DL/1.0 (https://github.com/DoshikKing/qws-dl)'


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())


def clean_text(value):
    if not isinstance(value, str) or len(value) > 200000:
        return ''
    return re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', value).strip()


def parse_lrc(text, duration):
    """Expand repeated timestamps and apply LRC offsets; SYLT uses milliseconds."""
    offset = re.findall(r'^\[offset:([+-]?\d+)\]\s*$', text, re.M | re.I)
    offset = int(offset[-1]) if offset else 0
    lines = []
    expanded = 0
    for line in text.splitlines():
        stamps = re.match(r'^(?:\[\d{1,3}:\d{2}(?:\.\d{1,3})?\])+', line)
        if not stamps:
            continue
        words = line[stamps.end():].strip()
        for minute, second in re.findall(r'\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]', stamps[0]):
            if float(second) >= 60:
                return []
            milliseconds = round((int(minute) * 60 + float(second)) * 1000) + offset
            if milliseconds < 0 or milliseconds > (duration + 2) * 1000:
                return []
            expanded += len(words) + 24
            if len(lines) >= 10000 or expanded > 200000:
                return []
            lines.append((words, milliseconds))
    return sorted(lines, key=lambda entry: entry[1]) if any(words for words, _ in lines) else []


def select_lyrics(record, artist, title, album, duration):
    if not isinstance(record, dict):
        raise ValueError('Invalid LRCLIB response')
    if any(not isinstance(record.get(key), str) or normalized(record[key]) != normalized(value)
           for key, value in [('artistName', artist), ('trackName', title), ('albumName', album)] if value):
        return None
    length = record.get('duration')
    if isinstance(length, bool) or not isinstance(length, (int, float)) or not math.isfinite(length) or abs(length - duration) > 2:
        return None
    if record.get('instrumental') is True:
        return None
    synced = clean_text(record.get('syncedLyrics'))
    lines = parse_lrc(synced, duration)
    plain = clean_text(record.get('plainLyrics')) or '\n'.join(words for words, _ in lines)
    if not plain and not lines:
        return None
    # Canonical LRC includes applied offsets and no untrusted header directives.
    lrc = '\n'.join(f'[{ms // 60000:02d}:{ms % 60000 // 1000:02d}.{ms % 1000:03d}]{words}' for words, ms in lines)
    return {'plain': plain, 'lrc': lrc, 'lines': lines}


@lru_cache(maxsize=64)
def lookup(artist, title, album, duration, cache_path=''):
    """Exact metadata lookup only; ambiguous/fuzzy matches are deliberately skipped."""
    key = json.dumps([artist, title, album, duration], ensure_ascii=False)
    cache = None
    try:
        if cache_path:
            try:
                cache = sqlite3.connect(cache_path, timeout=1)
                cache.execute('CREATE TABLE IF NOT EXISTS lyrics (key TEXT PRIMARY KEY, expires REAL, payload TEXT)')
                row = cache.execute('SELECT payload FROM lyrics WHERE key=? AND expires>?', (key, time.time())).fetchone()
                if row:
                    return json.loads(row[0])
            except (sqlite3.Error, ValueError):
                if cache:
                    cache.close()
                cache = None
        with requests.get('https://lrclib.net/api/get', params={
            'artist_name': artist, 'track_name': title, 'album_name': album, 'duration': duration,
        }, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'},
                timeout=(3, 5), allow_redirects=False, stream=True) as response:
            if response.status_code == 404:
                result = None
            else:
                response.raise_for_status()
                if response.status_code != 200:
                    raise ValueError('Unexpected LRCLIB response')
                body = bytearray()
                deadline = time.monotonic() + 10
                for chunk in response.iter_content(16384):
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE or time.monotonic() > deadline:
                        raise ValueError('LRCLIB response limit')
                result = select_lyrics(json.loads(body), artist, title, album, duration)
        payload = json.dumps(result, ensure_ascii=False)
        if cache and len(payload.encode('utf-8')) <= 128 * 1024:
            try:
                cache.execute('DELETE FROM lyrics WHERE expires<?', (time.time(),))
                # Keep the shared, public-lyrics cache bounded across jobs.
                if cache.execute('SELECT COUNT(*) FROM lyrics').fetchone()[0] >= 512:
                    cache.execute('DELETE FROM lyrics WHERE key IN (SELECT key FROM lyrics ORDER BY expires LIMIT 64)')
                cache.execute('INSERT OR REPLACE INTO lyrics VALUES (?,?,?)',
                              (key, time.time() + (30 * 86400 if result else 86400), payload))
                cache.commit()
            except sqlite3.Error:
                pass
        return result
    finally:
        if cache:
            cache.close()


def metadata(audio):
    if isinstance(audio, MP4):
        keys = ('\xa9ART', '\xa9nam', '\xa9alb')
    elif isinstance(audio.tags, ID3):
        keys = ('TPE1', 'TIT2', 'TALB')
    else:
        keys = ('artist', 'title', 'album')
    def first(key):
        value = audio.tags.get(key, []) if audio.tags else []
        if hasattr(value, 'text'):
            value = value.text
        return str(value[0]).strip() if value else ''
    return tuple(first(key) for key in keys)


def tag_audio(audio, lyrics):
    if audio.tags is None:
        audio.add_tags()
    if isinstance(audio, MP3):
        audio.tags.delall('USLT')
        audio.tags.delall('SYLT')
        if lyrics['plain']:
            audio.tags.add(USLT(encoding=3, lang='und', desc='', text=lyrics['plain']))
        if lyrics['lines']:
            audio.tags.add(SYLT(encoding=3, lang='und', format=2, type=1, desc='', text=lyrics['lines']))
    elif isinstance(audio, MP4):
        audio['\xa9lyr'] = [lyrics['plain']]
    else:
        audio['LYRICS'] = [lyrics['plain']]
        if lyrics['lrc']:
            audio['SYNCEDLYRICS'] = [lyrics['lrc']]
        elif 'SYNCEDLYRICS' in audio:
            del audio['SYNCEDLYRICS']
    audio.save()


def enrich_downloads(directory, cache_path=''):
    root = Path(directory).resolve(strict=True)
    failures = 0
    used = sum(p.stat().st_size for p in root.rglob('*') if not p.is_symlink() and p.is_file())
    for folder, directories, files in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if not name.startswith('.qws-') and not Path(folder, name).is_symlink()]
        for name in files:
            path = Path(folder, name)
            if name.startswith('.qws-') or path.is_symlink() or path.suffix.lower() not in {'.flac', '.mp3', '.m4a', '.ogg', '.opus'}:
                continue
            temporary = None
            try:
                audio = mutagen.File(path)
                if not isinstance(audio, (FLAC, MP3, MP4, OggVorbis, OggOpus)):
                    continue
                artist, title, album = metadata(audio)
                duration = audio.info.length
                if not artist or not title or max(map(len, (artist, title, album))) > 500 or not math.isfinite(duration) or duration <= 0:
                    print('Текст пропущен: недостаточно метаданных.', flush=True)
                    continue
                if failures >= 3:
                    continue
                lyrics = lookup(artist, title, album, round(duration, 3), cache_path)
                failures = 0
                if not lyrics:
                    print('Текст не найден или версия записи не совпадает.', flush=True)
                    continue
                # Work on a sibling copy: failed tagging must leave the downloaded audio intact.
                size = path.stat().st_size
                reserve = int(os.environ.get('MIN_FREE_BYTES', 1024**3))
                if shutil.disk_usage(root).free < reserve + size + 2 * MAX_RESPONSE or used + size + 2 * MAX_RESPONSE > int(os.environ.get('MAX_JOB_BYTES', 10 * 1024**3)):
                    print('Текст пропущен: недостаточно места для безопасной записи.', flush=True)
                    continue
                with tempfile.NamedTemporaryFile(prefix='.qws-lyrics-', suffix=path.suffix, dir=path.parent, delete=False) as handle:
                    temporary = Path(handle.name)
                shutil.copyfile(path, temporary)
                tag_audio(mutagen.File(temporary), lyrics)
                used += temporary.stat().st_size - size
                os.replace(temporary, path)
                if lyrics['lrc']:
                    # Atomic replacement never follows a pre-existing sidecar symlink.
                    temporary.write_text(lyrics['lrc'] + '\n', encoding='utf-8')
                    sidecar = path.with_suffix('.lrc')
                    used += temporary.stat().st_size - (sidecar.stat().st_size if sidecar.is_file() and not sidecar.is_symlink() else 0)
                    os.replace(temporary, sidecar)
                print('Синхронизированный текст добавлен.' if lyrics['lrc'] else 'Добавлен обычный текст.', flush=True)
            except (requests.RequestException, ValueError, OSError, sqlite3.Error, mutagen.MutagenError, TypeError, KeyError, OverflowError):
                failures += 1
                if failures == 3:
                    print('Поиск текстов остановлен после трёх ошибок.', flush=True)
                print('Не удалось добавить текст; аудиофайл сохранён. Повторите загрузку позже.', flush=True)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
