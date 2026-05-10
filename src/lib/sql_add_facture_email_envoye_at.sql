-- AutoDocs — migration : trace l'horodatage d'envoi de la facture par email.
-- Idempotente : peut être ré-exécutée sans effet de bord.
--
-- À exécuter dans le SQL editor Supabase. Aucun changement de RLS :
-- la table `factures` est déjà filtrée par `concession_id = auth.uid()`
-- (cf. sql_create_factures.sql / sql_rls_policies.sql).

ALTER TABLE factures
  ADD COLUMN IF NOT EXISTS email_envoye_at TIMESTAMPTZ;

COMMENT ON COLUMN factures.email_envoye_at IS
  'Date/heure du dernier envoi par email de la facture au client (NULL si jamais envoyée).';
