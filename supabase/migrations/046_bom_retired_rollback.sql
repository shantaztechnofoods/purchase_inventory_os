-- Reverses 046. Retired BOMs become issuable again.
BEGIN;
ALTER TABLE public.bom_definitions DROP COLUMN IF EXISTS replaced_by, DROP COLUMN IF EXISTS retired_at;
COMMIT;
