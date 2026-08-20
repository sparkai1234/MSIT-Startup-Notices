-- Re-schedule all 4 background jobs to include the admin secret header.
-- NOTE: the actual secret value lives only in Supabase's pg_cron job definitions and
-- the ADMIN_SECRET edge function secret — never commit the real value to a public repo.
-- This file documents the shape; the live cron jobs were updated directly via migration.
select cron.unschedule('scrape-msit-notices');
select cron.schedule(
  'scrape-msit-notices',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://kxumdmcscyfxxytrugnb.supabase.co/functions/v1/scrape-notices',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-admin-secret', current_setting('app.admin_secret', true))
  );
  $$
);

select cron.unschedule('extract-msit-notice-details');
select cron.schedule(
  'extract-msit-notice-details',
  '30 */6 * * *',
  $$
  select net.http_post(
    url := 'https://kxumdmcscyfxxytrugnb.supabase.co/functions/v1/extract-details',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-admin-secret', current_setting('app.admin_secret', true)),
    body := '{"limit": 20}'::jsonb
  );
  $$
);

select cron.unschedule('match-msit-notices');
select cron.schedule(
  'match-msit-notices',
  '45 */6 * * *',
  $$
  select net.http_post(
    url := 'https://kxumdmcscyfxxytrugnb.supabase.co/functions/v1/match-notices',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-admin-secret', current_setting('app.admin_secret', true))
  );
  $$
);

select cron.unschedule('embed-msit-notices');
select cron.schedule(
  'embed-msit-notices',
  '50 */6 * * *',
  $$
  select net.http_post(
    url := 'https://kxumdmcscyfxxytrugnb.supabase.co/functions/v1/embed-notices',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-admin-secret', current_setting('app.admin_secret', true)),
    body := '{"limit": 20}'::jsonb
  );
  $$
);

-- Portfolio company writes now go through the manage-portfolio edge function (service role + secret),
-- not directly from the browser with the anon key.
drop policy if exists "public insert companies" on portfolio_companies;
drop policy if exists "public update companies" on portfolio_companies;
drop policy if exists "public delete companies" on portfolio_companies;
