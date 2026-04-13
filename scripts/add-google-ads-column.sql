-- Add has_google_ads column to leads for Google Ads upsell intelligence
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_google_ads BOOLEAN DEFAULT false;
