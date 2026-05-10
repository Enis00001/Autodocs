-- AutoDocs — Facturation véhicule (RLS par concession = auth.uid)
-- Exécuter dans le SQL Editor Supabase après validation du schéma.

CREATE TABLE IF NOT EXISTS factures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  concession_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brouillon_id UUID REFERENCES brouillons(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  numero_facture TEXT NOT NULL,
  date_facture DATE NOT NULL DEFAULT CURRENT_DATE,
  date_livraison DATE,

  concession_nom TEXT,
  concession_siret TEXT,
  concession_adresse TEXT,
  concession_telephone TEXT,
  concession_email TEXT,
  concession_tva_intracommunautaire TEXT,

  client_nom TEXT,
  client_prenom TEXT,
  client_adresse TEXT,
  client_email TEXT,
  client_telephone TEXT,

  vehicule_marque TEXT,
  vehicule_modele TEXT,
  vehicule_version TEXT,
  vehicule_annee TEXT,
  vehicule_kilometrage TEXT,
  vehicule_vin TEXT,
  vehicule_immatriculation TEXT,
  vehicule_couleur TEXT,
  vehicule_energie TEXT,

  prix_ht DECIMAL(10, 2),
  tva_taux DECIMAL(5, 2) DEFAULT 20.00,
  tva_montant DECIMAL(10, 2),
  prix_ttc DECIMAL(10, 2),
  acompte DECIMAL(10, 2) DEFAULT 0,
  reste_a_payer DECIMAL(10, 2),

  reprise_vehicule_description TEXT,
  reprise_montant DECIMAL(10, 2) DEFAULT 0,

  prestations_supplementaires JSONB DEFAULT '[]'::jsonb,

  statut TEXT NOT NULL DEFAULT 'emise',
  notes TEXT,
  pdf_base64 TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT factures_numero_unique UNIQUE (concession_id, numero_facture),
  CONSTRAINT factures_statut_chk CHECK (statut IN ('emise', 'payee', 'annulee'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_factures_one_brouillon
  ON factures (concession_id, brouillon_id)
  WHERE brouillon_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_factures_concession_created
  ON factures (concession_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_factures_client_id
  ON factures (client_id)
  WHERE client_id IS NOT NULL;

ALTER TABLE factures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_factures" ON factures;
CREATE POLICY "users_own_factures" ON factures
  FOR ALL
  USING (concession_id = auth.uid())
  WITH CHECK (concession_id = auth.uid());

-- Séquence globale (référence métier ; le numéro exposé reste FAC-YYYY-#### par année)
CREATE SEQUENCE IF NOT EXISTS facture_sequence START WITH 1;

-- Profil concession : champs facturation / légal
ALTER TABLE profil_concession
  ADD COLUMN IF NOT EXISTS siret TEXT;
ALTER TABLE profil_concession
  ADD COLUMN IF NOT EXISTS tva_intracommunautaire TEXT;
ALTER TABLE profil_concession
  ADD COLUMN IF NOT EXISTS email_contact TEXT;
