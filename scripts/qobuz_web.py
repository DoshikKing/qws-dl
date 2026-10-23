"""Use qobuz-dl's web authentication with OrpheusDL's existing Qobuz module.

No upstream files are modified. Credentials and discovered client parameters stay
inside the Python worker. qobuz-dl is installed as a pinned dependency.
"""
import os

from qobuz_dl.bundle import Bundle
from qobuz_dl.qopy import Client
from qobuz_dl.exceptions import (
    AuthenticationError, IneligibleError, InvalidAppIdError, InvalidAppSecretError,
)
from requests import RequestException


class QobuzWebError(Exception):
    """An actionable error that contains no credentials or API response body."""


class WebClient(Client):
    """Keep qobuz-dl signing and refresh the authenticated browser session."""
    def api_call(self, epoint, **kwargs):
        if epoint != 'user/login':
            return super().api_call(epoint, **kwargs)
        self.session.headers['X-User-Auth-Token'] = kwargs['pwd']
        params = {'extra': 'partner'}
        response = self.session.post(self.base + epoint, data=params, timeout=30)
        if response.status_code == 401:
            raise AuthenticationError('Qobuz rejected authentication')
        if response.status_code == 400:
            raise InvalidAppIdError('Qobuz rejected application parameters')
        response.raise_for_status()
        profile = response.json()
        if str(profile['user']['id']) != str(kwargs['email']):
            raise AuthenticationError('Session account mismatch')
        return profile


def web_api_class(legacy_api):
    class WebAPI(legacy_api):
        def __init__(self, app_id, app_secret, exception):
            super().__init__('', '', exception)
            self._client = None

        def _connect(self):
            if self._client is not None:
                return self._client
            # Private worker environment populated from the saved OAuth session by Node.
            user_id = os.environ.get('QOBUZ_USER_ID')
            token = os.environ.get('QOBUZ_AUTH_TOKEN')
            if not user_id or not token:
                raise QobuzWebError('Войдите в Qobuz через Настройки → Qobuz.')
            try:
                print('Qobuz: получаем параметры веб-клиента и выполняем вход.', flush=True)
                bundle = Bundle()
                client = WebClient(
                    user_id, token,
                    bundle.get_app_id(), list(bundle.get_secrets().values()),
                )
            except AuthenticationError:
                raise QobuzWebError('Сессия Qobuz истекла или отозвана (401). Войдите снова через Настройки → Qobuz.') from None
            except IneligibleError:
                raise QobuzWebError('У аккаунта Qobuz нет подписки с доступом к загрузкам.') from None
            except (InvalidAppIdError, InvalidAppSecretError):
                raise QobuzWebError(
                    'Qobuz отклонил параметры веб-клиента. Обновите приложение; '
                    'ручные мобильные app_id/app_secret для веб-входа не нужны.'
                ) from None
            except RequestException:
                raise QobuzWebError(
                    'Не удалось выполнить веб-вход Qobuz. Проверьте доступ сервера '
                    'к play.qobuz.com и www.qobuz.com, прокси и доверенные сертификаты.'
                ) from None
            except (NotImplementedError, IndexError, KeyError, ValueError):
                raise QobuzWebError(
                    'Не удалось разобрать параметры веб-плеера Qobuz. '
                    'Формат сайта мог измениться; требуется обновление интеграции.'
                ) from None
            self._client = client
            self.app_id, self.app_secret = client.id, client.sec
            self.auth_token = client.uat
            self.s = client.session
            return client

        def login(self, email, password):
            return self._connect().uat

        def headers(self):
            return {'X-App-Id': self.app_id, 'X-User-Auth-Token': self.auth_token}

        def _get(self, url, params=None):
            # Core can skip login when it has a saved token. Establish the
            # current OAuth session lazily instead of reusing that saved token.
            self._connect()
            params = {**(params or {}), 'app_id': self.app_id}
            return super()._get(url, params)

        def get_file_url(self, track_id, quality_id=27):
            return self._connect().get_track_url(track_id, quality_id)

        def _paged(self, endpoint, params, collection):
            result = self._get(endpoint, {**params, 'limit': 500, 'offset': 0})
            page = result[collection]
            total = page['total']
            if not isinstance(total, int) or not 0 <= total <= 10000:
                raise QobuzWebError('Коллекция слишком большая или Qobuz вернул некорректный размер.')
            items = list(page['items'])
            identifiers = {str(item['id']) for item in items}
            while len(items) < total:
                following = self._get(endpoint, {**params, 'limit': 500, 'offset': len(items)})[collection]
                batch = following['items']
                if following['total'] != total or not batch or any(str(item['id']) in identifiers for item in batch):
                    raise QobuzWebError('Коллекция изменилась или получена не полностью. Повторите загрузку.')
                items.extend(batch)
                identifiers.update(str(item['id']) for item in batch)
            if len(items) != total or len(identifiers) != total:
                raise QobuzWebError('Коллекция получена не полностью. Повторите загрузку.')
            result[collection] = {**page, 'items': items}
            return result

        def get_playlist(self, playlist_id):
            return self._paged('playlist/get', {'playlist_id': playlist_id, 'extra': 'tracks,subscribers,focusAll'}, 'tracks')

        def get_artist(self, artist_id):
            return self._paged('artist/get', {'artist_id': artist_id, 'extra': 'albums,playlists,tracks_appears_on,albums_with_last_release,focusAll'}, 'albums')

    return WebAPI


def install_web_api():
    from modules.qobuz import interface
    interface.Qobuz = web_api_class(interface.Qobuz)
