import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from media_title import install_title_reporter


class MediaTitleTest(unittest.TestCase):
    def test_metadata_reuses_requested_media_and_preserves_method_arguments_and_result(self):
        cases = [
            ('track', dict(name='Трек (версия)', artists=['Артист', 'Гость']), 'Артист, Гость - Трек (версия)'),
            ('album', dict(name='Альбом', artist='Артист'), 'Артист - Альбом'),
            ('playlist', dict(name='Плейлист', creator='Автор'), 'Автор - Плейлист'),
            ('artist', dict(name='Артист'), 'Артист'),
            ('interpreter', dict(name='Артист'), 'Артист'),
        ]
        for kind, data, expected in cases:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, DOWNLOAD_DIR=directory):
                calls = []
                info = SimpleNamespace(**data)

                def get_info(self, media_id, *args, **kwargs):
                    calls.append((media_id, args, kwargs))
                    return info

                method = 'get_' + ('artist' if kind == 'interpreter' else kind) + '_info'
                module = type('ModuleInterface', (), {method: get_info})
                install_title_reporter(module, f'https://open.qobuz.com/{kind}/123')
                wrapped = getattr(module(), method)
                self.assertIs(wrapped(123, 'quality', data={'key': 'value'}), info)
                target = Path(directory, '.qws-metadata.json')
                self.assertEqual(json.loads(target.read_text(encoding='utf-8')), {'title': expected})
                info.name = 'Другой альбом'
                wrapped('456')
                self.assertEqual(json.loads(target.read_text(encoding='utf-8')), {'title': expected})
                self.assertEqual(calls[0], (123, ('quality',), {'data': {'key': 'value'}}))
                self.assertEqual(len(calls), 2)
                self.assertFalse(Path(directory, '.qws-metadata.json.tmp').exists())

class AlbumTracksTest(unittest.TestCase):
    def test_album_track_manifest_updates_without_extra_catalog_requests(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, DOWNLOAD_DIR=directory):
            data = {'11': {'title': 'Песня', 'version': 'Live', 'performer': {'name': 'Гость'}},
                    '22': {'title': 'Вторая песня'}}
            info = SimpleNamespace(name='Альбом', artist='Автор', tracks=['11', '22'], track_extra_kwargs={'data': data})
            class Module:
                def get_album_info(self, album_id):
                    return info
                def get_track_info(self, track_id, *args, **kwargs):
                    if track_id == '22':
                        raise RuntimeError('fixture failure')
                    return 'fixture track'
            observe = install_title_reporter(Module, 'https://open.qobuz.com/album/123')
            module = Module()
            self.assertIs(module.get_album_info('123'), info)
            target = Path(directory, '.qws-metadata.json')
            read = lambda: json.loads(target.read_text())['tracks']
            self.assertEqual([track['status'] for track in read()], ['pending', 'pending'])
            self.assertEqual(read()[0]['title'], 'Песня (Live)')
            self.assertEqual(read()[0]['artist'], 'Гость')
            self.assertEqual(module.get_track_info('11', 'quality', data=data), 'fixture track')
            self.assertEqual(read()[0]['status'], 'running')
            observe('    === Track 11 downloaded ===')
            self.assertEqual(read()[0]['status'], 'completed')
            observe('    === Track 999 failed ===')
            self.assertEqual(read()[0]['status'], 'completed')
            with self.assertRaises(RuntimeError):
                module.get_track_info('22')
            self.assertEqual(read()[1]['status'], 'failed')
            observe('=== Track 22 skipped ===')
            self.assertEqual(read()[1]['status'], 'skipped')
            self.assertFalse(target.with_suffix('.json.tmp').exists())

    def test_failures_belong_to_the_track_without_exposing_upstream_secrets(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, DOWNLOAD_DIR=directory):
            class Module:
                def get_album_info(self, album_id):
                    return SimpleNamespace(name='Альбом', artist='Автор', tracks=['11', '22'])
                def get_track_info(self, track_id):
                    return 'fixture'
            observe = install_title_reporter(Module, 'https://open.qobuz.com/album/123')
            module = Module()
            module.get_album_info('123')
            module.get_track_info('11')
            observe('Warning: Track download failed: Соединение прервано; попытки докачки исчерпаны.')
            observe('=== Track 11 failed ===')
            module.get_track_info('22')
            observe('Warning: Track download failed: https://cdn.example/audio?token=fixture-secret')
            observe('=== Track 22 failed ===')
            raw = Path(directory, '.qws-metadata.json').read_text()
            tracks = json.loads(raw)['tracks']
            self.assertEqual(tracks[0]['error'], 'Соединение прервано; попытки докачки исчерпаны.')
            self.assertEqual(tracks[1]['error'], 'Не удалось скачать аудиофайл.')
            self.assertNotIn('fixture-secret', raw)
            self.assertNotIn('https://', raw)


if __name__ == '__main__':
    unittest.main()
