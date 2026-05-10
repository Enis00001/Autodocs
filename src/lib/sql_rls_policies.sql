-- ============================================================================
-- AutoDocs — Row Level Security (RLS) — modèle multi-utilisateurs.
-- ============================================================================
-- À exécuter UNE fois dans Supabase → SQL Editor, APRÈS :
--   1. src/lib/sql_create_concessions.sql
--   2. src/lib/sql_migrate_to_concessions.sql
-- Idempotent : peut être relancé.
--
-- Modèle :
--   - Toutes les tables métier (brouillons, clients, stock_vehicules,
--     factures, vehicle_fields, pdf_templates, abonnements, profil_concession,
--     preferences_formulaire, templates, vendeurs, concession singulier)
--     filtrent désormais par `concession_id IN (SELECT membres_concession...)`.
--   - Helper `is_membre_concession(uuid)` (SECURITY DEFINER) défini dans
--     sql_create_concessions.sql — évite la récursion infinie.
--   - Sur les tables de configuration (vehicle_fields, pdf_templates,
--     templates, preferences_formulaire), seul l'admin peut INSERT/UPDATE/
--     DELETE. Les commerciaux n'ont qu'un accès LECTURE.
--   - Sur abonnements : SELECT pour tous les membres, UPDATE/DELETE pour
--     admin uniquement (l'app n'écrit jamais directement, c'est le webhook
--     Stripe qui le fait via service_role — bypass RLS).
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
DROP POLICY IF EXISTS "brouillons_select_concession" ON brouillons;
DROP POLICY IF EXISTS "brouillons_insert_concession" ON brouillons;
DROP POLICY IF EXISTS "brouillons_update_concession" ON brouillons;
DROP POLICY IF EXISTS "brouillons_delete_concession" ON brouillons;

CREATE POLICY "brouillons_select_concession" ON brouillons
  FOR SELECT
  USING (public.is_membre_concession(concession_id));

CREATE POLICY "brouillons_insert_concession" ON brouillons
  FOR INSERT
  WITH CHECK (public.is_membre_concession(concession_id));

CREATE POLICY "brouillons_update_concession" ON brouillons
  FOR UPDATE
  USING (public.is_membre_concession(concession_id))
  WITH CHECK (public.is_membre_concession(concession_id));

CREATE POLICY "brouillons_delete_concession" ON brouillons
  FOR DELETE
  USING (public.is_membre_concession(concession_id));

-- ----------------------------------------------------------------------------
-- 2. stock_vehicules
-- ----------------------------------------------------------------------------
ALTER TABLE stock_vehicules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_own_stock"              ON stock_vehicules;
DROP POLICY IF EXISTS "stock_vehicules_select"      ON stock_vehicules;
DROP POLICY IF EXISTS "stock_vehicules_insert"      ON stock_vehicules;
DROP POLICY IF EXISTS "stock_vehicules_update"      ON stock_vehicules;
DROP POLICY IF EXISTS "stock_vehicules_delete"      ON stock_vehicules;

CREATE POLICY "stock_vehicules_select" ON stock_vehicules
  FOR SELECT
  USING (public.is_membre_concession(concession_id));

CREATE POLICY "stock_vehicules_insert" ON stock_vehicules
  FOR INSERT
  WITH CHECK (public.is_membre_concession(concession_id));

CREATE POLICY "stock_vehicules_update" ON stock_vehicules
  FOR UPDATE
  USING (public.is_membre_concession(concession_id))
  WITH CHECK (public.is_membre_concession(concession_id));

CREATE POLICY "stock_vehicules_delete" ON stock_vehicules
  FOR DELETE
  USING (public.is_membre_concession(concession_id));

-- ----------------------------------------------------------------------------
-- 3. clients
-- ----------------------------------------------------------------------------
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_clients"  ON clients;
DROP POLICY IF EXISTS "clients_select"     ON clients;
DROP POLICY IF EXISTS "clients_insert"     ON clients;
DROP POLICY IF EXISTS "clients_update"     ON clients;
DROP POLICY IF EXISTS "clients_delete"     ON clients;

CREATE POLICY "clients_select" ON clients
  FOR SELECT
  USING (public.is_membre_concession(concession_id));

CREATE POLICY "clients_insert" ON clients
  FOR INSERT
  WITH CHECK (public.is_membre_concession(concession_id));

CREATE POLICY "clients_update" ON clients
  FOR UPDATE
  USING (public.is_membre_concession(concession_id))
  WITH CHECK (public.is_membre_concession(concession_id));

CREATE POLICY "clients_delete" ON clients
  FOR DELETE
  USING (public.is_membre_concession(concession_id));

-- ----------------------------------------------------------------------------
-- 4. factures
-- ----------------------------------------------------------------------------
ALTER TABLE factures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_factures" ON factures;
DROP POLICY IF EXISTS "factures_select"    ON factures;
DROP POLICY IF EXISTS "factures_insert"    ON factures;
DROP POLICY IF EXISTS "factures_update"    ON factures;
DROP POLICY IF EXISTS "factures_delete"    ON factures;

CREATE POLICY "factures_select" ON factures
  FOR SELECT
  USING (public.is_membre_concession(concession_id));

CREATE POLICY "factures_insert" ON factures
  FOR INSERT
  WITH CHECK (public.is_membre_concession(concession_id));

CREATE POLICY "factures_update" ON factures
  FOR UPDATE
  USING (public.is_membre_concession(concession_id))
  WITH CHECK (public.is_membre_concession(concession_id));

CREATE POLICY "factures_delete" ON factures
  FOR DELETE
  USING (public.is_membre_concession(concession_id));

-- ----------------------------------------------------------------------------
-- 5. vehicle_fields  (admin-only en écriture)
-- ----------------------------------------------------------------------------
ALTER TABLE vehicle_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_own_fields"             ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_select_own"   ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_insert_own"   ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_update_own"   ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_delete_own"   ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_select"       ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_insert_admin" ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_update_admin" ON vehicle_fields;
DROP POLICY IF EXISTS "vehicle_fields_delete_admin" ON vehicle_fields;

CREATE POLICY "vehicle_fields_select" ON vehicle_fields
  FOR SELECT
  USING (public.is_membre_concession(concession_id));

CREATE POLICY "vehicle_fields_insert_admin" ON vehicle_fields
  FOR INSERT
  WITH CHECK (public.is_admin_concession(concession_id));

CREATE POLICY "vehicle_fields_update_admin" ON vehicle_fields
  FOR UPDATE
  USING (public.is_admin_concession(concession_id))
  WITH CHECK (public.is_admin_concession(concession_id));

CREATE POLICY "vehicle_fields_delete_admin" ON vehicle_fields
  FOR DELETE
  USING (public.is_admin_concession(concession_id));

-- ----------------------------------------------------------------------------
-- 6. pdf_templates  (admin-only en écriture)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pdf_templates') THEN
    EXECUTE 'ALTER TABLE pdf_templates ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "user_own_templates"        ON pdf_templates';
    EXECUTE 'DROP POLICY IF EXISTS "pdf_templates_select_own"  ON pdf_templates';
    EXECUTE 'DROP POLICY IF EXISTS "pdf_templates_select"      ON pdf_templates';
    EXECUTE 'DROP POLICY IF EXISTS "pdf_templates_insert_admin" ON pdf_templates';
    EXECUTE 'DROP POLICY IF EXISTS "pdf_templates_update_admin" ON pdf_templates';
    EXECUTE 'DROP POLICY IF EXISTS "pdf_templates_delete_admin" ON pdf_templates';

    EXECUTE 'CREATE POLICY "pdf_templates_select" ON pdf_templates FOR SELECT USING (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "pdf_templates_insert_admin" ON pdf_templates FOR INSERT WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "pdf_templates_update_admin" ON pdf_templates FOR UPDATE USING (public.is_admin_concession(concession_id)) WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "pdf_templates_delete_admin" ON pdf_templates FOR DELETE USING (public.is_admin_concession(concession_id))';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. templates (anciens templates JSON)  — admin-only en écriture
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'templates') THEN
    EXECUTE 'ALTER TABLE templates ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "user_own_templates_light" ON templates';
    EXECUTE 'DROP POLICY IF EXISTS "templates_select"         ON templates';
    EXECUTE 'DROP POLICY IF EXISTS "templates_insert_admin"   ON templates';
    EXECUTE 'DROP POLICY IF EXISTS "templates_update_admin"   ON templates';
    EXECUTE 'DROP POLICY IF EXISTS "templates_delete_admin"   ON templates';

    EXECUTE 'CREATE POLICY "templates_select" ON templates FOR SELECT USING (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "templates_insert_admin" ON templates FOR INSERT WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "templates_update_admin" ON templates FOR UPDATE USING (public.is_admin_concession(concession_id)) WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "templates_delete_admin" ON templates FOR DELETE USING (public.is_admin_concession(concession_id))';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 8. preferences_formulaire  (admin-only en écriture)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'preferences_formulaire') THEN
    EXECUTE 'ALTER TABLE preferences_formulaire ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "user_own_preferences"              ON preferences_formulaire';
    EXECUTE 'DROP POLICY IF EXISTS "preferences_formulaire_select"     ON preferences_formulaire';
    EXECUTE 'DROP POLICY IF EXISTS "preferences_formulaire_insert_admin" ON preferences_formulaire';
    EXECUTE 'DROP POLICY IF EXISTS "preferences_formulaire_update_admin" ON preferences_formulaire';
    EXECUTE 'DROP POLICY IF EXISTS "preferences_formulaire_delete_admin" ON preferences_formulaire';

    EXECUTE 'CREATE POLICY "preferences_formulaire_select" ON preferences_formulaire FOR SELECT USING (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "preferences_formulaire_insert_admin" ON preferences_formulaire FOR INSERT WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "preferences_formulaire_update_admin" ON preferences_formulaire FOR UPDATE USING (public.is_admin_concession(concession_id)) WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "preferences_formulaire_delete_admin" ON preferences_formulaire FOR DELETE USING (public.is_admin_concession(concession_id))';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 9. profil_concession  (admin-only en écriture)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profil_concession') THEN
    EXECUTE 'ALTER TABLE profil_concession ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "user_own_profil_concession"        ON profil_concession';
    EXECUTE 'DROP POLICY IF EXISTS "profil_concession_select"          ON profil_concession';
    EXECUTE 'DROP POLICY IF EXISTS "profil_concession_insert_admin"    ON profil_concession';
    EXECUTE 'DROP POLICY IF EXISTS "profil_concession_update_admin"    ON profil_concession';
    EXECUTE 'DROP POLICY IF EXISTS "profil_concession_delete_admin"    ON profil_concession';

    EXECUTE 'CREATE POLICY "profil_concession_select" ON profil_concession FOR SELECT USING (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "profil_concession_insert_admin" ON profil_concession FOR INSERT WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "profil_concession_update_admin" ON profil_concession FOR UPDATE USING (public.is_admin_concession(concession_id)) WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "profil_concession_delete_admin" ON profil_concession FOR DELETE USING (public.is_admin_concession(concession_id))';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 10. concession (table singulière héritée pour nom/logo sidebar)
--     Lecture pour tous, écriture admin-only.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'concession') THEN
    EXECUTE 'ALTER TABLE concession ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "user_own_concession"        ON concession';
    EXECUTE 'DROP POLICY IF EXISTS "concession_select"          ON concession';
    EXECUTE 'DROP POLICY IF EXISTS "concession_insert_admin"    ON concession';
    EXECUTE 'DROP POLICY IF EXISTS "concession_update_admin"    ON concession';
    EXECUTE 'DROP POLICY IF EXISTS "concession_delete_admin"    ON concession';

    EXECUTE 'CREATE POLICY "concession_select" ON concession FOR SELECT USING (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "concession_insert_admin" ON concession FOR INSERT WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "concession_update_admin" ON concession FOR UPDATE USING (public.is_admin_concession(concession_id)) WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "concession_delete_admin" ON concession FOR DELETE USING (public.is_admin_concession(concession_id))';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 11. abonnements  (lecture par tous les membres, écriture admin only)
--     NB : le webhook Stripe utilise service_role et bypass RLS.
-- ----------------------------------------------------------------------------
ALTER TABLE abonnements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_own_abonnements"        ON abonnements;
DROP POLICY IF EXISTS "user_read_own_subscription"  ON abonnements;
DROP POLICY IF EXISTS "abonnements_select"          ON abonnements;
DROP POLICY IF EXISTS "abonnements_insert_admin"    ON abonnements;
DROP POLICY IF EXISTS "abonnements_update_admin"    ON abonnements;
DROP POLICY IF EXISTS "abonnements_delete_admin"    ON abonnements;

CREATE POLICY "abonnements_select" ON abonnements
  FOR SELECT
  USING (public.is_membre_concession(concession_id));

CREATE POLICY "abonnements_insert_admin" ON abonnements
  FOR INSERT
  WITH CHECK (public.is_admin_concession(concession_id));

CREATE POLICY "abonnements_update_admin" ON abonnements
  FOR UPDATE
  USING (public.is_admin_concession(concession_id))
  WITH CHECK (public.is_admin_concession(concession_id));

CREATE POLICY "abonnements_delete_admin" ON abonnements
  FOR DELETE
  USING (public.is_admin_concession(concession_id));

-- ----------------------------------------------------------------------------
-- 11bis. relances_config (lecture membres, écriture admin)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'relances_config') THEN
    EXECUTE 'ALTER TABLE relances_config ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "relances_config_select" ON relances_config';
    EXECUTE 'DROP POLICY IF EXISTS "relances_config_insert_admin" ON relances_config';
    EXECUTE 'DROP POLICY IF EXISTS "relances_config_update_admin" ON relances_config';
    EXECUTE 'DROP POLICY IF EXISTS "relances_config_delete_admin" ON relances_config';

    EXECUTE 'CREATE POLICY "relances_config_select" ON relances_config FOR SELECT USING (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "relances_config_insert_admin" ON relances_config FOR INSERT WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "relances_config_update_admin" ON relances_config FOR UPDATE USING (public.is_admin_concession(concession_id)) WITH CHECK (public.is_admin_concession(concession_id))';
    EXECUTE 'CREATE POLICY "relances_config_delete_admin" ON relances_config FOR DELETE USING (public.is_admin_concession(concession_id))';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 12. vendeurs  (membre actif en écriture, partagé)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vendeurs') THEN
    EXECUTE 'ALTER TABLE vendeurs ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "user_own_vendeurs"   ON vendeurs';
    EXECUTE 'DROP POLICY IF EXISTS "vendeurs_select"     ON vendeurs';
    EXECUTE 'DROP POLICY IF EXISTS "vendeurs_insert"     ON vendeurs';
    EXECUTE 'DROP POLICY IF EXISTS "vendeurs_update"     ON vendeurs';
    EXECUTE 'DROP POLICY IF EXISTS "vendeurs_delete"     ON vendeurs';

    EXECUTE 'CREATE POLICY "vendeurs_select" ON vendeurs FOR SELECT USING (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "vendeurs_insert" ON vendeurs FOR INSERT WITH CHECK (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "vendeurs_update" ON vendeurs FOR UPDATE USING (public.is_membre_concession(concession_id)) WITH CHECK (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "vendeurs_delete" ON vendeurs FOR DELETE USING (public.is_membre_concession(concession_id))';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 12bis. cerfas (historique CERFA — partagé entre membres de la concession)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cerfas') THEN
    EXECUTE 'ALTER TABLE cerfas ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "cerfas_select_concession" ON cerfas';
    EXECUTE 'DROP POLICY IF EXISTS "cerfas_insert_concession" ON cerfas';
    EXECUTE 'DROP POLICY IF EXISTS "cerfas_update_concession" ON cerfas';
    EXECUTE 'DROP POLICY IF EXISTS "cerfas_delete_concession" ON cerfas';

    EXECUTE 'CREATE POLICY "cerfas_select_concession" ON cerfas FOR SELECT USING (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "cerfas_insert_concession" ON cerfas FOR INSERT WITH CHECK (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "cerfas_update_concession" ON cerfas FOR UPDATE USING (public.is_membre_concession(concession_id)) WITH CHECK (public.is_membre_concession(concession_id))';
    EXECUTE 'CREATE POLICY "cerfas_delete_concession" ON cerfas FOR DELETE USING (public.is_membre_concession(concession_id))';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 13. signature_requests (RLS désactivée — signature publique via token)
--     Aucune policy nécessaire : les API serveur utilisent service_role,
--     et l'API publique /signer/:token expose la ligne via le token UUID v4
--     qui sert de secret. On laisse RLS DISABLED comme avant.
-- ----------------------------------------------------------------------------
ALTER TABLE signature_requests DISABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 14. Storage bucket pdf-templates — policies basées sur is_membre_concession
--     Le path d'upload est désormais `{concession_id}/...` au lieu de
--     `{user_id}/...`. Ancienne migration : on garde les deux possibilités
--     (user_id ou concession_id en première composante de path).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "pdf_templates_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "pdf_templates_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "pdf_templates_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "pdf_templates_storage_delete" ON storage.objects;

CREATE POLICY "pdf_templates_storage_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'pdf-templates'
  AND (
    -- Ancien chemin : {user_id}/...
    (storage.foldername(name))[1] = auth.uid()::text
    -- Nouveau chemin : {concession_id}/... (admin only)
    OR public.is_admin_concession(((storage.foldername(name))[1])::uuid)
  )
);

CREATE POLICY "pdf_templates_storage_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'pdf-templates'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_membre_concession(((storage.foldername(name))[1])::uuid)
  )
);

CREATE POLICY "pdf_templates_storage_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'pdf-templates'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_admin_concession(((storage.foldername(name))[1])::uuid)
  )
);

CREATE POLICY "pdf_templates_storage_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'pdf-templates'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_admin_concession(((storage.foldername(name))[1])::uuid)
  )
);
