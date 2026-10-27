import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.runtime/orpheusdl'))
from search_qobuz import catalog_results, search_catalog


class SearchTest(unittest.TestCase):
    def test_only_catalog_metadata_and_canonical_track_urls_leave_the_worker(self):
        result = catalog_results({'user_auth_token': 'secret', 'tracks': {'total': 2, 'items': [
            {'id': 123, 'title': 'Песня', 'version': 'Live', 'album': {'title': 'Альбом', 'artist': {'name': 'Исполнитель'}}, 'duration': 181, 'streamable': True, 'url': 'https://evil.test', 'user_auth_token': 'secret'},
            {'id': 456, 'title': 'Недоступно', 'streamable': False},
            {'id': 'https://evil.test', 'title': 'Invalid ID'},
        ]}}, 0)
        self.assertEqual(result['tracks'][0], {'id': '123', 'url': 'https://open.qobuz.com/track/123', 'title': 'Песня (Live)', 'artist': 'Исполнитель', 'album': 'Альбом', 'duration': 181, 'streamable': True, 'cover': None})
        self.assertFalse(result['tracks'][1]['streamable'])
        self.assertEqual(len(result['tracks']), 2)
        self.assertFalse(result['hasMore'])
        self.assertNotIn('secret', str(result))
        self.assertEqual(catalog_results({'tracks': {'items': [], 'total': 0}}, 0)['tracks'], [])

    def test_albums_artists_and_public_artwork(self):
        cover = 'https://static.qobuz.com/images/covers/album_230.jpg'
        albums = catalog_results({'albums': {'total': 41, 'items': [
            {'id': 'abc123', 'title': 'Альбом', 'artist': {'name': 'Исполнитель'},
             'image': {'small': cover + '?private=secret#fragment'}, 'tracks_count': 0,
             'release_date_original': '2026-10-27', 'streamable': True},
            {'id': '../invalid', 'title': 'Unsafe'},
        ]}}, 20, 'albums')
        self.assertEqual(albums['albums'][0], {'id': 'abc123', 'url': 'https://open.qobuz.com/album/abc123',
                         'title': 'Альбом', 'artist': 'Исполнитель', 'cover': cover,
                         'trackCount': 0, 'year': '2026', 'streamable': True})
        self.assertTrue(albums['hasMore'])
        artists = catalog_results({'artists': {'items': [
            {'id': 42, 'name': 'Артист', 'image': {'large': cover}, 'albums_count': 12},
            {'id': 43, 'name': 'Без фото', 'image': {'small': 'https://evil.test/image.jpg'}},
        ]}}, 0, 'artists')['artists']
        self.assertEqual(artists[0], {'id': '42', 'url': 'https://open.qobuz.com/artist/42',
                         'title': 'Артист', 'cover': cover, 'albumCount': 12, 'streamable': True})
        self.assertIsNone(artists[1]['cover'])
        self.assertIsNone(artists[1]['albumCount'])
        from search_qobuz import image_url
        for value in ['http://static.qobuz.com/a.jpg', 'https://static.qobuz.com.evil.test/a.jpg',
                      'https://secret@static.qobuz.com/a.jpg', 'https://static.qobuz.com:444/a.jpg',
                      'data:image/svg+xml,bad', 'https://[broken', 'https://static.qobuz.com/\\evil',
                      'https://static.qobuz.com/a\nb.jpg']:
            self.assertIsNone(image_url({'small': value}))
        self.assertEqual(image_url({'small': 'invalid', 'large': cover}), cover)
        self.assertEqual(image_url(cover), cover)
        self.assertEqual(len(catalog_results({'artists': {'items': [{'id': n} for n in range(30)]}}, 0, 'artists')['artists']), 20)


    def test_search_uses_oauth_adapter_without_orpheus_settings(self):
        api = Mock()
        api.app_id = 'fixture-app'
        api._get.return_value = {'tracks': {'items': [], 'total': 0}}
        with patch('search_qobuz.web_api_class') as adapter:
            adapter.return_value.return_value = api
            self.assertEqual(search_catalog('  запрос  ', 0)['tracks'], [])
            api.login.assert_not_called()
            api._get.assert_called_once_with('catalog/search', {'query':'запрос', 'type':'tracks', 'limit':20, 'offset':0, 'app_id':'fixture-app'})
        for kind in ('albums', 'artists'):
            api._get.return_value = {kind: {'items': [], 'total': 0}}
            with patch('search_qobuz.web_api_class') as adapter:
                adapter.return_value.return_value = api
                self.assertEqual(search_catalog('query', 20, kind)[kind], [])
                self.assertEqual(api._get.call_args[0][1]['type'], kind)
        with self.assertRaises(ValueError):
            search_catalog('query', 0, 'playlists')
        for query, offset in [('', 0), ('x'*201, 0), ('q', -1), ('q', 1), ('q', 1000)]:
            with self.assertRaises(ValueError):
                search_catalog(query, offset)


if __name__ == '__main__':
    unittest.main()
