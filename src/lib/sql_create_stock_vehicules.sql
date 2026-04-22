-- Table stock_vehicules — catalogue véhicules importé depuis CSV / Excel
CREATE TABLE IF NOT EXISTS stock_vehicules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concession_id uuid REFERENCES auth.users(id),
  marque text,
  modele text,
  version text,
  annee text,
  couleur text,
  kilometrage text,
  prix text,
  vin text,
  puissance text,
  co2 text,
  carburant text,
  transmission text,
  premiere_circulation text,
  disponible boolean DEFAULT true,
  -- Liste des champs à inclure dans le PDF "bon de commande".
  -- Exemple : ["marque", "modele", "prix", "couleur"].
  -- Si NULL ou [] → on retombe sur le comportement "afficher tous les champs par défaut".
  colonnes_pdf jsonb DEFAULT '[]'::jsonb,
  created_at timestamp DEFAULT now()
);

ALTER TABLE stock_vehicules DISABLE ROW LEVEL SECURITY;

-- Migration : ajoute la colonne sur une table déjà existante.
ALTER TABLE stock_vehicules
  ADD COLUMN IF NOT EXISTS colonnes_pdf jsonb DEFAULT '[]'::jsonb;

-- Index pour accélérer la recherche par concession + disponibilité
CREATE INDEX IF NOT EXISTS stock_vehicules_concession_idx
  ON stock_vehicules (concession_id, disponible);
