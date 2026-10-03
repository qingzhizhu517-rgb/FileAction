"""每次业务操作独立事务，RLS身份仅在当前事务生效。"""
from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from fileaction.core.config import Settings
from fileaction.core.errors import ConfigurationError


@dataclass(frozen=True)
class ActorContext:
    user_id: UUID
    session_id: UUID

    def __post_init__(self) -> None:
        if not isinstance(self.user_id, UUID) or not isinstance(self.session_id, UUID):
            raise TypeError("ActorContext 需要已验证的UUID身份")


def create_session_factory(settings: Settings) -> async_sessionmaker[AsyncSession]:
    settings.require_core()
    if not settings.database_url:
        raise ConfigurationError("缺少 FILEACTION_DATABASE_URL")
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    return async_sessionmaker(engine, expire_on_commit=False)


def tenant_transaction(factory: async_sessionmaker[AsyncSession], actor: ActorContext):
    if factory is None or not isinstance(actor, ActorContext):
        raise TypeError("租户事务需要会话工厂和已验证ActorContext")

    @asynccontextmanager
    async def transaction() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            async with session.begin():
                await session.execute(
                    text("SELECT set_config('app.user_id', :authenticated_user_id, true)"),
                    {"authenticated_user_id": str(actor.user_id)},
                )
                yield session

    return transaction()
