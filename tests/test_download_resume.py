"""Download protocol checks, including an actual interrupted HTTP stream."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import socket
import sys
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / '.runtime/orpheusdl'))
from qobuz_web import QobuzWebError
from worker_safety import install_download_safety
from utils import utils

URL = 'https://example.test/audio'


def response(status=200, body=(b'abcd',), **headers):
    result = MagicMock()
    result.__enter__.return_value = result
    result.status_code = status
    result.headers = requests.structures.CaseInsensitiveDict(headers)
    result.iter_content.side_effect = lambda **kwargs: iter(body)
    return result


def interrupted():
    yield b'ab'
    raise requests.exceptions.ChunkedEncodingError('fixture disconnect')


@contextmanager
def downloader(responses, maximum=1024**2):
    names = ('sanitise_name', 'fix_byte_limit', 'create_temp_filename', 'download_file')
    with tempfile.TemporaryDirectory() as directory, patch.dict(utils.__dict__, {key: getattr(utils, key) for key in names}), patch.dict(os.environ, {'MAX_JOB_BYTES': str(maximum), 'MIN_FREE_BYTES': '0'}), patch('worker_safety.time.sleep'), patch.object(utils.r_session, 'get', side_effect=responses) as get:
        root = Path(directory)
        install_download_safety(root)
        yield root, get
        assert list((root / '.qws-work').iterdir()) == [], 'Incomplete files leaked'


class DownloadResumeTest(unittest.TestCase):
    def test_resume_after_stream_disconnect(self):
        first = response(206, **{'Content-Range': 'bytes 0-3/4', 'Content-Length': '4', 'ETag': '"v1"'})
        first.iter_content.side_effect = lambda **kwargs: interrupted()
        second = response(206, (b'cd',), **{'Content-Range': 'bytes 2-3/4', 'ETag': '"v1"'})
        with downloader([first, second], maximum=4) as (root, get):
            utils.download_file(URL, root / 'song.flac', headers={'range': 'bytes=99-', 'accept-encoding': 'gzip', 'X-Fixture': 'preserved'})
            self.assertEqual((root / 'song.flac').read_bytes(), b'abcd')
            headers = get.call_args.kwargs['headers']
            self.assertEqual(headers['Range'], f'bytes=2-{2 + 8 * 1024**2 - 1}')
            self.assertEqual(headers['If-Range'], '"v1"')
            self.assertEqual(headers['Accept-Encoding'], 'identity')
            self.assertEqual(headers['X-Fixture'], 'preserved')
            self.assertTrue(first.__exit__.called)

    def test_sequential_chunks_and_last_modified_validator(self):
        headers = {'Last-Modified': 'Wed, 18 Nov 2026 00:00:00 GMT'}
        with downloader([response(206, (b'ab',), **headers, **{'Content-Range': 'bytes 0-1/4'}), response(206, (b'cd',), **headers, **{'Content-Range': 'bytes 2-3/4'})]) as (root, get):
            utils.download_file(URL, root / 'song.flac')
            self.assertEqual((root / 'song.flac').read_bytes(), b'abcd')
            self.assertEqual(get.call_args.kwargs['headers']['If-Range'], headers['Last-Modified'])

    def test_ignored_range_replaces_partial_instead_of_appending(self):
        first = response(200, **{'Content-Length': '4', 'ETag': '"v1"'})
        first.iter_content.side_effect = lambda **kwargs: interrupted()
        with downloader([first, response(200, (b'wxyz',), **{'Content-Length': '4'})], maximum=4) as (root, get):
            utils.download_file(URL, root / 'song.flac')
            self.assertEqual((root / 'song.flac').read_bytes(), b'wxyz')
            self.assertIn('Range', get.call_args.kwargs['headers'])

    def test_missing_or_weak_validator_falls_back_to_full_download(self):
        for etag in ('', 'W/"v1"'):
            with self.subTest(etag=etag), downloader([response(206, **{'ETag': etag, 'Content-Range': 'bytes 0-3/4'}), response()]) as (root, get):
                utils.download_file(URL, root / 'song.flac')
                self.assertEqual((root / 'song.flac').read_bytes(), b'abcd')
                self.assertNotIn('Range', get.call_args.kwargs['headers'])

    def test_invalid_ranges_never_publish_a_file(self):
        for headers in (
            {'Content-Range': 'bytes 1-3/4', 'ETag': '"v1"'},
            {'Content-Range': 'bytes 2-3/5', 'ETag': '"v1"'},
            {'Content-Range': 'bytes 2-3/4', 'ETag': '"v2"'},
            {'Content-Range': 'bytes 2-3/4', 'Content-Length': '3', 'ETag': '"v1"'},
            {'Content-Range': 'garbage', 'ETag': '"v1"'},
        ):
            with self.subTest(headers=headers):
                first = response(206, (b'ab',), **{'Content-Range': 'bytes 0-1/4', 'ETag': '"v1"'})
                with downloader([first, response(206, (b'cd',), **headers)]) as (root, _):
                    with self.assertRaises(QobuzWebError):
                        utils.download_file(URL, root / 'song.flac')
                    self.assertFalse((root / 'song.flac').exists())

    def test_retry_exhaustion_cleans_up_and_releases_budget(self):
        def fail(**kwargs):
            return interrupted()
        broken = response(200, **{'Content-Length': '4'})
        broken.iter_content.side_effect = fail
        with downloader([broken] * 5 + [response()], maximum=4) as (root, get):
            with self.assertRaisesRegex(QobuzWebError, 'исчерпаны'):
                utils.download_file(URL, root / 'failed.flac')
            self.assertEqual(get.call_count, 5)
            self.assertFalse((root / 'failed.flac').exists())
            utils.download_file(URL, root / 'ok.flac')
            self.assertEqual((root / 'ok.flac').read_bytes(), b'abcd')

    def test_silent_short_body_retries_and_encoded_body_is_rejected(self):
        with downloader([response(200, (b'ab',), **{'Content-Length': '4'}), response()]) as (root, get):
            utils.download_file(URL, root / 'song.flac')
            self.assertEqual((root / 'song.flac').read_bytes(), b'abcd')
            self.assertEqual(get.call_count, 2)
        with downloader([response(200, **{'Content-Encoding': 'gzip'})]) as (root, _):
            with self.assertRaises(QobuzWebError):
                utils.download_file(URL, root / 'song.flac')
            self.assertFalse((root / 'song.flac').exists())

    def test_limits_and_cancellation_leave_no_partial_media(self):
        for failure in (KeyboardInterrupt(), requests.HTTPError('fixture 416')):
            broken = response()
            broken.raise_for_status.side_effect = failure
            with self.subTest(failure=type(failure).__name__), downloader([broken]) as (root, _):
                with self.assertRaises(type(failure)):
                    utils.download_file(URL, root / 'song.flac')
                self.assertFalse((root / 'song.flac').exists())
        with downloader([response(200, (b'ab',), **{'Content-Length': '2'}), response(200, **{'Content-Length': '3'})], maximum=4) as (root, _):
            utils.download_file(URL, root / 'first.flac')
            with self.assertRaisesRegex(QobuzWebError, 'Лимит'):
                utils.download_file(URL, root / 'second.flac')
            self.assertEqual((root / 'first.flac').read_bytes(), b'ab')
            self.assertFalse((root / 'second.flac').exists())
        with downloader([response()]) as (root, _), patch('worker_safety.shutil.disk_usage') as usage:
            usage.return_value.free = 0
            with self.assertRaisesRegex(QobuzWebError, 'Лимит'):
                utils.download_file(URL, root / 'song.flac')
            self.assertFalse((root / 'song.flac').exists())

    def test_real_connection_break_resumes_and_large_file_uses_ranges(self):
        payload = bytes(range(256)) * (33 * 1024)  # Over 8 MiB: multiple bounded requests.
        observed = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                value = self.headers['Range']
                observed.append((value, self.headers.get('If-Range')))
                start, end = map(int, value.removeprefix('bytes=').split('-'))
                end = min(end, len(payload) - 1)
                self.send_response(206)
                self.send_header('Content-Range', f'bytes {start}-{end}/{len(payload)}')
                self.send_header('Content-Length', str(end - start + 1))
                self.send_header('ETag', '"fixture"')
                self.end_headers()
                if len(observed) == 1:
                    self.wfile.write(payload[:100000])
                    self.wfile.flush()
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                else:
                    self.wfile.write(payload[start:end + 1])

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        session = requests.Session()
        try:
            def local_transport(url, **kwargs):
                return session.get(f'http://127.0.0.1:{server.server_port}/audio', **kwargs)
            with downloader(local_transport, maximum=len(payload)) as (root, _):
                utils.download_file(URL, root / 'song.flac')
                self.assertEqual((root / 'song.flac').read_bytes(), payload)
            self.assertEqual(len(observed), 3)
            self.assertEqual(observed[1][0], f'bytes=65536-{65536 + 8 * 1024**2 - 1}')
            self.assertEqual(observed[1][1], '"fixture"')
        finally:
            session.close()
            server.shutdown()
            server.server_close()
            thread.join()
