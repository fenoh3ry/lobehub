-- Custom SQL migration file, put your code below! --
-- pg_search is deprecated on Neon and some providers.
-- Gracefully skip if not available; BM25 indexes (migration 0093) won't be created.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_search;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_search extension not available on this provider, skipping (%)', SQLERRM;
END $$;
