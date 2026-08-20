select cron.schedule(
  'embed-msit-notices',
  '50 */6 * * *',
  $$
  select net.http_post(
    url := 'https://kxumdmcscyfxxytrugnb.supabase.co/functions/v1/embed-notices',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"limit": 20}'::jsonb
  );
  $$
);
