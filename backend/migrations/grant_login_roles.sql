-- Run with psql after migration, passing runtime_password, auth_password and dispatcher_password.
-- The migration group roles have NOLOGIN; these users never own business tables.
SELECT format('CREATE ROLE fileaction_app LOGIN PASSWORD %L', :'runtime_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fileaction_app') \gexec
SELECT format('CREATE ROLE fileaction_auth_login LOGIN PASSWORD %L', :'auth_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fileaction_auth_login') \gexec
SELECT format('CREATE ROLE fileaction_dispatch_login LOGIN PASSWORD %L', :'dispatcher_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fileaction_dispatch_login') \gexec
GRANT fileaction_runtime TO fileaction_app;
GRANT fileaction_auth TO fileaction_auth_login;
GRANT fileaction_dispatcher TO fileaction_dispatch_login;
GRANT CONNECT ON DATABASE fileaction TO fileaction_app, fileaction_auth_login, fileaction_dispatch_login;
