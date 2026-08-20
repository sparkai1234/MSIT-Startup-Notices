select cron.schedule(
  'scrape-msit-notices',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://kxumdmcscyfxxytrugnb.supabase.co/functions/v1/scrape-notices',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
