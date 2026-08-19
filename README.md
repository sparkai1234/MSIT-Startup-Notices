# MSIT Startup Notice Matcher

Scrapes 사업공고 (business support notices) from the Korean Ministry of Science and ICT (msit.go.kr), extracts structured details (budget, eligibility, deadline, etc.) via Gemini, and scores relevance against Sparklabs' portfolio companies.

## Structure

- `supabase/migrations/` — schema (`notices`, `portfolio_companies`, `notice_matches`, `scrape_runs`) and cron schedules
- `supabase/functions/scrape-notices/` — scrapes msit.go.kr, paginated (`{ "startPage": 1, "pageCount": 5 }`)
- `supabase/functions/extract-details/` — extracts structured fields (budget/eligibility/deadline/etc.) from notice body + attached `.hwpx` files, via Gemini (`{ "limit": 20, "sinceDays": 365 }`)
- `supabase/functions/match-notices/` — scores each notice against each active portfolio company via Gemini (0-100 relevance + rationale)
- `web/index.html` — single-page frontend reading directly from Supabase's REST API (anon key, read-only)

## Setup

1. Create a Supabase project, run the migrations in `supabase/migrations/` in order (replace `<PROJECT_REF>` in `0002_...sql` with your project ref)
2. Set the `GEMINI_API_KEY` secret in your project's Edge Function secrets
3. Deploy the three functions in `supabase/functions/` (e.g. via `supabase functions deploy <name>`)
4. Add rows to `portfolio_companies` (name, sector, description, keywords)
5. Update `SUPABASE_URL` / `ANON_KEY` in `web/index.html` to match your project, then host it anywhere static

## Notes

- Scraper only targets the 사업공고 board (mId=311, mPid=121) — other MSIT boards were intentionally dropped
- `extract-details` skips notices whose title is obviously a results/selection announcement (never an open application) without spending an API call
- `extract-details` and `match-notices` skip notices already marked `closed`, and default to only looking at the last 365 days of postings, to control Gemini API cost
