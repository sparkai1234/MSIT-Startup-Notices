select cron.schedule(
  'match-msit-notices',
  '45 */6 * * *',
  $$
  select net.http_post(
    url := 'https://kxumdmcscyfxxytrugnb.supabase.co/functions/v1/match-notices',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
