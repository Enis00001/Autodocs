-- ============================================================================
-- AutoDocs — CRM : table `clients` + liaison vers `brouillons`.
-- ============================================================================
-- À exécuter UNE fois dans Supabase → SQL Editor.
-- Idempotent : peut être relancé sans casser une base existante.
--
-- Une concession (= 1 utilisateur Auth) possède N clients.
-- Un brouillon (bon de commande) peut être rattaché à un client (nullable).
-- RLS : voir sql_rls_policies.sql (membres actifs de la concession).
-- Nécessite que la table public.concessions existe (sql_create_concessions.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table `clients`
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concession_id   UUID NOT NULL REFERENCES public.concessions(id) ON DELETE CASCADE,
  nom             TEXT NOT NULL,
  prenom          TEXT NOT NULL,
  email           TEXT,
  telephone       TEXT,
  adresse         TEXT,
  date_naissance  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_concession_id
  ON clients (concession_id);

CREATE INDEX IF NOT EXISTS idx_clients_concession_nom
  ON clients (concession_id, lower(nom), lower(prenom));

-- ----------------------------------------------------------------------------
-- 2. RLS — un user ne voit que ses propres clients
-- ----------------------------------------------------------------------------
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_clients" ON clients;
CREATE POLICY "users_own_clients" ON clients
  FOR ALL
  USING      (concession_id = auth.uid())
  WITH CHECK (concession_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. Liaison brouillons ↔ clients
-- ----------------------------------------------------------------------------
-- Colonne nullable : un brouillon peut très bien ne pas (encore) être lié à
-- une fiche client. ON DELETE SET NULL : si on supprime la fiche client, on
-- ne perd pas le brouillon.
ALTER TABLE brouillons
  ADD COLUMN IF NOT EXISTS client_id UUID
  REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_brouillons_client_id
  ON brouillons (client_id);

-- ----------------------------------------------------------------------------
-- 4. Trigger updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_clients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION set_clients_updated_at();
