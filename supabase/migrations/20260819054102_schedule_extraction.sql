select cron.schedule(
  'extract-msit-notice-details',
  '30 */6 * * *',
  $$
  select net.http_post(
    url := 'https://kxumdmcscyfxxytrugnb.supabase.co/functions/v1/extract-details',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"limit": 20}'::jsonb
  );
  $$
);
