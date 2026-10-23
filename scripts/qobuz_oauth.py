"""Qobuz browser authorization bridge. Input/output are private worker pipes."""
import contextlib
import json
import logging
import os
import re
import sys

import requests
from qobuz_dl.bundle import Bundle
from qobuz_web import WebClient
from qobuz_dl.exceptions import AuthenticationError


def prepare():
    bundle = Bundle()
    match = re.search(r'privateKey:\s*"([A-Za-z0-9]{6,30})"', bundle._bundle)
    if not match:
        raise ValueError('Player format changed')
    return {'appId': bundle.get_app_id(), 'privateKey': match[1],
            'secrets': list(bundle.get_secrets().values())}


def refresh(saved):
    bundle = Bundle()
    client = WebClient(saved['userId'], saved['authToken'], bundle.get_app_id(), list(bundle.get_secrets().values()))
    return {'userId': saved['userId'], 'authToken': client.uat}


def exchange(context, code):
    if not isinstance(code, str) or not 1 <= len(code) <= 8192 or any(ord(c) < 32 for c in code):
        raise ValueError('Invalid authorization code')
    # Qobuz's current player exchanges its one-time code at this endpoint.
    session = requests.Session()
    session.headers['X-App-Id'] = context['appId']
    response = session.get('https://www.qobuz.com/api.json/0.2/oauth/callback', params={
        'app_id': context['appId'], 'private_key': context['privateKey'], 'code': code,
    }, timeout=30)
    response.raise_for_status()
    token = response.json()['token']
    if not isinstance(token, str) or not 1 <= len(token) <= 16384:
        raise ValueError('Invalid session')
    session.headers['X-User-Auth-Token'] = token
    response = session.post('https://www.qobuz.com/api.json/0.2/user/login',
                            data={'extra': 'partner'}, timeout=30)
    response.raise_for_status()
    profile = response.json()
    user_id = str(profile['user']['id'])
    if not re.fullmatch(r'[0-9]{1,32}', user_id):
        raise ValueError('Invalid account')
    # Reuse the same profile/subscription/signing checks as actual downloads.
    client = WebClient(user_id, token, context['appId'], context['secrets'])
    return {'userId': user_id, 'authToken': client.uat}


if __name__ == '__main__':
    from worker_safety import install_network_safety
    install_network_safety()
    logging.disable(logging.CRITICAL)
    try:
        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            payload = json.load(sys.stdin)
            if payload['action'] == 'prepare':
                result = prepare()
            elif payload['action'] == 'exchange':
                result = exchange(payload['context'], payload['code'])
            elif payload['action'] == 'refresh':
                result = refresh(payload['session'])
            else:
                raise ValueError('Invalid action')
        print(json.dumps(result))
    except AuthenticationError:
        print('{"error":"session_expired"}')
        raise SystemExit(1)
    except Exception:
        # Never expose callback codes, tokens, request URLs, bodies or tracebacks.
        print('{"error":"qobuz_authorization_failed"}')
        raise SystemExit(1)
