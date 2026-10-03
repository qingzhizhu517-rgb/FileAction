"""OpenAI 兼容 Chat Completions 适配，不提供固定回复或静默替身。"""
import json
import os
import re
import threading
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from .core import AppError, text


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        # 配置错误时不把认证信息传递到重定向目标。
        return None


class ModelClient:
    def __init__(self, use_env=True, config_path=None):
        self.lock = threading.RLock()
        self.config = None
        self.persistent = False
        self.models = []
        self.cache_namespace = uuid.uuid4().hex
        if use_env and os.environ.get('FILEACTION_API_KEY'):
            self.configure(os.environ.get('FILEACTION_BASE_URL', 'https://api.openai.com/v1'),
                           os.environ['FILEACTION_API_KEY'], os.environ.get('FILEACTION_MODEL', ''),
                           os.environ.get('FILEACTION_JSON_MODE') == '1',
                           os.environ.get('FILEACTION_SET_CACHE_KEY') == '1')
        elif config_path and Path(config_path).exists():
            try:
                provider = json.loads(Path(config_path).read_text(encoding='utf-8'))
                options = provider['options']
                models = provider['models']
                if not isinstance(options, dict) or not isinstance(models, dict) or not models:
                    raise ValueError('provider')
                names = [text(name, '模型 ID', 200) for name in models]
                model = provider.get('default_model') or names[0]
                if model not in models:
                    raise ValueError('default')
                self.configure(options['baseURL'], options['apiKey'], model,
                               options.get('jsonMode', False), options.get('setCacheKey', False))
                self.models = names
                self.persistent = True
            except Exception:
                raise AppError('后台模型配置读取失败，请检查受控配置文件。未切换其他模型或生成替代结果。', 500) from None

    def configure(self, base_url, api_key, model, json_mode=False, set_cache_key=False):
        base_url = text(base_url, 'Base URL', 500).rstrip('/')
        u = urlsplit(base_url)
        local = u.hostname in ('localhost', '127.0.0.1', '::1')
        if (u.scheme != 'https' and not (u.scheme == 'http' and local)) or not u.hostname or u.username or u.password or u.query or u.fragment:
            raise AppError('接口须使用 HTTPS（本机 localhost 可用 HTTP），URL 不能包含账号、密码、查询或片段。')
        try:
            u.port
        except ValueError:
            raise AppError('接口端口不正确。') from None
        model = text(model, '模型名', 200)
        api_key = text(api_key, 'API Key', 2000)
        if any(c in api_key for c in '\r\n'):
            raise AppError('API Key 不能包含换行。')
        endpoint = base_url if base_url.endswith('/chat/completions') else base_url + '/chat/completions'
        with self.lock:
            self.config = {'endpoint': endpoint, 'base_url': base_url, 'api_key': api_key,
                           'model': model, 'json_mode': json_mode is True, 'set_cache_key': set_cache_key is True}
            self.persistent = False
        return self.status()

    def status(self):
        with self.lock:
            c = self.config
            return {'configured': bool(c), 'model': c['model'] if c else '',
                    'base_url': c['base_url'] if c else '', 'json_mode': c['json_mode'] if c else False,
                    'persistent': self.persistent, 'models': list(self.models),
                    'set_cache_key': c['set_cache_key'] if c else False}

    def complete(self, system, payload):
        with self.lock:
            if not self.config:
                raise AppError('模型未配置，请先在「模型设置」中填写接口、模型名和 API Key。', 503)
            c = dict(self.config)
        body = {'model': c['model'], 'messages': [{'role': 'system', 'content': system},
                {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)}], 'stream': False}
        if c['json_mode']:
            body['response_format'] = {'type': 'json_object'}
        if c['set_cache_key']:
            document = payload.get('document', {})
            session_id = document.get('id', 'connection') if isinstance(document, dict) else 'connection'
            body['prompt_cache_key'] = 'fileaction:' + self.cache_namespace + ':' + str(session_id)
        req = Request(c['endpoint'], data=json.dumps(body, ensure_ascii=False).encode(), method='POST',
                      headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c['api_key'],
                               'User-Agent': 'FileAction/0.1'})
        try:
            with build_opener(NoRedirect).open(req, timeout=90) as response:
                raw = response.read(1024 * 1024 + 1)
                if len(raw) > 1024 * 1024:
                    raise AppError('模型响应过大，请精简文件后重试。', 502)
                envelope = json.loads(raw)
            message = envelope['choices'][0]['message']['content']
            if not isinstance(message, str):
                raise ValueError('content')
            message = message.strip()
            # 仅兼容包裹JSON的代码围栏，不从任意段落猜测或拼造结果。
            match = re.fullmatch(r'```(?:json)?\s*\n?(.*?)\n?```', message, re.S)
            if match:
                message = match.group(1).strip()
            answer = json.loads(message)
            if not isinstance(answer, dict):
                raise ValueError('object')
            return answer
        except HTTPError as e:
            e.close()
            messages = {401: '密钥无效或没有访问权限', 403: '模型服务拒绝访问', 404: '接口路径或模型名不正确',
                        429: '模型服务限流或额度不足'}
            raise AppError(f'模型请求失败（HTTP {e.code}）：' + messages.get(e.code, '请检查服务与接口设置') + '。没有生成替代结果。', 502) from None
        except (TimeoutError, URLError, OSError):
            raise AppError('模型连接失败或超过90秒。请检查接口、网络或代理后重试。没有生成替代结果。', 502) from None
        except (ValueError, KeyError, IndexError, TypeError):
            raise AppError('模型没有返回有效 JSON 对象。请重试，或在设置中启用服务支持的 JSON 模式。', 502) from None
