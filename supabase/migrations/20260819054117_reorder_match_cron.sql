-- Reschedule matching to run after extraction finishes each cycle instead of before it.
select cron.unschedule('match-msit-notices');

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
