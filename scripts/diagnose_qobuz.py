"""Check the application's Qobuz login; emit only allowlisted diagnostics."""
import contextlib
import json
import logging
import os
from pathlib import Path
import sys
from unittest.mock import patch
from urllib.parse import urlsplit


def diagnose():
    report = {'mode': 'oauth', 'sessionSaved': bool(os.environ.get('QOBUZ_USER_ID') and os.environ.get('QOBUZ_AUTH_TOKEN')),
              'requests': [], 'result': 'session_missing'}
    if not report['sessionSaved']:
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
                api = web_api_class(Qobuz)('', '', RuntimeError)
                api.login('', '')
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



if __name__ == '__main__':
    from worker_safety import install_network_safety
    install_network_safety()
    if len(sys.argv) != 1:
        print('{"error":"Unsupported diagnostic option. Use npm run diagnose:qobuz."}')
        raise SystemExit(2)
    result = diagnose()
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['result'] == 'ok' else 1)
