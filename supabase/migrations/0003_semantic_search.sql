create extension if not exists vector;

alter table notices add column if not exists embedding vector(768);
alter table notices add column if not exists embedded_at timestamptz;

create index if not exists idx_notices_embedding on notices using hnsw (embedding vector_cosine_ops);

create or replace function match_notices(query_embedding vector(768), match_count int default 20)
returns setof notices
language sql stable
as $$
  select *
  from notices
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Replace <PROJECT_REF> with your project's ref before applying.
select cron.schedule(
  'embed-msit-notices',
  '50 */6 * * *',
  $cron$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/embed-notices',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"limit": 20}'::jsonb
  );
  $cron$
);
