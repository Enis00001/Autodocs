-- Colonne facultative pour l'adresse postale complète du client (facture / CRM).
-- À exécuter dans Supabase → SQL Editor (idempotent).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS adresse TEXT;
