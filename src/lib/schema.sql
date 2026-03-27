-- Table brouillons (structure alignée sur BonDraftData)
CREATE TABLE IF NOT EXISTS brouillons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_nom TEXT NOT NULL DEFAULT '',
  client_prenom TEXT NOT NULL DEFAULT '',
  client_date_naissance TEXT NOT NULL DEFAULT '',
  client_numero_cni TEXT NOT NULL DEFAULT '',
  client_adresse TEXT NOT NULL DEFAULT '',
  rib_titulaire TEXT NOT NULL DEFAULT '',
  rib_iban TEXT NOT NULL DEFAULT '',
  rib_bic TEXT NOT NULL DEFAULT '',
  rib_banque TEXT NOT NULL DEFAULT '',
  client_email TEXT NOT NULL DEFAULT '',
  client_telephone TEXT NOT NULL DEFAULT '',
  vehicule_modele TEXT NOT NULL DEFAULT '',
  vehicule_vin TEXT NOT NULL DEFAULT '',
  vehicule_premiere_circulation TEXT NOT NULL DEFAULT '',
  vehicule_kilometrage TEXT NOT NULL DEFAULT '',
  vehicule_co2 TEXT NOT NULL DEFAULT '',
  vehicule_chevaux TEXT NOT NULL DEFAULT '',
  vehicule_prix TEXT NOT NULL DEFAULT '',
  options_mode TEXT NOT NULL DEFAULT 'total' CHECK (options_mode IN ('total', 'detail')),
  options_prix_total TEXT NOT NULL DEFAULT '',
  options_detail_json TEXT NOT NULL DEFAULT '[]',
  vehicule_carte_grise TEXT NOT NULL DEFAULT '',
  vehicule_frais_reprise TEXT NOT NULL DEFAULT '',
  vehicule_remise TEXT NOT NULL DEFAULT '',
  vehicule_financement TEXT NOT NULL DEFAULT '',
  vehicule_date_livraison TEXT NOT NULL DEFAULT '',
  vehicule_reprise TEXT NOT NULL DEFAULT '',
  vehicule_couleur TEXT NOT NULL DEFAULT '',
  vehicule_options TEXT NOT NULL DEFAULT '',
  acompte TEXT NOT NULL DEFAULT '',
  mode_paiement TEXT NOT NULL DEFAULT 'virement' CHECK (mode_paiement IN ('virement', 'cheque', 'cb')),
  apport TEXT NOT NULL DEFAULT '',
  organisme_preteur TEXT NOT NULL DEFAULT '',
  montant_credit TEXT NOT NULL DEFAULT '',
  taux_credit TEXT NOT NULL DEFAULT '',
  duree_mois TEXT NOT NULL DEFAULT '',
  clause_suspensive BOOLEAN NOT NULL DEFAULT false,
  vendeur_nom TEXT NOT NULL DEFAULT '',
  vendeur_notes TEXT NOT NULL DEFAULT '',
  template_id TEXT NOT NULL DEFAULT '',
  documents_scanned JSONB NOT NULL DEFAULT '{}'
);

-- Index pour trier par date de mise à jour (liste des brouillons)
CREATE INDEX IF NOT EXISTS idx_brouillons_updated_at ON brouillons (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_brouillons_user_id ON brouillons (user_id);

-- Table templates
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  date_import TEXT NOT NULL,
  fichier_base64 TEXT,
  type TEXT
);
CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates (user_id);

-- Table vendeurs
CREATE TABLE IF NOT EXISTS vendeurs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nom TEXT NOT NULL DEFAULT '',
  prenom TEXT NOT NULL DEFAULT '',
  date_ajout TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendeurs_user_id ON vendeurs (user_id);

-- Table concession (une ligne par concession / utilisateur)
CREATE TABLE IF NOT EXISTS concession (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nom TEXT NOT NULL DEFAULT '',
  adresse TEXT NOT NULL DEFAULT '',
  logo_base64 TEXT
);
CREATE INDEX IF NOT EXISTS idx_concession_user_id ON concession (user_id);

-- Migration des schémas déjà existants (ajout de user_id si nécessaire)
ALTER TABLE brouillons ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE brouillons ADD COLUMN IF NOT EXISTS rib_titulaire TEXT NOT NULL DEFAULT '';
ALTER TABLE brouillons ADD COLUMN IF NOT EXISTS rib_iban TEXT NOT NULL DEFAULT '';
ALTER TABLE brouillons ADD COLUMN IF NOT EXISTS rib_bic TEXT NOT NULL DEFAULT '';
ALTER TABLE brouillons ADD COLUMN IF NOT EXISTS rib_banque TEXT NOT NULL DEFAULT '';
ALTER TABLE brouillons ADD COLUMN IF NOT EXISTS documents_scanned JSONB NOT NULL DEFAULT '{}';
ALTER TABLE templates ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE vendeurs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE concession ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Sécurité RLS (isolation par utilisateur)
ALTER TABLE brouillons ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendeurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE concession ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brouillons_select_own" ON brouillons;
DROP POLICY IF EXISTS "brouillons_insert_own" ON brouillons;
DROP POLICY IF EXISTS "brouillons_update_own" ON brouillons;
DROP POLICY IF EXISTS "brouillons_delete_own" ON brouillons;
CREATE POLICY "brouillons_select_own" ON brouillons FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "brouillons_insert_own" ON brouillons FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "brouillons_update_own" ON brouillons FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "brouillons_delete_own" ON brouillons FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "templates_select_own" ON templates;
DROP POLICY IF EXISTS "templates_insert_own" ON templates;
DROP POLICY IF EXISTS "templates_update_own" ON templates;
DROP POLICY IF EXISTS "templates_delete_own" ON templates;
CREATE POLICY "templates_select_own" ON templates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "templates_insert_own" ON templates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "templates_update_own" ON templates FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "templates_delete_own" ON templates FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "vendeurs_select_own" ON vendeurs;
DROP POLICY IF EXISTS "vendeurs_insert_own" ON vendeurs;
DROP POLICY IF EXISTS "vendeurs_update_own" ON vendeurs;
DROP POLICY IF EXISTS "vendeurs_delete_own" ON vendeurs;
CREATE POLICY "vendeurs_select_own" ON vendeurs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "vendeurs_insert_own" ON vendeurs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "vendeurs_update_own" ON vendeurs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "vendeurs_delete_own" ON vendeurs FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "concession_select_own" ON concession;
DROP POLICY IF EXISTS "concession_insert_own" ON concession;
DROP POLICY IF EXISTS "concession_update_own" ON concession;
DROP POLICY IF EXISTS "concession_delete_own" ON concession;
CREATE POLICY "concession_select_own" ON concession FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "concession_insert_own" ON concession FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "concession_update_own" ON concession FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "concession_delete_own" ON concession FOR DELETE USING (auth.uid() = user_id);
