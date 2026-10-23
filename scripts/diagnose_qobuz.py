"""Check the application's Qobuz login; emit only allowlisted diagnostics."""
import contextlib
import argparse
import json
import logging
import os
from pathlib import Path
import sys
from unittest.mock import patch
from urllib.parse import urlsplit


PASSWORD_VARIANTS = ('post_email_md5', 'get_email_md5', 'post_username_md5', 'post_email_plain')


def diagnose(password_variant=None):
    report = {'mode': 'invalid', 'configured': {}, 'requests': [], 'result': 'configuration_error'}
    mode = os.environ.get('QOBUZ_AUTH_MODE') or 'web'
    if mode not in {'web', 'token', 'mobile'}:
        return report
    report['mode'] = mode
    if password_variant is not None:
        if mode != 'web' or password_variant not in PASSWORD_VARIANTS:
            return report
        report['password_variant'] = password_variant
    required = (['QOBUZ_USER_ID', 'QOBUZ_AUTH_TOKEN'] if mode == 'token' else
                ['QOBUZ_USERNAME', 'QOBUZ_PASSWORD'])
    if mode == 'mobile':
        required += ['QOBUZ_APP_ID', 'QOBUZ_APP_SECRET']
    report['configured'] = {key: bool(os.environ.get(key)) for key in required}
    if not all(report['configured'].values()):
        return report

    previous_logging = logging.root.manager.disable
    # Never relay library output or exception text, even for unexpected failures.
    with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        logging.disable(logging.CRITICAL)
        try:
            import requests
            from qobuz_web import web_api_class
            root = Path(os.environ.get('ORPHEUS_DIR') or Path(__file__).resolve().parents[1] / '.runtime/orpheusdl')
            sys.path.insert(0, str(root))
            from modules.qobuz.qobuz_api import Qobuz
            original = requests.sessions.Session.request

            def observed(session, method, url, **kwargs):
                parsed = urlsplit(url)
                stage = 'other'
                if parsed.hostname == 'play.qobuz.com':
                    stage = 'player_bundle' if parsed.path.endswith('/bundle.js') else 'player_page'
                elif parsed.hostname == 'www.qobuz.com':
                    stage = {'/api.json/0.2/user/login': 'login',
                             '/api.json/0.2/track/getFileUrl': 'signing_check'}.get(parsed.path, 'other')
                if stage == 'login' and password_variant is not None:
                    params = dict(kwargs['data'])
                    if password_variant == 'get_email_md5':
                        method = 'GET'
                        del kwargs['data']
                        kwargs['params'] = params
                    elif password_variant == 'post_username_md5':
                        params['username'] = params.pop('email')
                        kwargs['data'] = params
                    elif password_variant == 'post_email_plain':
                        params['password'] = os.environ['QOBUZ_PASSWORD']
                        kwargs['data'] = params
                entry = {'stage': stage}
                report['requests'].append(entry)
                kwargs.setdefault('timeout', 30)
                try:
                    response = original(session, method, url, **kwargs)
                except requests.RequestException:
                    entry['network_error'] = True
                    raise
                entry['status'] = response.status_code
                return response

            with patch.object(requests.sessions.Session, 'request', observed):
                if mode == 'mobile':
                    api = Qobuz(os.environ['QOBUZ_APP_ID'], os.environ['QOBUZ_APP_SECRET'], RuntimeError)
                else:
                    api = web_api_class(Qobuz)('', '', RuntimeError)
                api.login(os.environ.get('QOBUZ_USERNAME', ''), os.environ.get('QOBUZ_PASSWORD', ''))
            report['result'] = 'ok'
        except ImportError:
            report['result'] = 'dependencies_missing'
        except Exception:
            report['result'] = 'authentication_or_client_error'
            if any(item.get('network_error') for item in report['requests']):
                report['result'] = 'network_error'
            elif any(item['stage'] == 'login' and item.get('status') == 401 for item in report['requests']):
                report['result'] = 'login_rejected_401'
        finally:
            logging.disable(previous_logging)
    return report


def compare_password_login():
    """Explicit diagnostic only: stop on success or any failure other than 401."""
    attempts = []
    for variant in PASSWORD_VARIANTS:
        report = diagnose(variant)
        attempts.append(report)
        if report['result'] != 'login_rejected_401':
            break
    return {'attempts': attempts, 'result': report['result'],
            'working_variant': variant if report['result'] == 'ok' else None}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compare-password-login', action='store_true',
                        help='Compare up to four login formats; web mode only. Stops on success or a non-401 failure.')
    args = parser.parse_args()
    result = compare_password_login() if args.compare_password_login else diagnose()
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['result'] == 'ok' else 1)
