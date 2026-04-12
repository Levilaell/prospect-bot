-- Add email_subject column for storing per-lead generated email subject lines (US cold email)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_subject TEXT;

-- Add country column for explicit market tracking (BR, US)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS country TEXT;

-- Backfill country based on existing outreach_channel data
UPDATE leads SET country = 'BR' WHERE country IS NULL AND outreach_channel = 'whatsapp';
UPDATE leads SET country = 'US' WHERE country IS NULL AND outreach_channel = 'email';
