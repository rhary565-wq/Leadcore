-- ═══════════════════════════════════════════════════════════════════
-- LeadGen — Company Enrichment Schema Migration
-- Run this once in the Supabase SQL editor before deploying
-- ═══════════════════════════════════════════════════════════════════

-- ── leads: Apollo company enrichment + HubSpot Company link ─────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS apollo_company_id          TEXT,
  ADD COLUMN IF NOT EXISTS apollo_headcount           INTEGER,
  ADD COLUMN IF NOT EXISTS apollo_revenue             BIGINT,
  ADD COLUMN IF NOT EXISTS apollo_revenue_range       TEXT,
  ADD COLUMN IF NOT EXISTS apollo_company_enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dbd_url                    TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_company_id         TEXT;

-- ── key_contacts: contact location + apollo company source link ──────────────
ALTER TABLE key_contacts
  ADD COLUMN IF NOT EXISTS contact_location  TEXT,
  ADD COLUMN IF NOT EXISTS apollo_company_id TEXT;

-- ── scrape_jobs: temporary storage for large Apify payloads ─────────────────
-- Bypasses Cloud Tasks 1 MB payload limit for large result sets (>500 records).
-- raw_data and contacts_data are cleared by clean worker after processing.
ALTER TABLE scrape_jobs
  ADD COLUMN IF NOT EXISTS raw_data      JSONB,
  ADD COLUMN IF NOT EXISTS contacts_data JSONB;

-- ── scrape_jobs: last_error — surface pipeline errors without needing GCP logs
ALTER TABLE scrape_jobs
  ADD COLUMN IF NOT EXISTS last_error TEXT;
