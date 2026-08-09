-- Runs once, on first initialisation of the Postgres volume.
-- The Context Forge gateway keeps its registry in its own database on the
-- same server, so the whole stack still needs only one Postgres container.
SELECT 'CREATE DATABASE mcpgateway'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mcpgateway') \gexec
