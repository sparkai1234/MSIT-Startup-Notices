alter table notices enable row level security;
alter table portfolio_companies enable row level security;
alter table notice_matches enable row level security;
alter table scrape_runs enable row level security;

create policy "public read notices" on notices for select using (true);
create policy "public read companies" on portfolio_companies for select using (true);
create policy "public read matches" on notice_matches for select using (true);
