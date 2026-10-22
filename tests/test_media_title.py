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


if __name__ == '__main__':
    unittest.main()
