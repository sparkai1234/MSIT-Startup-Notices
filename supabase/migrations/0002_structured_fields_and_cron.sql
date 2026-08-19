alter table notices add column if not exists total_budget text;
alter table notices add column if not exists support_cap_per_company text;
alter table notices add column if not exists self_funding_ratio text;
alter table notices add column if not exists actual_support_amount text;
alter table notices add column if not exists support_type text;
alter table notices add column if not exists payment_method text;
alter table notices add column if not exists selection_scale text;
alter table notices add column if not exists project_period text;
alter table notices add column if not exists eligibility text;
alter table notices add column if not exists application_deadline date;
alter table notices add column if not exists application_status text; -- upcoming | open | closed | unknown
alter table notices add column if not exists extraction_notes text;
alter table notices add column if not exists extracted_at timestamptz;
alter table notices add column if not exists extraction_model text;

create index if not exists idx_notices_deadline on notices(application_deadline);
create index if not exists idx_notices_status on notices(application_status);

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace <PROJECT_REF> with your project's ref before applying.
select cron.schedule(
  'scrape-msit-notices',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/scrape-notices',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);

select cron.schedule(
  'extract-msit-notice-details',
  '30 */6 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/extract-details',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"limit": 20}'::jsonb
  );
  $$
);

select cron.schedule(
  'match-msit-notices',
  '45 */6 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/match-notices',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
