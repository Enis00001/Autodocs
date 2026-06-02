-- =============================================================================
-- Fix suppression stock véhicules — livre de police
-- =============================================================================
-- À exécuter dans Supabase → SQL Editor si la suppression du stock renvoie 500.
-- Idempotent.
--
-- Cause : livre_de_police.stock_vehicule_id référence stock_vehicules sans
-- ON DELETE SET NULL, ou la cascade SET NULL échoue à cause de la RLS.
-- =============================================================================

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'livre_de_police'
  ) THEN
    RAISE NOTICE 'Table livre_de_police absente — rien à faire.';
    RETURN;
  END IF;

  SELECT c.conname
  INTO fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
  WHERE t.relname = 'livre_de_police'
    AND c.contype = 'f'
    AND a.attname = 'stock_vehicule_id'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.livre_de_police DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE public.livre_de_police
    ADD CONSTRAINT livre_de_police_stock_vehicule_id_fkey
    FOREIGN KEY (stock_vehicule_id)
    REFERENCES public.stock_vehicules(id)
    ON DELETE SET NULL;
END $$;
