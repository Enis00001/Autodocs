-- =============================================================================
-- Fix suppression stock véhicules — livre de police
-- =============================================================================
-- À exécuter dans Supabase → SQL Editor (OBLIGATOIRE si erreur 409/500 à la
-- suppression ou au vidage du stock). Idempotent.
--
-- Cause : livre_de_police.stock_vehicule_id référence stock_vehicules.
-- La mise à jour client-side échoue silencieusement (RLS) → DELETE renvoie 409.
-- =============================================================================

-- 1. FK : ON DELETE SET NULL (détachement automatique côté PostgreSQL)
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'livre_de_police'
  ) THEN
    RAISE NOTICE 'Table livre_de_police absente — étape FK ignorée.';
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

-- 2. RPC sécurisées (bypass RLS pour détacher livre_de_police puis supprimer)
CREATE OR REPLACE FUNCTION public.delete_stock_vehicule(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_concession_id UUID;
BEGIN
  IF p_id IS NULL THEN
    RETURN;
  END IF;

  SELECT concession_id
  INTO v_concession_id
  FROM stock_vehicules
  WHERE id = p_id;

  IF v_concession_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.is_membre_concession(v_concession_id) THEN
    RAISE EXCEPTION 'Accès refusé à cette concession';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'livre_de_police'
  ) THEN
    UPDATE livre_de_police
    SET stock_vehicule_id = NULL,
        updated_at = now()
    WHERE stock_vehicule_id = p_id;
  END IF;

  DELETE FROM stock_vehicules
  WHERE id = p_id
    AND concession_id = v_concession_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_stock_vehicules(p_concession_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_concession_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.is_membre_concession(p_concession_id) THEN
    RAISE EXCEPTION 'Accès refusé à cette concession';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'livre_de_police'
  ) THEN
    UPDATE livre_de_police
    SET stock_vehicule_id = NULL,
        updated_at = now()
    WHERE concession_id = p_concession_id
      AND stock_vehicule_id IS NOT NULL;
  END IF;

  DELETE FROM stock_vehicules
  WHERE concession_id = p_concession_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_stock_vehicule(UUID) FROM public;
REVOKE ALL ON FUNCTION public.clear_stock_vehicules(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_stock_vehicule(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_stock_vehicules(UUID) TO authenticated;
