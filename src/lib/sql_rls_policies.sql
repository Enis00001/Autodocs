-- ============================================================================
-- AutoDocs — Row Level Security (RLS) pour toutes les tables.
-- ============================================================================
-- À exécuter UNE fois dans Supabase → SQL Editor.
-- Idempotent : peut être relancé sans casser une base existante.
--
-- Règle : chaque utilisateur authentifié ne voit QUE les lignes dont la colonne
-- propriétaire (`user_id`, `concession_id`, `dealer_id`) vaut `auth.uid()`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. brouillons
-- ----------------------------------------------------------------------------
ALTER TABLE brouillons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_own_data"              ON brouillons;
DROP POLICY IF EXISTS "brouillons_select_own"      ON brouillons;
DROP POLICY IF EXISTS "brouillons_insert_own"      ON brouillons;
DROP POLICY IF EXISTS "brouillons_update_own"      ON brouillons;
DROP POLICY IF EXISTS "brouillons_delete_own"      ON brouillons;

CREATE POLICY "user_own_data" ON brouillons
  FOR ALL
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 2. stock_vehicules
-- ----------------------------------------------------------------------------
ALTER TABLE stock_vehicules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_own_stock" ON stock_vehicules;

CREATE POLICY "user_own_stock" ON stock_vehicules
  FOR ALL
  USING     (auth.uid() = concession_id)
  WITH CHECK (auth.uid() = concession_id);

-- ----------------------------------------------------------------------------
-- 3. pdf_templates
-- ----------------------------------------------------------------------------
ALTER TABLE pdf_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_own_templates"        ON pdf_templates;
DROP POLICY IF EXISTS "pdf_templates_select_own"  ON pdf_templates;

CREATE POLICY "user_own_templates" ON pdf_templates
  FOR ALL
  USING     (auth.uid() = dealer_id)
  WITH CHECK (auth.uid() = dealer_id);

-- ----------------------------------------------------------------------------
-- 4. vehicle_fields
-- ----------------------------------------------------------------------------
ALTER TABLE vehicle_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_own_fields"             ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_select_own"   ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_insert_own"   ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_update_own"   ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_delete_own"   ON vehicle_fields;

CREATE POLICY "user_own_fields" ON vehicle_fields
  FOR ALL
  USING     (auth.uid() = concession_id)
  WITH CHECK (auth.uid() = concession_id);

-- ----------------------------------------------------------------------------
-- 5. Tables annexes (templates, vendeurs, concession) — par sécurité.
--    Ne rien faire si la table n'existe pas.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'templates') THEN
    EXECUTE 'ALTER TABLE templates ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "user_own_templates_light" ON templates';
    EXECUTE 'CREATE POLICY "user_own_templates_light" ON templates FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vendeurs') THEN
    EXECUTE 'ALTER TABLE vendeurs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "user_own_vendeurs" ON vendeurs';
    EXECUTE 'CREATE POLICY "user_own_vendeurs" ON vendeurs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'concession') THEN
    EXECUTE 'ALTER TABLE concession ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "user_own_concession" ON concession';
    EXECUTE 'CREATE POLICY "user_own_concession" ON concession FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. abonnements (Stripe)
--    Lecture seule pour l'utilisateur : seules les routes serveur
--    (service role key) peuvent écrire/mettre à jour.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS abonnements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id       text,
  stripe_subscription_id   text,
  plan                     text    DEFAULT 'gratuit',
  bons_ce_mois             integer DEFAULT 0,
  date_renouvellement      timestamptz,
  actif                    boolean DEFAULT true,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS abonnements_user_id_unique
  ON abonnements (user_id);

ALTER TABLE abonnements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_read_own_subscription" ON abonnements;
CREATE POLICY "user_read_own_subscription" ON abonnements
  FOR SELECT
  USING (auth.uid() = user_id);

-- Pas de policy INSERT/UPDATE/DELETE côté client : seul le backend avec le
-- service role key (qui bypass les policies) peut écrire dans cette table.
