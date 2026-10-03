"""本机账号：SQLite 凭据、哈希会话、一次性 CSRF；不存储原始密码。"""
import hashlib
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from http.cookies import SimpleCookie
from pathlib import Path
from .core import AppError

SESSION_COOKIE = 'wenqi_account_session'
NONCE_COOKIE = 'wenqi_account_nonce'


def cookies(header):
    result = SimpleCookie()
    try:
        result.load(header or '')
    except Exception:
        return {}
    return {key: value.value for key, value in result.items()}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class AccountStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = threading.RLock()
        self.nonces = {}
        self.attempts = {}
        with self.connection() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
                    display_name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                    csrf TEXT NOT NULL, expires REAL NOT NULL
                );
            ''')
        os.chmod(self.path, 0o600)

    @contextmanager
    def connection(self):
        db=sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def password_hash(password, salt):
        return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

    def register(self, data):
        name, password, display = data.get('username'), data.get('password'), data.get('display_name')
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_.\-]{3,32}', name):
            raise AppError('账号须为3–32位字母、数字、下划线、点或短横线。')
        if not isinstance(password, str) or not 12 <= len(password) <= 128:
            raise AppError('密码须为12–128个字符。')
        if not isinstance(display, str) or not 1 <= len(display.strip()) <= 40:
            raise AppError('请填写不超过40字的显示名。')
        uid, salt = uuid.uuid4().hex, secrets.token_hex(16)
        hashed = self.password_hash(password, salt)
        try:
            with self.connection() as db:
                db.execute('INSERT INTO users VALUES (?,?,?,?,?)', (uid, name.lower(), display.strip(), salt, hashed))
        except sqlite3.IntegrityError:
            raise AppError('该账号已存在，请直接登录。', 409) from None
        return {'id': uid, 'username': name.lower(), 'display_name': display.strip(), 'revision': 1}

    def login(self, data, old_cookie=None):
        name, password = data.get('username'), data.get('password')
        if not isinstance(name, str) or not isinstance(password, str) or len(name)>32 or len(password)>128:
            raise AppError('账号或密码不正确。', 401)
        with self.connection() as db:
            row = db.execute('SELECT id, username, display_name, salt, password_hash FROM users WHERE username=?', (name.lower(),)).fetchone()
        salt = row[3] if row else '00' * 16
        candidate = self.password_hash(password, salt)
        if not row or not secrets.compare_digest(candidate, row[4]):
            raise AppError('账号或密码不正确。', 401)
        session, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with self.connection() as db:
            db.execute('DELETE FROM sessions WHERE expires<=?', (time.time(),))
            if old_cookie:
                db.execute('DELETE FROM sessions WHERE hash=?', (digest(old_cookie),))
            db.execute('INSERT INTO sessions VALUES (?,?,?,?)', (digest(session), row[0], csrf, time.time()+43200))
        return {'id': row[0], 'username': row[1], 'display_name': row[2], 'revision': 1}, session

    def session(self, cookie):
        if not cookie or len(cookie)>128:
            return None
        with self.connection() as db:
            row = db.execute('SELECT u.id,u.username,u.display_name,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?', (digest(cookie), time.time())).fetchone()
        return ({'id':row[0], 'username':row[1], 'display_name':row[2], 'revision':1}, row[3]) if row else None

    def csrf(self, header):
        value = cookies(header)
        session = self.session(value.get(SESSION_COOKIE))
        if session:
            return session[1], None
        nonce, token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with self.lock:
            self.nonces = {n:v for n,v in self.nonces.items() if v[1]>time.time()}
            if len(self.nonces)>=1000:
                raise AppError('请求过于频繁，请稍后重试。',429)
            self.nonces[digest(nonce)] = (token,time.time()+600)
        return token, nonce

    def verify_csrf(self, header, token):
        value = cookies(header)
        session = self.session(value.get(SESSION_COOKIE))
        if session:
            expected = session[1]
        else:
            with self.lock:
                item = self.nonces.pop(digest(value.get(NONCE_COOKIE,'')),None)
            expected = item[0] if item and item[1]>time.time() else ''
        if not expected or not token or not secrets.compare_digest(expected,token):
            raise AppError('安全会话已失效，请重试。',403)

    def throttle(self, name):
        key = name.lower()[:32] if isinstance(name,str) else ''
        now=time.time()
        with self.lock:
            self.attempts={k:v for k,v in self.attempts.items() if v[0]>now-900}
            start,count=self.attempts.get(key,(now,0))
            if count>=20 or sum(v[1] for v in self.attempts.values())>=200:
                raise AppError('账号尝试过于频繁，请稍后重试。',429)
            self.attempts[key]=(start,count+1)

    def logout(self, header):
        cookie = cookies(header).get(SESSION_COOKIE)
        if cookie:
            with self.connection() as db:
                db.execute('DELETE FROM sessions WHERE hash=?',(digest(cookie),))
