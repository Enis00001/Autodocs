-- ============================================================================
-- AutoDocs — Migration des données existantes vers le modèle multi-utilisateurs
-- ============================================================================
-- À exécuter UNE fois dans Supabase → SQL Editor, APRÈS sql_create_concessions.sql.
-- IDEMPOTENT : peut être relancé sans risque (toutes les opérations sont
-- conditionnelles, ON CONFLICT DO NOTHING, ADD COLUMN IF NOT EXISTS, etc.).
--
-- Stratégie :
--   1. Pour chaque utilisateur existant, on crée une `concessions` avec
--      `owner_id = user.id` (1 user = 1 concession solo héritée).
--   2. On insère ce user comme `admin` dans `membres_concession`.
--   3. On ajoute la colonne `concession_id` sur les tables qui filtraient
--      par `user_id` (brouillons, abonnements, profil_concession,
--      preferences_formulaire, concession singulier, signature_requests,
--      vendeurs, templates).
--   4. On REMAPPE `concession_id` (pointait vers `auth.users.id`) vers
--      `concessions.id` sur les tables où la colonne existait déjà
--      (clients, stock_vehicules, factures, vehicle_fields, pdf_templates).
--   5. On ajoute `created_by UUID` sur `brouillons` et `factures` pour
--      tracer quel commercial a créé la ligne (backfill = user_id legacy).
--
-- Aucune colonne legacy n'est droppée : tout reste en NULLABLE pour
-- garder un rollback simple.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Garde-fou : refuser si la table concessions n'existe pas
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'concessions'
  ) THEN
    RAISE EXCEPTION 'Table public.concessions introuvable. Exécutez d''abord src/lib/sql_create_concessions.sql.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Créer une concession pour chaque user existant qui n'en a pas encore.
-- ----------------------------------------------------------------------------
INSERT INTO concessions (id, owner_id, nom, created_at)
SELECT
  gen_random_uuid(),
  u.id,
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'concession_name'), ''), 'Ma concession'),
  COALESCE(u.created_at, now())
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM concessions c WHERE c.owner_id = u.id
);

-- ----------------------------------------------------------------------------
-- 2. Inscrire chaque owner comme admin de sa concession.
-- ----------------------------------------------------------------------------
INSERT INTO membres_concession (
  concession_id, user_id, role, prenom, nom, email, actif, created_at
)
SELECT
  c.id,
  c.owner_id,
  'admin',
  NULLIF(TRIM(u.raw_user_meta_data->>'gerant_prenom'), ''),
  NULLIF(TRIM(u.raw_user_meta_data->>'gerant_nom'), ''),
  u.email,
  true,
  COALESCE(c.created_at, now())
FROM concessions c
JOIN auth.users u ON u.id = c.owner_id
ON CONFLICT (concession_id, user_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Ajouter `concession_id` sur les tables qui filtraient par user_id
-- ----------------------------------------------------------------------------

-- 3.a brouillons
ALTER TABLE brouillons
  ADD COLUMN IF NOT EXISTS concession_id UUID REFERENCES concessions(id) ON DELETE CASCADE;
ALTER TABLE brouillons
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE brouillons b
SET concession_id = c.id
FROM concessions c
WHERE b.concession_id IS NULL
  AND b.user_id IS NOT NULL
  AND c.owner_id = b.user_id;

UPDATE brouillons
SET created_by = user_id
WHERE created_by IS NULL AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brouillons_concession_id
  ON brouillons (concession_id);
CREATE INDEX IF NOT EXISTS idx_brouillons_created_by
  ON brouillons (created_by);

-- 3.b abonnements
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'abonnements') THEN
    EXECUTE 'ALTER TABLE abonnements ADD COLUMN IF NOT EXISTS concession_id UUID REFERENCES concessions(id) ON DELETE CASCADE';
    EXECUTE $u$
      UPDATE abonnements a
      SET concession_id = c.id
      FROM concessions c
      WHERE a.concession_id IS NULL
        AND a.user_id IS NOT NULL
        AND c.owner_id = a.user_id
    $u$;
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_abonnements_concession_unique ON abonnements (concession_id) WHERE concession_id IS NOT NULL';
  END IF;
END $$;

-- 3.c profil_concession
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profil_concession') THEN
    EXECUTE 'ALTER TABLE profil_concession ADD COLUMN IF NOT EXISTS concession_id UUID REFERENCES concessions(id) ON DELETE CASCADE';
    EXECUTE $u$
      UPDATE profil_concession p
      SET concession_id = c.id
      FROM concessions c
      WHERE p.concession_id IS NULL
        AND p.user_id IS NOT NULL
        AND c.owner_id = p.user_id
    $u$;
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_profil_concession_unique ON profil_concession (concession_id) WHERE concession_id IS NOT NULL';
  END IF;
END $$;

-- 3.d preferences_formulaire (1 ligne par concession en mode partagé)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'preferences_formulaire') THEN
    EXECUTE 'ALTER TABLE preferences_formulaire ADD COLUMN IF NOT EXISTS concession_id UUID REFERENCES concessions(id) ON DELETE CASCADE';
    EXECUTE $u$
      UPDATE preferences_formulaire p
      SET concession_id = c.id
      FROM concessions c
      WHERE p.concession_id IS NULL
        AND p.user_id IS NOT NULL
        AND c.owner_id = p.user_id
    $u$;
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_preferences_formulaire_concession_unique ON preferences_formulaire (concession_id) WHERE concession_id IS NOT NULL';
  END IF;
END $$;

-- 3.e concession (table singulière héritée — nom/logo affichés dans la sidebar)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'concession') THEN
    EXECUTE 'ALTER TABLE concession ADD COLUMN IF NOT EXISTS concession_id UUID REFERENCES concessions(id) ON DELETE CASCADE';
    EXECUTE $u$
      UPDATE concession p
      SET concession_id = c.id
      FROM concessions c
      WHERE p.concession_id IS NULL
        AND p.user_id IS NOT NULL
        AND c.owner_id = p.user_id
    $u$;
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_concession_concession_unique ON concession (concession_id) WHERE concession_id IS NOT NULL';
  END IF;
END $$;

-- 3.f signature_requests
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signature_requests') THEN
    EXECUTE 'ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS concession_id UUID REFERENCES concessions(id) ON DELETE SET NULL';
    EXECUTE $u$
      UPDATE signature_requests s
      SET concession_id = c.id
      FROM concessions c
      WHERE s.concession_id IS NULL
        AND s.user_id IS NOT NULL
        AND c.owner_id = s.user_id
    $u$;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_signature_requests_concession ON signature_requests (concession_id)';
  END IF;
END $$;

-- 3.f bis relances_config + colonnes de suivi de relance
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signature_requests') THEN
    EXECUTE '
      CREATE TABLE IF NOT EXISTS relances_config (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        concession_id UUID REFERENCES concessions(id) ON DELETE CASCADE,
        actif BOOLEAN DEFAULT true,
        delai_premier_rappel INT DEFAULT 3,
        delai_deuxieme_rappel INT DEFAULT 7,
        message_personnalise TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(concession_id)
      )
    ';
    EXECUTE '
      ALTER TABLE signature_requests
      ADD COLUMN IF NOT EXISTS relance_1_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS relance_2_sent_at TIMESTAMPTZ
    ';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_signature_requests_relance_1_sent_at ON signature_requests (relance_1_sent_at)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_signature_requests_relance_2_sent_at ON signature_requests (relance_2_sent_at)';
  END IF;
END $$;

-- 3.g vendeurs
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vendeurs') THEN
    EXECUTE 'ALTER TABLE vendeurs ADD COLUMN IF NOT EXISTS concession_id UUID REFERENCES concessions(id) ON DELETE CASCADE';
    EXECUTE $u$
      UPDATE vendeurs v
      SET concession_id = c.id
      FROM concessions c
      WHERE v.concession_id IS NULL
        AND v.user_id IS NOT NULL
        AND c.owner_id = v.user_id
    $u$;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vendeurs_concession ON vendeurs (concession_id)';
  END IF;
END $$;

-- 3.h templates (anciens templates JSON par user)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'templates') THEN
    EXECUTE 'ALTER TABLE templates ADD COLUMN IF NOT EXISTS concession_id UUID REFERENCES concessions(id) ON DELETE CASCADE';
    EXECUTE $u$
      UPDATE templates t
      SET concession_id = c.id
      FROM concessions c
      WHERE t.concession_id IS NULL
        AND t.user_id IS NOT NULL
        AND c.owner_id = t.user_id
    $u$;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_templates_concession ON templates (concession_id)';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3.z Ancienne FK sur concession_id → auth.users : à SUPPRIMER avant le remap §4
-- ----------------------------------------------------------------------------
-- Sans cette étape, les UPDATE du §4 échouent avec :
--   violates foreign key constraint "clients_concession_id_fkey"
--   Key (concession_id)=(…) is not present in table "users"
-- car la valeur devient un concessions.id, pas un auth.users.id.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname AS cn, n.nspname AS sch, t.relname AS tbl
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND t.relname IN ('clients', 'stock_vehicules', 'factures', 'vehicle_fields')
      AND pg_get_constraintdef(c.oid) LIKE '%concession_id%'
      AND pg_get_constraintdef(c.oid) LIKE '%auth.users%'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.sch, r.tbl, r.cn);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
    ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_concession_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'stock_vehicules') THEN
    ALTER TABLE public.stock_vehicules DROP CONSTRAINT IF EXISTS stock_vehicules_concession_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'factures') THEN
    ALTER TABLE public.factures DROP CONSTRAINT IF EXISTS factures_concession_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vehicle_fields') THEN
    ALTER TABLE public.vehicle_fields DROP CONSTRAINT IF EXISTS vehicle_fields_concession_id_fkey;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Re-pointer `concession_id` vers concessions.id sur les tables où la
--    colonne existait déjà (mais pointait vers auth.users.id).
-- ----------------------------------------------------------------------------
-- Logique : on remplace concession_id par concessions.id si concession_id
-- correspond actuellement à un auth.users.id (= owner_id d'une concession).
-- L'opération est idempotente : si la valeur est déjà un concessions.id,
-- la sous-requête ne renvoie rien et l'UPDATE ne modifie pas la ligne.

-- 4.a clients
UPDATE clients cl
SET concession_id = c.id
FROM concessions c
WHERE c.owner_id = cl.concession_id
  AND NOT EXISTS (SELECT 1 FROM concessions cc WHERE cc.id = cl.concession_id);

-- 4.b stock_vehicules
UPDATE stock_vehicules sv
SET concession_id = c.id
FROM concessions c
WHERE c.owner_id = sv.concession_id
  AND NOT EXISTS (SELECT 1 FROM concessions cc WHERE cc.id = sv.concession_id);

-- 4.c factures
ALTER TABLE factures
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE factures f
SET concession_id = c.id
FROM concessions c
WHERE c.owner_id = f.concession_id
  AND NOT EXISTS (SELECT 1 FROM concessions cc WHERE cc.id = f.concession_id);

-- Backfill created_by depuis le brouillon source (si présent).
UPDATE factures f
SET created_by = b.created_by
FROM brouillons b
WHERE f.created_by IS NULL
  AND f.brouillon_id = b.id
  AND b.created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_factures_created_by
  ON factures (created_by);

-- 4.d vehicle_fields
UPDATE vehicle_fields vf
SET concession_id = c.id
FROM concessions c
WHERE c.owner_id = vf.concession_id
  AND NOT EXISTS (SELECT 1 FROM concessions cc WHERE cc.id = vf.concession_id);

-- 4.e pdf_templates (colonne dealer_id, pas concession_id)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pdf_templates') THEN
    EXECUTE 'ALTER TABLE pdf_templates ADD COLUMN IF NOT EXISTS concession_id UUID REFERENCES concessions(id) ON DELETE CASCADE';
    EXECUTE $u$
      UPDATE pdf_templates p
      SET concession_id = c.id
      FROM concessions c
      WHERE p.concession_id IS NULL
        AND p.dealer_id IS NOT NULL
        AND c.owner_id = p.dealer_id
    $u$;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pdf_templates_concession ON pdf_templates (concession_id)';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4.rec Recréer les FK concession_id → public.concessions(id) (après remap §4)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'clients'
        AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid) LIKE '%(concession_id)%'
        AND pg_get_constraintdef(c.oid) LIKE '%concessions%'
    ) THEN
      ALTER TABLE public.clients
        ADD CONSTRAINT clients_concession_id_fkey
        FOREIGN KEY (concession_id) REFERENCES public.concessions(id) ON DELETE CASCADE;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'stock_vehicules') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'stock_vehicules'
        AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid) LIKE '%(concession_id)%'
        AND pg_get_constraintdef(c.oid) LIKE '%concessions%'
    ) THEN
      ALTER TABLE public.stock_vehicules
        ADD CONSTRAINT stock_vehicules_concession_id_fkey
        FOREIGN KEY (concession_id) REFERENCES public.concessions(id) ON DELETE CASCADE;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'factures') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'factures'
        AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid) LIKE '%(concession_id)%'
        AND pg_get_constraintdef(c.oid) LIKE '%concessions%'
    ) THEN
      ALTER TABLE public.factures
        ADD CONSTRAINT factures_concession_id_fkey
        FOREIGN KEY (concession_id) REFERENCES public.concessions(id) ON DELETE CASCADE;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vehicle_fields') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'vehicle_fields'
        AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid) LIKE '%(concession_id)%'
        AND pg_get_constraintdef(c.oid) LIKE '%concessions%'
    ) THEN
      ALTER TABLE public.vehicle_fields
        ADD CONSTRAINT vehicle_fields_concession_id_fkey
        FOREIGN KEY (concession_id) REFERENCES public.concessions(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- 3.i cerfas (historique CERFA par concession — optionnel si la table existe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cerfas') THEN
    EXECUTE 'ALTER TABLE cerfas ADD COLUMN IF NOT EXISTS concession_id UUID REFERENCES concessions(id) ON DELETE CASCADE';
    EXECUTE 'ALTER TABLE cerfas ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL';
    EXECUTE $u$
      UPDATE cerfas cef
      SET concession_id = c.id
      FROM concessions c
      WHERE cef.concession_id IS NULL
        AND cef.user_id IS NOT NULL
        AND c.owner_id = cef.user_id
    $u$;
    EXECUTE $u$
      UPDATE cerfas
      SET created_by = user_id
      WHERE created_by IS NULL AND user_id IS NOT NULL
    $u$;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cerfas_concession ON cerfas (concession_id)';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Récap pour debug — décommenter pour voir les compteurs après migration.
-- ----------------------------------------------------------------------------
-- SELECT 'concessions' AS t, count(*) FROM concessions
-- UNION ALL SELECT 'membres_concession', count(*) FROM membres_concession
-- UNION ALL SELECT 'brouillons sans concession_id', count(*) FROM brouillons WHERE concession_id IS NULL
-- UNION ALL SELECT 'clients sans concession_id valide', count(*) FROM clients cl WHERE NOT EXISTS (SELECT 1 FROM concessions c WHERE c.id = cl.concession_id)
-- UNION ALL SELECT 'stock_vehicules sans concession_id valide', count(*) FROM stock_vehicules sv WHERE NOT EXISTS (SELECT 1 FROM concessions c WHERE c.id = sv.concession_id)
-- UNION ALL SELECT 'factures sans concession_id valide', count(*) FROM factures f WHERE NOT EXISTS (SELECT 1 FROM concessions c WHERE c.id = f.concession_id);
