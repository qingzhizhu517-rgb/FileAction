"""Bounded, non-mutating dependency checks for the formal API."""
from __future__ import annotations

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from fileaction.core.config import Settings


class ReadinessProbes:
    async def database(self, settings: Settings) -> bool:
        engine = create_async_engine(settings.database_url, connect_args={"connect_timeout": 2})
        try:
            async with engine.connect() as connection:
                result = await connection.execute(text(
                    "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') "
                    "AND EXISTS(SELECT 1 FROM alembic_version WHERE version_num = '0006_retention_and_memories')"
                ))
                return bool(result.scalar_one())
        finally:
            await engine.dispose()

    async def redis(self, settings: Settings) -> bool:
        from redis.asyncio import Redis
        client = Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
        try:
            return bool(await client.ping())
        finally:
            await client.aclose()

    async def cos(self, settings: Settings) -> bool:
        if not settings.cos_configured:
            return False
        # COS SDK is synchronous; keep it off the event loop and bound the wait.
        from qcloud_cos import CosConfig, CosS3Client

        def check() -> bool:
            config = CosConfig(
                Region=settings.cos_region, SecretId=settings.cos_secret_id,
                SecretKey=settings.cos_secret_key, Token=settings.cos_session_token,
                Timeout=2,
            )
            client = CosS3Client(config, retry=0)
            client.head_bucket(Bucket=settings.cos_bucket)
            return True

        return await asyncio.wait_for(asyncio.to_thread(check), timeout=3)
