-- Add search_city column to leads table
-- This stores the exact city string used in the Google Places query,
-- enabling accurate queue deduplication in autonomous mode.
--
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/mspcsaoormomqdzyobew/sql

ALTER TABLE leads ADD COLUMN IF NOT EXISTS search_city text;

-- Backfill existing leads: copy city to search_city where null
UPDATE leads SET search_city = city WHERE search_city IS NULL;

-- Create index for queue generation performance
CREATE INDEX IF NOT EXISTS idx_leads_niche_search_city ON leads(niche, search_city);
