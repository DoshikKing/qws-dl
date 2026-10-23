"""Use qobuz-dl's web authentication with OrpheusDL's existing Qobuz module.

No upstream files are modified. Credentials and discovered client parameters stay
inside the Python worker. qobuz-dl is installed as a pinned dependency.
"""
import hashlib
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
    """Keep qobuz-dl signing but use the web player's form-login transport."""
    def __init__(self, identifier, credential, app_id, secrets, token_mode=False):
        self.token_mode = token_mode
        super().__init__(identifier, credential, app_id, secrets)

    def api_call(self, epoint, **kwargs):
        if epoint != 'user/login':
            return super().api_call(epoint, **kwargs)
        params = {'app_id': self.id}
        if self.token_mode:
            params.update(user_id=kwargs['email'], user_auth_token=kwargs['pwd'])
            self.session.headers['X-User-Auth-Token'] = kwargs['pwd']
        else:
            params.update(email=kwargs['email'], password=kwargs['pwd'])
        response = self.session.post(self.base + epoint, data=params, timeout=30)
        if response.status_code == 401:
            raise AuthenticationError('Qobuz rejected authentication')
        if response.status_code == 400:
            raise InvalidAppIdError('Qobuz rejected application parameters')
        response.raise_for_status()
        return response.json()


def web_api_class(legacy_api):
    class WebAPI(legacy_api):
        def __init__(self, app_id, app_secret, exception):
            super().__init__('', '', exception)
            self._client = None

        def _connect(self, username=None, password=None):
            if self._client is not None:
                return self._client
            token_mode = os.environ.get('QOBUZ_AUTH_MODE') == 'token'
            username = os.environ.get('QOBUZ_USER_ID') if token_mode else username or os.environ.get('QOBUZ_USERNAME')
            password = os.environ.get('QOBUZ_AUTH_TOKEN') if token_mode else password or os.environ.get('QOBUZ_PASSWORD')
            if not username or not password:
                raise QobuzWebError('Заполните QOBUZ_USER_ID и QOBUZ_AUTH_TOKEN в .env.' if token_mode
                                    else 'Заполните QOBUZ_USERNAME и QOBUZ_PASSWORD в .env.')
            try:
                print('Qobuz: получаем параметры веб-клиента и выполняем вход.', flush=True)
                bundle = Bundle()
                client = WebClient(
                    username, password if token_mode else hashlib.md5(password.encode('utf-8')).hexdigest(),
                    bundle.get_app_id(), list(bundle.get_secrets().values()),
                    token_mode=token_mode,
                )
            except AuthenticationError:
                raise QobuzWebError(
                    'Qobuz отклонил запрос авторизации (401). Это не доказывает ошибку пароля. '
                    + ('Браузерная сессия могла истечь: войдите снова через Настройки → Qobuz. '
                       'В явном режиме token обновите QOBUZ_AUTH_TOKEN и QOBUZ_USER_ID.'
                       if token_mode else 'Прямой парольный вход user/login больше не поддерживается '
                       'текущим веб-клиентом Qobuz. Откройте Настройки → Qobuz → Войти в Qobuz '
                       'и введите email и пароль на сайте сервиса.')
                ) from None
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
            return self._connect(email, password).uat

        def headers(self):
            return {'X-App-Id': self.app_id, 'X-User-Auth-Token': self.auth_token}

        def _get(self, url, params=None):
            # Core may reuse a saved mobile token and skip login. Establish our
            # web session lazily anyway; never send the old token to the API.
            self._connect()
            params = {**(params or {}), 'app_id': self.app_id}
            return super()._get(url, params)

        def get_file_url(self, track_id, quality_id=27):
            return self._connect().get_track_url(track_id, quality_id)

    return WebAPI


def install_web_api():
    from modules.qobuz import interface
    interface.Qobuz = web_api_class(interface.Qobuz)
