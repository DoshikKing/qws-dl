import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / '.runtime/orpheusdl'))
from worker_safety import install_network_safety, install_download_safety
from qobuz_web import QobuzWebError
from utils import utils


class WorkerSafetyTest(unittest.TestCase):
    def test_upstream_cannot_disable_tls_or_remove_timeout(self):
        observed = {}
        def transport(session, method, url, **kwargs):
            observed.update(kwargs)
            return requests.Response()
        with patch.object(requests.sessions.Session, 'request', transport), patch.dict(os.environ, {'REQUESTS_CA_BUNDLE': '/fixture/trusted-ca.pem'}):
            install_network_safety()
            requests.Session().get('https://example.test', verify=False, timeout=None)
        self.assertEqual(observed['verify'], '/fixture/trusted-ca.pem')
        self.assertEqual(observed['timeout'], 30)

    def test_paths_streaming_limits_http_errors_and_temporary_files(self):
        names = ['sanitise_name', 'fix_byte_limit', 'create_temp_filename', 'download_file']
        with tempfile.TemporaryDirectory() as directory, patch.dict(utils.__dict__, {name: getattr(utils, name) for name in names}), patch.dict(os.environ, {'MAX_JOB_BYTES': '4', 'MIN_FREE_BYTES': '0'}):
            root = Path(directory)
            install_download_safety(root)
            self.assertEqual(utils.sanitise_name('..'), '_')
            self.assertEqual(utils.sanitise_name('.'), '_')
            self.assertEqual(utils.sanitise_name('.qws-work'), '_.qws-work')
            self.assertEqual(utils.sanitise_name('Песня'), 'Песня')
            with self.assertRaises(QobuzWebError):
                utils.fix_byte_limit(root / '../escaped')
            (root / 'outside').symlink_to(root.parent, target_is_directory=True)
            with self.assertRaises(QobuzWebError):
                utils.fix_byte_limit(root / 'outside/song.flac')
            self.assertTrue(Path(utils.create_temp_filename()).is_relative_to(root / '.qws-work'))
            with self.assertRaisesRegex(QobuzWebError, 'HTTPS'):
                utils.download_file('http://example.test/audio', root / 'unsafe.flac')
            response = MagicMock()
            response.__enter__.return_value = response
            response.iter_content.return_value = [b'ab', b'cde']
            with patch.object(utils.r_session, 'get', return_value=response):
                with self.assertRaisesRegex(QobuzWebError, 'Лимит'):
                    utils.download_file('https://example.test/audio', root / 'song.flac')
                self.assertEqual((root / 'song.flac').read_bytes(), b'ab')
                response.raise_for_status.side_effect = requests.HTTPError('fixture HTTP failure')
                with self.assertRaises(requests.HTTPError):
                    utils.download_file('https://example.test/audio', root / 'failed.flac')
                self.assertFalse((root / 'failed.flac').exists())
