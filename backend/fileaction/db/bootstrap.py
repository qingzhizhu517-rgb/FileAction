"""Provision distinct, limited login roles after the schema migration."""
from __future__ import annotations

import os

import psycopg
from psycopg import sql


ROLES = (
    ("fileaction_app", "fileaction_runtime", "FILEACTION_RUNTIME_PASSWORD"),
    ("fileaction_auth_login", "fileaction_auth", "FILEACTION_AUTH_PASSWORD"),
    ("fileaction_dispatch_login", "fileaction_dispatcher", "FILEACTION_DISPATCHER_PASSWORD"),
)


def main() -> None:
    dsn = os.environ.get("FILEACTION_MIGRATION_DATABASE_URL")
    if not dsn or not dsn.startswith(("postgresql://", "postgresql+psycopg://")):
        raise RuntimeError("需要独立 PostgreSQL 迁移连接")
    dsn = dsn.replace("postgresql+psycopg://", "postgresql://", 1)
    passwords = {}
    for login, group, key in ROLES:
        value = os.environ.get(key)
        if not value:
            raise RuntimeError(f"缺少 {key}")
        passwords[login] = value
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database()")
            database_name = cursor.fetchone()[0]
            for login, group, _ in ROLES:
                cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (login,))
                if cursor.fetchone():
                    cursor.execute(
                        sql.SQL("ALTER ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD {}").format(
                            sql.Identifier(login), sql.Literal(passwords[login])
                        )
                    )
                else:
                    cursor.execute(
                        sql.SQL("CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD {}").format(
                            sql.Identifier(login), sql.Literal(passwords[login])
                        )
                    )
                cursor.execute(sql.SQL("GRANT {} TO {}").format(sql.Identifier(group), sql.Identifier(login)))
                cursor.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                    sql.Identifier(database_name), sql.Identifier(login)
                ))


if __name__ == "__main__":
    main()
