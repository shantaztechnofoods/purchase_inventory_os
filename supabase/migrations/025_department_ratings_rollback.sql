-- 025_department_ratings_rollback.sql
BEGIN;
DROP TABLE IF EXISTS public.department_ratings;
COMMIT;
