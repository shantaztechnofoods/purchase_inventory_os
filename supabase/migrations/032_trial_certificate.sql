-- ─────────────────────────────────────────────────────────────────────────────
-- 032_trial_certificate.sql — Machine Trial Certificate data on machine_log.
-- Depends on: 001 (public.machine_log).
--
-- Adds one additive, nullable jsonb column:
--   trial_certificate : full certificate payload captured when the Trial
--     department submits "Finish & Transfer → Ready". Structure:
--     {
--       trialDate, khakhraMode { speed1/2/3 { mainFrq, revFrq, jogFrq, thickness,
--                                              cutter/cyl2/cyl3 { onTm, onDly } } },
--       bakhriMode { same shape as one speed },
--       checkPoints { 16 named fields — boolean or string },
--       electricalLoad { rPhase, yPhase, bPhase },
--       trialByName, trialBySignature (SVG), checkByName, checkBySignature (SVG),
--       note
--     }
--
-- NULL for all pre-032 machines (no behavioural change for existing records).
-- Strictly additive. Nullable. No RLS, no trigger change, no destructive op.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.machine_log
  ADD COLUMN IF NOT EXISTS trial_certificate jsonb;

COMMIT;
