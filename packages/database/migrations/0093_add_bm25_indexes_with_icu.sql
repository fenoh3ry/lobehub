-- Custom SQL migration file
-- BM25 indexes require pg_search extension which is deprecated/unavailable on Neon.
-- This migration is skipped on providers that don't support pg_search/bm25.
-- Search will use standard PostgreSQL GIN/GIST indexes instead.
SELECT 1 WHERE EXISTS (SELECT 1 FROM pg_am WHERE amname = 'bm25');
