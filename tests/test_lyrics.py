import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import zipfile

import mutagen
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import lyrics
from archive import create_archive


def record(**changes):
    return dict(artistName='Исполнитель', trackName='Песня', albumName='Альбом',
                duration=4, instrumental=False, plainLyrics='Первая\nВторая',
                syncedLyrics='[00:00.50]Первая\n[00:02.25]Вторая', **changes)


def response(payload=None, status=200):
    result = MagicMock()
    result.__enter__.return_value = result
    result.status_code = status
    result.iter_content.return_value = [json.dumps(payload or record()).encode()]
    return result


class LyricsTest(unittest.TestCase):
    def setUp(self):
        lyrics.lookup.cache_clear()

    def test_exact_matching_rejects_other_versions_and_invalid_types(self):
        source = record()
        self.assertTrue(lyrics.select_lyrics(source, 'ИСПОЛНИТЕЛЬ', 'Песня', 'Альбом', 4))
        for changed in [{'trackName': 'Песня (Live)'}, {'artistName': 'Другой'},
                        {'albumName': 'Live'}, {'duration': 7}, {'duration': True},
                        {'duration': float('nan')}, {'instrumental': True}]:
            self.assertIsNone(lyrics.select_lyrics(source | changed, 'Исполнитель', 'Песня', 'Альбом', 4))
        invalid = source | {'syncedLyrics': '[00:59.00]Не та версия'}
        result = lyrics.select_lyrics(invalid, 'Исполнитель', 'Песня', 'Альбом', 4)
        self.assertEqual(result['plain'], source['plainLyrics'])
        self.assertFalse(result['lines'])

    def test_lrc_repeated_stamps_offset_unicode_and_invalid_times(self):
        self.assertEqual(lyrics.parse_lrc('[offset:+100]\n[00:00.50][00:02.250]Привет 🌍', 4),
                         [('Привет 🌍', 600), ('Привет 🌍', 2350)])
        for text in ['[00:60.00]bad', '[00:10.00]wrong version', '[offset:-1000]\n[00:00.1]bad', '[ar:Artist]']:
            self.assertFalse(lyrics.parse_lrc(text, 4))
        result = lyrics.select_lyrics(record() | {'plainLyrics': None}, 'Исполнитель', 'Песня', 'Альбом', 4)
        self.assertEqual(result['plain'], 'Первая\nВторая')

    def test_network_bounds_fixed_endpoint_cache_and_no_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = str(Path(directory, 'cache.sqlite3'))
            with patch('lyrics.requests.get', return_value=response()) as get:
                first = lyrics.lookup('Исполнитель', 'Песня', 'Альбом', 4, cache)
                lyrics.lookup.cache_clear()
                second = lyrics.lookup('Исполнитель', 'Песня', 'Альбом', 4, cache)
                self.assertEqual(first['lrc'], second['lrc'])
                get.assert_called_once()
                args, kwargs = get.call_args
                self.assertEqual(args, ('https://lrclib.net/api/get',))
                self.assertEqual(kwargs['params']['duration'], 4)
                self.assertFalse(kwargs['allow_redirects'])
                self.assertEqual(kwargs['timeout'], (3, 5))
                self.assertNotIn('Authorization', kwargs['headers'])
            lyrics.lookup.cache_clear()
            with patch('lyrics.requests.get', return_value=response(status=404)) as get:
                self.assertIsNone(lyrics.lookup('Missing', 'Song', '', 4, cache))
                lyrics.lookup.cache_clear()
                self.assertIsNone(lyrics.lookup('Missing', 'Song', '', 4, cache))
                get.assert_called_once()
            with patch('lyrics.requests.get', side_effect=requests.Timeout) as get:
                for _ in range(2):
                    with self.assertRaises(requests.Timeout):
                        lyrics.lookup('Offline', 'Song', '', 4, cache)
                self.assertEqual(get.call_count, 2)
        for bad in [response(status=302), response()]:
            bad.iter_content.return_value = [b'x' * (lyrics.MAX_RESPONSE + 1)]
            with patch('lyrics.requests.get', return_value=bad), self.assertRaises(ValueError):
                lyrics.lookup('Artist', 'Song', '', 4)

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg is needed for real audio fixtures')
    def test_real_formats_tags_lrc_archive_and_failure_preserves_original(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'MIN_FREE_BYTES': '0'}):
            root = Path(directory)
            hashes = {}
            def audio_hash(path):
                return subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-'])
            for suffix, codec in [('flac', 'flac'), ('mp3', 'libmp3lame'), ('m4a', 'aac'),
                                  ('ogg', 'libvorbis'), ('opus', 'libopus')]:
                path = root / f'Песня.{suffix}'
                subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
                                '-c:a', codec, '-metadata', 'artist=Исполнитель', '-metadata', 'title=Песня',
                                '-metadata', 'album=Альбом', str(path)], check=True)
            # Consecutive network failures stop lookup attempts without failing the job.
            with patch('lyrics.requests.get', side_effect=requests.Timeout) as get:
                lyrics.enrich_downloads(root)
                self.assertEqual(get.call_count, 3)
            hashes = {p.name: audio_hash(p) for p in root.iterdir() if p.is_file()}
            original = (root / 'Песня.flac').read_bytes()
            with patch('lyrics.requests.get', return_value=response()), patch('lyrics.tag_audio', side_effect=OSError('disk full')):
                lyrics.enrich_downloads(root)
            self.assertEqual((root / 'Песня.flac').read_bytes(), original)
            self.assertFalse(list(root.glob('.qws-*')))
            with patch('lyrics.requests.get', return_value=response()):
                lyrics.enrich_downloads(root)
            for path in root.glob('*'):
                if path.suffix == '.lrc':
                    continue
                self.assertEqual(audio_hash(path), hashes[path.name], 'Audio samples changed during tagging')
                audio = mutagen.File(path)
                self.assertEqual(lyrics.metadata(audio), ('Исполнитель', 'Песня', 'Альбом'))
                if path.suffix == '.mp3':
                    self.assertEqual(audio.tags.getall('USLT')[0].text, 'Первая\nВторая')
                    sync = audio.tags.getall('SYLT')[0]
                    self.assertEqual(sync.format, 2)
                    self.assertEqual(sync.text, [('Первая', 500), ('Вторая', 2250)])
                elif path.suffix == '.m4a':
                    self.assertEqual(audio['\xa9lyr'], ['Первая\nВторая'])
                else:
                    self.assertEqual(audio['LYRICS'], ['Первая\nВторая'])
                    self.assertEqual(audio['SYNCEDLYRICS'], ['[00:00.500]Первая\n[00:02.250]Вторая'])
                lyrics.tag_audio(audio, {'plain': 'Обычный текст', 'lines': [], 'lrc': ''})
                plain = mutagen.File(path)
                if path.suffix == '.mp3':
                    self.assertFalse(plain.tags.getall('SYLT'))
                    self.assertEqual(plain.tags.getall('USLT')[0].text, 'Обычный текст')
                elif path.suffix == '.m4a':
                    self.assertEqual(plain['\xa9lyr'], ['Обычный текст'])
                else:
                    self.assertNotIn('SYNCEDLYRICS', plain)
                    self.assertEqual(plain['LYRICS'], ['Обычный текст'])
                lyrics.tag_audio(plain, lyrics.select_lyrics(record(), 'Исполнитель', 'Песня', 'Альбом', 4))
            self.assertIn('[00:02.250]Вторая', (root / 'Песня.lrc').read_text())
            with zipfile.ZipFile(create_archive(root)) as archive:
                self.assertIn('Песня.lrc', archive.namelist())
                self.assertEqual(len(archive.namelist()), 6)

    def test_symlinks_are_skipped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'linked.flac').symlink_to('/missing')
            (root / 'linked-dir').symlink_to(root, target_is_directory=True)
            with patch('lyrics.mutagen.File') as read:
                lyrics.enrich_downloads(root)
                read.assert_not_called()
