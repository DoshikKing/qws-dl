import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.runtime/orpheusdl'))
from search_qobuz import track_results, search_tracks


class SearchTest(unittest.TestCase):
    def test_only_catalog_metadata_and_canonical_track_urls_leave_the_worker(self):
        result = track_results({'user_auth_token': 'secret', 'tracks': {'total': 2, 'items': [
            {'id': 123, 'title': 'Песня', 'version': 'Live', 'album': {'title': 'Альбом', 'artist': {'name': 'Исполнитель'}}, 'duration': 181, 'streamable': True, 'url': 'https://evil.test', 'user_auth_token': 'secret'},
            {'id': 456, 'title': 'Недоступно', 'streamable': False},
            {'id': 'https://evil.test', 'title': 'Invalid ID'},
        ]}}, 0)
        self.assertEqual(result['tracks'][0], {'id': '123', 'url': 'https://open.qobuz.com/track/123', 'title': 'Песня (Live)', 'artist': 'Исполнитель', 'album': 'Альбом', 'duration': 181, 'streamable': True})
        self.assertFalse(result['tracks'][1]['streamable'])
        self.assertEqual(len(result['tracks']), 2)
        self.assertFalse(result['hasMore'])
        self.assertNotIn('secret', str(result))
        self.assertEqual(track_results({'tracks': {'items': [], 'total': 0}}, 0)['tracks'], [])

    def test_mobile_search_authenticates_without_loading_or_writing_orpheus_settings(self):
        api = Mock()
        api.app_id = 'fixture-app'
        api._get.return_value = {'tracks': {'items': [], 'total': 0}}
        with patch.dict(os.environ, {'QOBUZ_AUTH_MODE':'mobile', 'QOBUZ_APP_ID':'fixture-app', 'QOBUZ_APP_SECRET':'fixture-secret', 'QOBUZ_USERNAME':'fixture', 'QOBUZ_PASSWORD':'fixture-password'}), patch('modules.qobuz.qobuz_api.Qobuz', return_value=api) as legacy:
            self.assertEqual(search_tracks('  запрос  ', 0)['tracks'], [])
            legacy.assert_called_once_with('fixture-app', 'fixture-secret', RuntimeError)
            api.login.assert_called_once_with('fixture', 'fixture-password')
            api._get.assert_called_once_with('catalog/search', {'query':'запрос', 'type':'tracks', 'limit':20, 'offset':0, 'app_id':'fixture-app'})
        for query, offset in [('', 0), ('x'*201, 0), ('q', -1), ('q', 1), ('q', 1000)]:
            with self.assertRaises(ValueError):
                search_tracks(query, offset)


if __name__ == '__main__':
    unittest.main()
