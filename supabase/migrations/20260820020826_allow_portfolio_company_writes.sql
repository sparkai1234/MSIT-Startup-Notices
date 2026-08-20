create policy "public insert companies" on portfolio_companies for insert with check (true);
create policy "public update companies" on portfolio_companies for update using (true);
create policy "public delete companies" on portfolio_companies for delete using (true);
