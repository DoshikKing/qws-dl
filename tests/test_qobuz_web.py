"""Run the real web-client libraries against a local HTTP-response fixture."""
import base64
from copy import deepcopy
import contextlib
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import sys
import runpy
import unittest
from unittest.mock import patch

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / '.runtime/orpheusdl'))
from qobuz_web import web_api_class, QobuzWebError
from modules.qobuz.qobuz_api import Qobuz
from search_qobuz import search_tracks
from diagnose_qobuz import diagnose
from qobuz_oauth import prepare, exchange, refresh


class WebLoginTest(unittest.TestCase):
    def test_refresh_worker_protocol_returns_rotation_or_safe_expiry(self):
        previous_logging = logging.root.manager.disable
        try:
            for mode in ['ok', '401']:
                self.mode = mode
                payload = json.dumps({'action': 'refresh', 'session': {'userId': '12345', 'authToken': 'fixture-browser-token'}})
                output = io.StringIO()
                with patch('sys.stdin', io.StringIO(payload)), contextlib.redirect_stdout(output):
                    if mode == '401':
                        with self.assertRaises(SystemExit) as exit_status:
                            runpy.run_path(str(ROOT / 'scripts/qobuz_oauth.py'), run_name='__main__')
                        self.assertEqual(exit_status.exception.code, 1)
                    else:
                        runpy.run_path(str(ROOT / 'scripts/qobuz_oauth.py'), run_name='__main__')
                report = json.loads(output.getvalue())
                if mode == '401':
                    self.assertEqual(report, {'error': 'session_expired'})
                else:
                    self.assertEqual(report, {'userId': '12345', 'authToken': 'fixture-web-token'})
        finally:
            logging.disable(previous_logging)

    def test_refresh_retains_the_rotated_token_and_checks_signing(self):
        result = refresh({'userId': '12345', 'authToken': 'fixture-browser-token'})
        self.assertEqual(result, {'userId': '12345', 'authToken': 'fixture-web-token'})
        self.assertEqual(self.login_calls, 1)

    def test_oauth_code_exchange_validates_profile_and_signing(self):
        context = prepare()
        self.assertEqual(context['privateKey'], 'fixtureOauthKey')
        profile_calls = 0

        def transport(session, method, url, **kwargs):
            nonlocal profile_calls
            if url.endswith('/oauth/callback'):
                self.assertEqual(session.headers['X-App-Id'], '123456789')
                self.assertEqual(kwargs['params'], {'code': 'fixture-code', 'private_key': 'fixtureOauthKey', 'app_id': '123456789'})
                self.assertEqual(kwargs['timeout'], 30)
                self.assertNotEqual(kwargs.get('verify'), False)
                return self.response(url, {'token': 'fixture-browser-token'})
            if url.endswith('/user/login') and kwargs.get('data') == {'extra': 'partner'}:
                profile_calls += 1
                if profile_calls == 1:
                    self.assertEqual(session.headers['X-User-Auth-Token'], 'fixture-browser-token')
                    return self.response(url, {'user': {'id': 12345}})
            return self.request(session, method, url, **kwargs)

        with patch.dict(os.environ, {'QOBUZ_AUTH_MODE': 'token'}), patch.object(requests.sessions.Session, 'request', transport):
            result = exchange(context, 'fixture-code')
        self.assertEqual(result, {'userId': '12345', 'authToken': 'fixture-web-token'})
        self.assertEqual(self.login_calls, 1)

    def test_oauth_missing_player_key_or_code_is_rejected(self):
        with patch('qobuz_oauth.Bundle') as bundle:
            bundle.return_value._bundle = 'changed player'
            with self.assertRaises(ValueError):
                prepare()
        for code in ['', 'x' * 8193, 'bad\ncode']:
            with self.assertRaises(ValueError):
                exchange({}, code)

    def test_diagnostic_report_never_exposes_library_output_or_secrets(self):
        for mode, expected in [('ok', 'ok'), ('401', 'login_rejected_401'), ('network', 'network_error')]:
            with self.subTest(mode=mode):
                self.mode = mode
                stdout, stderr = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    report = diagnose()
                self.assertEqual(report['result'], expected)
                self.assertEqual(stdout.getvalue() + stderr.getvalue(), '')
                encoded = json.dumps(report)
                for secret in ['fixture@example.test', 'fixture-password', 'fixture-web-token',
                               'fixture-valid-secret', 'private proxy details', hashlib.md5(b'fixture-password').hexdigest()]:
                    self.assertNotIn(secret, encoded)
                if mode == '401':
                    self.assertIn({'stage': 'login', 'status': 401}, report['requests'])

    def test_diagnostic_missing_credentials_does_not_send_requests(self):
        with patch.dict(os.environ, {'QOBUZ_AUTH_TOKEN': ''}):
            report = diagnose()
        self.assertEqual(report['result'], 'session_missing')
        self.assertFalse(report['sessionSaved'])
        self.assertEqual(report['requests'], [])

    def setUp(self):
        self.login_calls = 0
        self.mode = 'ok'
        self.env = patch.dict(os.environ, {
            'QOBUZ_USER_ID': '12345', 'QOBUZ_AUTH_TOKEN': 'fixture-browser-token',
            'QOBUZ_USERNAME': 'fixture@example.test', 'QOBUZ_PASSWORD': 'fixture-password',
            'QOBUZ_APP_ID': '', 'QOBUZ_APP_SECRET': '',
        })
        self.env.start()
        self.transport = patch.object(requests.sessions.Session, 'request', autospec=True, side_effect=self.request)
        self.transport.start()
        self.time = patch('qobuz_dl.qopy.time.time', return_value=1000)
        self.time.start()
        self.api = web_api_class(Qobuz)('', '', RuntimeError)

    def tearDown(self):
        self.time.stop()
        self.transport.stop()
        self.env.stop()

    def response(self, url, data, status=200):
        result = requests.Response()
        result.status_code = status
        result.url = url
        result.encoding = 'utf-8'
        result._content = (json.dumps(data) if isinstance(data, dict) else data).encode()
        return result

    def request(self, session, method, url, **kwargs):
        self.assertEqual(method.lower(), 'post' if url.endswith('/user/login') else 'get')
        self.assertNotEqual(kwargs.get('verify'), False)
        if self.mode == 'network':
            raise requests.exceptions.ProxyError('private proxy details')
        if url == 'https://play.qobuz.com/login':
            html = '<script src="/resources/1.2.3-a001/bundle.js"></script>' if self.mode != 'bundle' else '<html>changed</html>'
            return self.response(url, html)
        if url.endswith('/bundle.js'):
            chunks = ['production:{api:{appId:"123456789",appSecret:"' + 'a' * 32 + '"']
            for timezone, secret in [('london', 'fixture-valid-secret'), ('paris', 'fixture-invalid-secret')]:
                value = base64.b64encode(secret.encode()).decode() + 'A' * 44
                chunks += [f'a.initialSeed("{value[:4]}",window.utimezone.{timezone})',
                           f'name:"Europe/{timezone.capitalize()}",info:"{value[4:12]}",extras:"{value[12:]}"']
            return self.response(url, ';'.join(chunks) + ';privateKey:"fixtureOauthKey"')
        params = kwargs.get('data', {}) if url.endswith('/user/login') else kwargs.get('params', {})
        self.assertEqual(params.get('app_id', session.headers.get('X-App-Id')), '123456789')
        if url.endswith('/user/login'):
            self.login_calls += 1
            self.assertEqual(kwargs.get('timeout'), 30)
            self.assertNotIn('params', kwargs)
            self.assertEqual(params, {'extra': 'partner'})
            self.assertIn(session.headers.get('X-User-Auth-Token'), ['fixture-browser-token', 'fixture-web-token'])
            self.assertNotIn('request_sig', params)
            if self.mode == '401':
                return self.response(url, {'message': 'fixture-password'}, 401)
            parameters = {} if self.mode == 'subscription' else {'short_label': 'fixture'}
            return self.response(url, {'user_auth_token': 'fixture-web-token', 'user': {'id': 12345, 'credential': {'parameters': parameters}}})
        self.assertEqual(session.headers.get('X-User-Auth-Token'), 'fixture-web-token')
        if url.endswith('/track/getFileUrl'):
            signature = f"trackgetFileUrlformat_id{params['format_id']}intentstreamtrack_id{params['track_id']}1000fixture-valid-secret"
            if params['request_sig'] != hashlib.md5(signature.encode()).hexdigest():
                return self.response(url, {'message': 'invalid fixture secret'}, 400)
            return self.response(url, {'url': 'https://media.example.test/audio.flac', 'format_id': params['format_id']})
        if url.endswith('/catalog/search'):
            self.assertEqual(params['query'], 'Песня & исполнитель')
            self.assertEqual(params['type'], 'tracks')
            self.assertEqual(params['offset'], 20)
            self.assertEqual(params['limit'], 20)
            return self.response(url, {'tracks': {'total': 45, 'items': [{'id': 42, 'title': 'Песня', 'performer': {'name': 'Исполнитель'}, 'album': {'title': 'Альбом'}, 'duration': 181, 'streamable': True}]}})
        if url.endswith(('/album/get', '/track/get', '/playlist/get', '/artist/get')):
            return self.response(url, {'id': 'fixture-metadata', 'tracks': {'total': 0, 'items': []}, 'albums': {'total': 0, 'items': []}})
        self.fail('Unexpected outbound request: ' + url)

    def test_discovery_login_signature_metadata_and_cached_mobile_token(self):
        self.api.auth_token = 'old-mobile-token'
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            for fetch in [self.api.get_album, self.api.get_track, self.api.get_playlist, self.api.get_artist]:
                self.assertEqual(fetch('fixture')['id'], 'fixture-metadata')
            result = self.api.get_file_url('123', 27)
            self.assertEqual(result['url'], 'https://media.example.test/audio.flac')
            self.assertEqual(self.api.login('fixture@example.test', 'fixture-password'), 'fixture-web-token')
        self.assertEqual(self.login_calls, 1)
        for secret in ['fixture-password', 'fixture-web-token', 'fixture-valid-secret']:
            self.assertNotIn(secret, output.getvalue())

    def test_collection_pagination_rejects_missing_and_duplicate_pages(self):
        for method, collection in [('get_playlist', 'tracks'), ('get_artist', 'albums')]:
            pages = [
                {collection: {'total': 3, 'items': [{'id': 1}, {'id': 2}]}},
                {collection: {'total': 3, 'items': [{'id': 3}]}},
            ]
            with patch.object(self.api, '_get', side_effect=deepcopy(pages)) as fetch:
                result = getattr(self.api, method)('fixture')
                self.assertEqual(len(result[collection]['items']), 3)
                self.assertEqual(fetch.call_args_list[1].args[1]['offset'], 2)
            for remaining in [[], [{'id': 2}]]:
                with patch.object(self.api, '_get', side_effect=[pages[0], {collection: {'total': 3, 'items': remaining}}]):
                    with self.assertRaises(QobuzWebError):
                        getattr(self.api, method)('fixture')

    def test_search_uses_saved_session_and_pagination(self):
        result = search_tracks('Песня & исполнитель', 20)
        self.assertEqual(result['tracks'][0]['url'], 'https://open.qobuz.com/track/42')
        self.assertEqual(result['tracks'][0]['artist'], 'Исполнитель')
        self.assertTrue(result['tracks'][0]['streamable'])
        self.assertTrue(result['hasMore'])
        self.assertEqual(result['offset'], 20)
        self.assertEqual(self.login_calls, 1)

    def test_auth_failure_is_actionable_without_credentials(self):
        self.mode = '401'
        with self.assertRaises(QobuzWebError) as error:
            self.api.login('fixture@example.test', 'fixture-password')
        self.assertIn('401', str(error.exception))
        self.assertNotIn('fixture-password', str(error.exception))
        self.assertIn('Войдите снова', str(error.exception))

    def test_browser_session_login_sends_token_unchanged_without_password(self):
        with patch.dict(os.environ, {'QOBUZ_AUTH_MODE': 'token', 'QOBUZ_USER_ID': '12345',
                                    'QOBUZ_AUTH_TOKEN': 'fixture-browser-token', 'QOBUZ_USERNAME': '', 'QOBUZ_PASSWORD': ''}):
            self.assertEqual(self.api.get_album('fixture')['id'], 'fixture-metadata')
            self.assertEqual(self.login_calls, 1)

    def test_expired_browser_session_is_not_reported_as_invalid_password(self):
        self.mode = '401'
        with patch.dict(os.environ, {'QOBUZ_AUTH_MODE': 'token', 'QOBUZ_USER_ID': '12345',
                                    'QOBUZ_AUTH_TOKEN': 'fixture-browser-token'}):
            with self.assertRaises(QobuzWebError) as error:
                self.api.get_album('fixture')
            self.assertIn('Сессия Qobuz истекла или отозвана', str(error.exception))
            self.assertNotIn('fixture-browser-token', str(error.exception))

    def test_subscription_is_required(self):
        self.mode = 'subscription'
        with self.assertRaisesRegex(QobuzWebError, 'подписки'):
            self.api.get_album('fixture')

    def test_changed_bundle_and_network_failure_are_distinct(self):
        self.mode = 'bundle'
        with self.assertRaisesRegex(QobuzWebError, 'разобрать'):
            self.api.get_album('fixture')
        self.mode = 'network'
        with self.assertRaisesRegex(QobuzWebError, 'доступ сервера') as error:
            self.api.get_album('fixture')
        self.assertNotIn('private proxy', str(error.exception))


if __name__ == '__main__':
    unittest.main()
