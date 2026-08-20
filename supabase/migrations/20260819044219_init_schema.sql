create table notices (
  id bigserial primary key,
  ntt_seq_no text not null,
  bbs_seq_no text not null,
  board text not null,
  title text not null,
  dept text,
  contact_name text,
  contact_phone text,
  posted_at date,
  detail_url text not null,
  raw_html text,
  body_text text,
  attachments jsonb default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  unique(board, ntt_seq_no)
);

create table portfolio_companies (
  id bigserial primary key,
  name text not null,
  name_kr text,
  sector text,
  description text,
  keywords text[] default '{}',
  website text,
  active boolean default true,
  created_at timestamptz not null default now()
);

create table notice_matches (
  id bigserial primary key,
  notice_id bigint not null references notices(id) on delete cascade,
  company_id bigint not null references portfolio_companies(id) on delete cascade,
  relevance_score int not null check (relevance_score between 0 and 100),
  rationale text,
  model text,
  matched_at timestamptz not null default now(),
  unique(notice_id, company_id)
);

create table scrape_runs (
  id bigserial primary key,
  board text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  notices_found int default 0,
  notices_new int default 0,
  ok boolean,
  error text
);
