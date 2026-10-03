"""Redis-only temporary resources, revision CAS and non-renewable hard expiry."""
from __future__ import annotations

import asyncio
import base64
import json
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from redis.asyncio import Redis
from redis.exceptions import RedisError

from fileaction.db.session import ActorContext


class TemporaryError(ValueError):
    pass


@dataclass(frozen=True)
class TemporaryResource:
    id: str
    kind: str
    revision: int
    value: dict[str, Any]


_OPERATE = """
local op = ARGV[1]
local nowparts = redis.call('TIME')
local now = tonumber(nowparts[1]) + tonumber(nowparts[2]) / 1000000
local idle = tonumber(ARGV[2])
local hard = tonumber(ARGV[3])
local session = KEYS[2]
if redis.call('GET', session) == 'revoked' then return {'err', 'SESSION_REVOKED'} end
local data = redis.call('HGETALL', KEYS[1])
local function extend(key, milliseconds)
  if redis.call('PTTL', key) < milliseconds then redis.call('PEXPIRE', key, milliseconds) end
end
-- Bound all sessions of an account in the same atomic operation. Reap expired
-- keys before accounting; expiration must release capacity without a worker.
if op == 'create' or op == 'replace' then
  -- A completed bounded snapshot is supplied only on first account admission.
  -- All pre-upgrade writers must be stopped before deploying this schema.
  if redis.call('EXISTS', KEYS[5]) == 0 then
    if ARGV[10] ~= 'complete' then return {'err', 'TEMPORARY_MIGRATION_REQUIRED'} end
    local imported = {}
    for i = 6, #KEYS do
      local raw = redis.call('HGET', KEYS[i], 'value')
      if raw then
        local ok, value = pcall(cjson.decode, raw)
        if not ok or type(value) ~= 'table' then return {'err', 'TEMPORARY_MIGRATION_REQUIRED'} end
        local original = 0
        local derived = string.len(raw)
        if string.find(KEYS[i], ':document:', 1, true) and value.source_base64 then
          local source = value.source_base64
          if type(source) ~= 'string' or string.len(source) % 4 ~= 0 then
            return {'err', 'TEMPORARY_MIGRATION_REQUIRED'}
          end
          local padding = string.match(source, '(=*)$')
          local payload = string.sub(source, 1, string.len(source) - string.len(padding))
          if string.len(padding) > 2 or string.find(payload, '[^A-Za-z0-9+/]') then
            return {'err', 'TEMPORARY_MIGRATION_REQUIRED'}
          end
          original = string.len(source) / 4 * 3 - string.len(padding)
          derived = derived - string.len(source)
        end
        table.insert(imported, {KEYS[i], original, derived})
      end
    end
    for _, item in ipairs(imported) do
      redis.call('HSET', item[1], 'original_bytes', item[2], 'derived_bytes', item[3])
      redis.call('SADD', KEYS[4], item[1])
      local owner_session = string.match(item[1], '^tmp:([^:]+:[^:]+):')
      local registry = 'tmp-registry:' .. owner_session
      redis.call('SADD', registry, item[1])
      local expiry = tonumber(redis.call('HGET', item[1], 'expires')) or now + 86400
      extend(registry, math.max(1, math.ceil((expiry - now) * 1000)))
    end
    redis.call('SET', KEYS[5], '1', 'EX', 86400)
  end
  redis.call('EXPIRE', KEYS[5], 86400)
  redis.call('EXPIRE', KEYS[4], 86400)
  local original = tonumber(ARGV[6])
  local derived = tonumber(ARGV[7])
  local members = redis.call('SMEMBERS', KEYS[4])
  local count = 0
  for _, key in ipairs(members) do
    if redis.call('EXISTS', key) == 0 then
      redis.call('SREM', KEYS[4], key)
    else
      count = count + 1
      if key ~= KEYS[1] then
        original = original + tonumber(redis.call('HGET', key, 'original_bytes') or '0')
        derived = derived + tonumber(redis.call('HGET', key, 'derived_bytes') or '0')
      end
    end
  end
  if original > tonumber(ARGV[8]) or derived > tonumber(ARGV[9])
      or (op == 'create' and count >= 1024) then return {'err', 'QUOTA_EXCEEDED'} end
end
if op == 'create' then
  if #data > 0 then return {'err', 'RESOURCE_EXISTS'} end
  redis.call('HSET', KEYS[1], 'value', ARGV[4], 'revision', '1', 'expires', tostring(now + hard))
  redis.call('HSET', KEYS[1], 'original_bytes', ARGV[6], 'derived_bytes', ARGV[7])
  redis.call('PEXPIRE', KEYS[1], math.floor(math.min(idle, hard) * 1000))
  redis.call('SADD', KEYS[3], KEYS[1])
  extend(KEYS[3], math.ceil(hard * 1000))
  redis.call('SADD', KEYS[4], KEYS[1])
  redis.call('EXPIRE', KEYS[4], 86400)
  return {'ok', '1', ARGV[4]}
end
if #data == 0 then return {'err', 'TEMPORARY_CONTENT_EXPIRED'} end
local expiry = tonumber(redis.call('HGET', KEYS[1], 'expires'))
if not expiry or expiry <= now then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[3], KEYS[1])
  redis.call('SREM', KEYS[4], KEYS[1])
  return {'err', 'TEMPORARY_CONTENT_EXPIRED'}
end
if op == 'delete' then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[3], KEYS[1])
  redis.call('SREM', KEYS[4], KEYS[1])
  return {'ok', '0', '{}'}
end
local revision = tonumber(redis.call('HGET', KEYS[1], 'revision'))
if op == 'replace' then
  if revision ~= tonumber(ARGV[5]) then return {'err', 'REVISION_CONFLICT'} end
  revision = revision + 1
  redis.call('HSET', KEYS[1], 'value', ARGV[4], 'revision', tostring(revision))
  redis.call('HSET', KEYS[1], 'original_bytes', ARGV[6], 'derived_bytes', ARGV[7])
end
redis.call('PEXPIRE', KEYS[1], math.max(1, math.floor(math.min(idle, expiry - now) * 1000)))
return {'ok', tostring(revision), redis.call('HGET', KEYS[1], 'value')}
"""

_END = """
redis.call('SET', KEYS[1], 'revoked', 'EX', 604800)
local resources = redis.call('SMEMBERS', KEYS[2])
for _, key in ipairs(resources) do
  redis.call('DEL', key)
  redis.call('SREM', KEYS[3], key)
end
redis.call('DEL', KEYS[2])
return #resources
"""

_UPLOAD_SLOT = """
local parts = redis.call('TIME')
local now = tonumber(parts[1]) + tonumber(parts[2]) / 1000000
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('GET', KEYS[2]) == 'revoked' then return 'SESSION_REVOKED' end
if redis.call('ZCARD', KEYS[1]) >= 2 then return 'UPLOAD_LIMIT_EXCEEDED' end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], math.ceil(tonumber(ARGV[2]) * 1000) + 1000)
return 'ok'
"""

_RENEW_UPLOAD = """
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 0 end
local parts = redis.call('TIME')
local now = tonumber(parts[1]) + tonumber(parts[2]) / 1000000
redis.call('ZADD', KEYS[1], 'XX', now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], math.ceil(tonumber(ARGV[2]) * 1000) + 1000)
return 1
"""


class TemporaryStore:
    KINDS = frozenset({"document", "workspace", "preview", "run", "index", "retention"})
    UPLOAD_TIMEOUT_SECONDS = 90
    UPLOAD_LEASE_SECONDS = 120
    UPLOAD_RENEW_SECONDS = 20

    def __init__(self, redis: Redis, *, idle_seconds: float = 3600, hard_seconds: float = 86400, max_resource_bytes: int = 32 * 1024 * 1024, max_original_bytes: int = 20 * 1024 * 1024, max_derived_bytes: int = 32 * 1024 * 1024):
        if not 0 < idle_seconds <= 3600 or not 0 < hard_seconds <= 86400:
            raise ValueError("invalid temporary lifetime")
        self.redis = redis
        self.idle_seconds = idle_seconds
        self.hard_seconds = hard_seconds
        self.max_resource_bytes = max_resource_bytes
        self.max_original_bytes = max_original_bytes
        self.max_derived_bytes = max_derived_bytes

    def session_key(self, actor: ActorContext) -> str:
        return f"tmp-session:{actor.user_id}:{actor.session_id}"

    def _registry(self, actor: ActorContext) -> str:
        return f"tmp-registry:{actor.user_id}:{actor.session_id}"

    def _account_registry(self, actor: ActorContext) -> str:
        return f"tmp-account:{actor.user_id}"

    async def _legacy_snapshot(self, actor: ActorContext) -> tuple[str, list[str]]:
        """Bound the one-time account migration; never delete unaccounted data."""
        marker = f"tmp-account-schema:{actor.user_id}"
        if await self.redis.exists(marker):
            return "", []
        cursor, keys = 0, set()
        for _ in range(128):
            cursor, batch = await self.redis.scan(cursor, match=f"tmp:{actor.user_id}:*", count=128)
            keys.update(batch)
            if len(keys) > 1024:
                raise TemporaryError("TEMPORARY_MIGRATION_REQUIRED")
            if cursor == 0:
                return "complete", sorted(keys)
        raise TemporaryError("TEMPORARY_MIGRATION_REQUIRED")

    @asynccontextmanager
    async def upload_slot(self, actor: ActorContext):
        """Keep admission reserved until cancellation-aware work settles."""
        key = f"tmp-uploads:{actor.user_id}"
        token = str(uuid4())
        try:
            result = await self.redis.eval(_UPLOAD_SLOT, 2, key, self.session_key(actor), token, self.UPLOAD_LEASE_SECONDS)
        except RedisError:
            raise TemporaryError("DEPENDENCY_UNAVAILABLE") from None
        result = result.decode() if isinstance(result, bytes) else result
        if result != "ok":
            raise TemporaryError(result)
        owner = asyncio.current_task()
        lease_failed = False

        async def renew():
            nonlocal lease_failed
            while True:
                await asyncio.sleep(self.UPLOAD_RENEW_SECONDS)
                try:
                    renewed = await self.redis.eval(_RENEW_UPLOAD, 1, key, token, self.UPLOAD_LEASE_SECONDS)
                except RedisError:
                    renewed = False
                if not renewed and not lease_failed:
                    lease_failed = True
                    owner.cancel()

        heartbeat = asyncio.create_task(renew())
        try:
            async with asyncio.timeout(self.UPLOAD_TIMEOUT_SECONDS):
                yield
            if lease_failed:
                raise TemporaryError("DEPENDENCY_UNAVAILABLE")
        except asyncio.CancelledError:
            if lease_failed:
                raise TemporaryError("DEPENDENCY_UNAVAILABLE") from None
            raise
        except TimeoutError:
            raise TemporaryError("UPLOAD_TIMEOUT") from None
        finally:
            heartbeat.cancel()
            await asyncio.gather(heartbeat, return_exceptions=True)
            # Lease expiry releases capacity even if Redis is unavailable.
            try:
                await self.redis.zrem(key, token)
            except RedisError:
                pass

    def _key(self, actor: ActorContext, kind: str, resource_id: str) -> str:
        if not isinstance(actor, ActorContext) or kind not in self.KINDS:
            raise TemporaryError("RESOURCE_NOT_FOUND")
        try:
            identifier = str(UUID(resource_id))
        except (ValueError, TypeError, AttributeError):
            raise TemporaryError("RESOURCE_NOT_FOUND") from None
        return f"tmp:{actor.user_id}:{actor.session_id}:{kind}:{identifier}"

    async def _operate(self, operation: str, actor: ActorContext, kind: str, resource_id: str, value: dict | None = None, revision: int = 0) -> TemporaryResource:
        body = json.dumps(value or {}, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if len(body.encode("utf-8")) > self.max_resource_bytes:
            raise TemporaryError("QUOTA_EXCEEDED")
        original = 0
        derived = len(body.encode("utf-8"))
        if kind == "document" and value and "source_base64" in value:
            try:
                source = value["source_base64"]
                original = len(base64.b64decode(source, validate=True))
                derived -= len(source)
            except (ValueError, TypeError):
                raise TemporaryError("CONTENT_INVALID") from None
        try:
            migration, legacy = await self._legacy_snapshot(actor) if operation in {"create", "replace"} else ("", [])
            result = await self.redis.eval(_OPERATE, 5 + len(legacy), self._key(actor, kind, resource_id), self.session_key(actor), self._registry(actor), self._account_registry(actor), f"tmp-account-schema:{actor.user_id}", *legacy, operation, self.idle_seconds, self.hard_seconds, body, revision, original, derived, self.max_original_bytes, self.max_derived_bytes, migration)
        except RedisError:
            raise TemporaryError("DEPENDENCY_UNAVAILABLE") from None
        result = [v.decode() if isinstance(v, bytes) else v for v in result]
        if result[0] != "ok":
            code = result[1]
            if code == "SESSION_REVOKED" and operation != "create":
                code = "TEMPORARY_CONTENT_EXPIRED"
            raise TemporaryError(code)
        return TemporaryResource(resource_id, kind, int(result[1]), json.loads(result[2]))

    async def create(self, actor: ActorContext, kind: str, value: dict, *, resource_id: str | None = None) -> TemporaryResource:
        return await self._operate("create", actor, kind, resource_id or str(uuid4()), value)

    async def get(self, actor: ActorContext, kind: str, resource_id: str) -> TemporaryResource:
        return await self._operate("get", actor, kind, resource_id)

    async def replace(self, actor: ActorContext, kind: str, resource_id: str, value: dict, *, expected_revision: int) -> TemporaryResource:
        return await self._operate("replace", actor, kind, resource_id, value, expected_revision)

    async def delete(self, actor: ActorContext, kind: str, resource_id: str) -> None:
        await self._operate("delete", actor, kind, resource_id)

    async def list(self, actor: ActorContext, kind: str) -> list[TemporaryResource]:
        if kind not in self.KINDS:
            raise TemporaryError("RESOURCE_NOT_FOUND")
        try:
            keys = await self.redis.smembers(self._registry(actor))
        except RedisError:
            raise TemporaryError("DEPENDENCY_UNAVAILABLE") from None
        prefix = f"tmp:{actor.user_id}:{actor.session_id}:{kind}:"
        resources = []
        for raw in keys:
            key = raw.decode() if isinstance(raw, bytes) else raw
            if not key.startswith(prefix):
                continue
            try:
                resources.append(await self.get(actor, kind, key[len(prefix):]))
            except TemporaryError as error:
                if str(error) != "TEMPORARY_CONTENT_EXPIRED":
                    raise
        return resources

    async def end_session(self, actor: ActorContext) -> None:
        try:
            await self.redis.eval(_END, 3, self.session_key(actor), self._registry(actor), self._account_registry(actor))
        except RedisError:
            raise TemporaryError("DEPENDENCY_UNAVAILABLE") from None
