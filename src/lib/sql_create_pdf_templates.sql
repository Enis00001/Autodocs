-- =============================================================================
-- OBLIGATOIRE si l'app affiche : "Could not find the table 'public.pdf_templates'"
-- ou si Nouveau bon ne liste aucun template analysé.
-- À exécuter dans Supabase → SQL Editor → Run (une fois par projet).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pdf_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  field_mapping JSONB NOT NULL DEFAULT '{}',
  mapping_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (mapping_status IN ('pending', 'complete', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdf_templates_dealer_id ON public.pdf_templates (dealer_id);

ALTER TABLE public.pdf_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdf_templates_select_own" ON public.pdf_templates;
CREATE POLICY "pdf_templates_select_own" ON public.pdf_templates
  FOR SELECT
  TO authenticated
  USING (auth.uid() = dealer_id);

-- Les écritures (INSERT) passent par les routes API avec la service role key,
-- qui contourne RLS ; pas besoin de policy INSERT pour le client anon.

-- Recharge le cache de l’API PostgREST (évite parfois "schema cache" obsolète)
NOTIFY pgrst, 'reload schema';
