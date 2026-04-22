-- =============================================================================
-- Table stock_vehicules — V2 (schéma libre)
-- =============================================================================
-- Les données du fichier CSV/Excel sont stockées telles quelles dans `donnees`
-- (JSONB clé/valeur). Les noms de colonnes du fichier sont les clés.
-- `colonnes_pdf` liste les clés à afficher dans le bon de commande (ordre conservé).
-- Les anciennes colonnes typées (marque, modele, prix…) sont conservées pour
-- compatibilité avec les lignes déjà importées mais ne sont plus utilisées par
-- l'application. Tu peux les dropper manuellement quand tu veux.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stock_vehicules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concession_id uuid REFERENCES auth.users(id),
  donnees jsonb NOT NULL DEFAULT '{}'::jsonb,
  colonnes_pdf jsonb NOT NULL DEFAULT '[]'::jsonb,
  disponible boolean DEFAULT true,
  created_at timestamp DEFAULT now()
);

-- Migration : ajoute `donnees` et `colonnes_pdf` sur une table existante.
ALTER TABLE stock_vehicules
  ADD COLUMN IF NOT EXISTS donnees jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE stock_vehicules
  ADD COLUMN IF NOT EXISTS colonnes_pdf jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE stock_vehicules DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS stock_vehicules_concession_idx
  ON stock_vehicules (concession_id, disponible);
