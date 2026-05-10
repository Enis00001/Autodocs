-- ============================================================================
-- AutoDocs — Multi-utilisateurs par concession (tables centrales)
-- ============================================================================
-- À exécuter UNE fois dans Supabase → SQL Editor.
-- Idempotent : peut être relancé sans casser une base existante.
--
-- Concept :
--   - `concessions`        : entité métier (1 ligne par concession), créée par
--                            un utilisateur "admin" qui en devient propriétaire.
--   - `membres_concession` : table de liaison user ↔ concession avec un rôle
--                            ('admin' ou 'commercial'). Un user peut appartenir
--                            à 1 seule concession (UNIQUE).
--   - `invitations`        : tokens UUID v4 envoyés par email aux commerciaux
--                            que l'admin invite à rejoindre l'espace partagé.
--
-- IMPORTANT — récursion RLS :
--   Les policies sur `membres_concession` ne peuvent pas faire un sous-SELECT
--   sur `membres_concession` lui-même (récursion infinie). On utilise donc une
--   fonction SECURITY DEFINER `is_membre_concession(uuid)` qui contourne RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table concessions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS concessions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                     TEXT,
  siret                   TEXT,
  adresse                 TEXT,
  telephone               TEXT,
  email                   TEXT,
  tva_intracommunautaire  TEXT,
  logo_url                TEXT,
  owner_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_concessions_owner_id
  ON concessions (owner_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION set_concessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_concessions_updated_at ON concessions;
CREATE TRIGGER trg_concessions_updated_at
  BEFORE UPDATE ON concessions
  FOR EACH ROW
  EXECUTE FUNCTION set_concessions_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Table membres_concession
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS membres_concession (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concession_id   UUID NOT NULL REFERENCES concessions(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'commercial' CHECK (role IN ('admin', 'commercial')),
  prenom          TEXT,
  nom             TEXT,
  email           TEXT,
  actif           BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(concession_id, user_id)
);

-- Un user n'appartient qu'à UNE concession à la fois (V1). Si on veut
-- supporter multi-concession plus tard, on droppera cet index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_membres_concession_user_unique
  ON membres_concession (user_id)
  WHERE actif = true;

CREATE INDEX IF NOT EXISTS idx_membres_concession_concession
  ON membres_concession (concession_id);

CREATE INDEX IF NOT EXISTS idx_membres_concession_user
  ON membres_concession (user_id);

-- ----------------------------------------------------------------------------
-- 3. Table invitations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concession_id   UUID NOT NULL REFERENCES concessions(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'commercial' CHECK (role IN ('admin', 'commercial')),
  token           TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at     TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_concession
  ON invitations (concession_id);

CREATE INDEX IF NOT EXISTS idx_invitations_token
  ON invitations (token);

CREATE INDEX IF NOT EXISTS idx_invitations_email
  ON invitations (lower(email));

-- ----------------------------------------------------------------------------
-- 4. Helper SECURITY DEFINER (anti-récursion RLS)
-- ----------------------------------------------------------------------------
-- Renvoie true si le user courant est membre actif de la concession donnée.
-- SECURITY DEFINER => bypass RLS, donc on peut interroger membres_concession
-- depuis une policy qui s'applique à cette même table sans boucle infinie.
CREATE OR REPLACE FUNCTION public.is_membre_concession(target_concession UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM membres_concession
    WHERE concession_id = target_concession
      AND user_id = auth.uid()
      AND actif = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_membre_concession(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.is_membre_concession(UUID) TO authenticated, anon;

-- Renvoie true si le user courant est admin actif de la concession donnée.
CREATE OR REPLACE FUNCTION public.is_admin_concession(target_concession UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM membres_concession
    WHERE concession_id = target_concession
      AND user_id = auth.uid()
      AND role = 'admin'
      AND actif = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_concession(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin_concession(UUID) TO authenticated, anon;

-- Renvoie la concession_id du user courant (NULL s'il n'est membre d'aucune).
-- Utilisé par les inserts pour retrouver la concession active automatiquement.
CREATE OR REPLACE FUNCTION public.current_concession_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT concession_id
  FROM membres_concession
  WHERE user_id = auth.uid() AND actif = true
  ORDER BY created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_concession_id() FROM public;
GRANT EXECUTE ON FUNCTION public.current_concession_id() TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- 5. RLS — concessions
-- ----------------------------------------------------------------------------
ALTER TABLE concessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "concessions_select_membre"  ON concessions;
DROP POLICY IF EXISTS "concessions_insert_owner"   ON concessions;
DROP POLICY IF EXISTS "concessions_update_admin"   ON concessions;
DROP POLICY IF EXISTS "concessions_delete_owner"   ON concessions;

-- Lecture : tout membre actif (admin ou commercial) voit sa concession.
CREATE POLICY "concessions_select_membre" ON concessions
  FOR SELECT
  USING (public.is_membre_concession(id));

-- Création : un user authentifié peut créer une concession dont il est owner.
CREATE POLICY "concessions_insert_owner" ON concessions
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- Mise à jour : seul un admin de la concession peut modifier ses paramètres.
CREATE POLICY "concessions_update_admin" ON concessions
  FOR UPDATE
  USING (public.is_admin_concession(id))
  WITH CHECK (public.is_admin_concession(id));

-- Suppression : owner uniquement (= compte qui a créé la concession).
CREATE POLICY "concessions_delete_owner" ON concessions
  FOR DELETE
  USING (auth.uid() = owner_id);

-- ----------------------------------------------------------------------------
-- 6. RLS — membres_concession
-- ----------------------------------------------------------------------------
ALTER TABLE membres_concession ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membres_select_equipe"        ON membres_concession;
DROP POLICY IF EXISTS "membres_insert_self_or_admin" ON membres_concession;
DROP POLICY IF EXISTS "membres_update_admin"         ON membres_concession;
DROP POLICY IF EXISTS "membres_delete_admin"         ON membres_concession;

-- Lecture : un membre voit toute son équipe (lui + ses collègues).
CREATE POLICY "membres_select_equipe" ON membres_concession
  FOR SELECT
  USING (public.is_membre_concession(concession_id));

-- Insert :
--   - cas 1 : un user s'auto-ajoute comme admin sur SA concession (au moment
--             du bootstrap après inscription) — owner_id check côté concessions
--   - cas 2 : un admin ajoute un commercial à son équipe (acceptation
--             d'invitation côté API : c'est généralement fait avec service_role)
CREATE POLICY "membres_insert_self_or_admin" ON membres_concession
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin_concession(concession_id)
  );

-- Mise à jour : admin uniquement (activer/désactiver, changer rôle).
CREATE POLICY "membres_update_admin" ON membres_concession
  FOR UPDATE
  USING (public.is_admin_concession(concession_id))
  WITH CHECK (public.is_admin_concession(concession_id));

-- Suppression : admin uniquement.
CREATE POLICY "membres_delete_admin" ON membres_concession
  FOR DELETE
  USING (public.is_admin_concession(concession_id));

-- ----------------------------------------------------------------------------
-- 7. RLS — invitations
-- ----------------------------------------------------------------------------
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invitations_select_admin" ON invitations;
DROP POLICY IF EXISTS "invitations_insert_admin" ON invitations;
DROP POLICY IF EXISTS "invitations_update_admin" ON invitations;
DROP POLICY IF EXISTS "invitations_delete_admin" ON invitations;

-- L'admin voit/gère les invitations de sa concession.
-- L'acceptation d'invitation publique (page /invitation/:token) passe par
-- l'API serverless avec service_role, donc cette policy n'est pas bloquante.
CREATE POLICY "invitations_select_admin" ON invitations
  FOR SELECT
  USING (public.is_admin_concession(concession_id));

CREATE POLICY "invitations_insert_admin" ON invitations
  FOR INSERT
  WITH CHECK (public.is_admin_concession(concession_id));

CREATE POLICY "invitations_update_admin" ON invitations
  FOR UPDATE
  USING (public.is_admin_concession(concession_id))
  WITH CHECK (public.is_admin_concession(concession_id));

CREATE POLICY "invitations_delete_admin" ON invitations
  FOR DELETE
  USING (public.is_admin_concession(concession_id));
