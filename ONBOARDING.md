# MSIT Startup Notices — Onboarding

## What this is

An internal Sparklabs tool that automatically tracks Korean government (MSIT, 과학기술정보통신부)
business-support notices, extracts structured details (budget, eligibility, deadlines) using
Gemini, and scores relevance against Sparklabs' portfolio companies for matching.

**Live site**: https://msit-startup-notices.vercel.app

## Architecture — three separate services

| Service | What it does | Access needed to edit |
|---|---|---|
| **Supabase** (`kxumdmcscyfxxytrugnb`) | Database + backend logic. Runs 4 automated jobs every 6 hours: scrape MSIT → extract details via Gemini → embed for search → match against portfolio companies. This is the actual "brain" — it runs on its own even with nobody watching. | Supabase dashboard → org → invite as member |
| **GitHub** (`sparkai1234/MSIT-Startup-Notices`, public repo) | Stores all source code: the website and the 6 edge functions. Version history / backup. | Repo → Settings → Collaborators |
| **Vercel** | Hosts the live website, auto-deploys on every `git push` to `main`. | Vercel project → Settings → Members |

**Important**: getting access to one of these does NOT give you access to the others. A new
maintainer needs to be added to all three separately.

## Secrets

None of these are in the code (the GitHub repo is public) — they live only in Supabase's
Edge Function secrets (Project Settings → Edge Functions → Secrets):

- `GEMINI_API_KEY` — Google Gemini API key. All AI calls (extraction, embeddings, matching) are
  billed to this key's Google Cloud project. **If this runs out of prepaid credits, the whole
  pipeline silently stops working** (functions return a 429 "credits depleted" error). Check/refill
  at [ai.studio/projects](https://ai.studio/projects) — make sure you're topping up the *same*
  project this specific key belongs to, not just any project.
- `SUPABASE_SERVICE_ROLE_KEY` — auto-provided by Supabase, full DB access, bypasses RLS. Never
  put this in frontend code.
- `ADMIN_SECRET` — a shared password (currently `Hippopotamus@sparklabs`) required to add/delete
  portfolio companies and to trigger the background jobs manually. Running semantic search and
  running matching (매칭 실행) do NOT require it — those are open to anyone using the site,
  including people at portfolio companies.

The Supabase anon key embedded in `web/index.html` is meant to be public — it's how any static
site talks to Supabase. Security comes from Row Level Security policies, not from hiding that key.

## The pipeline (cron jobs, every 6 hours)

1. **`:00` `scrape-notices`** — checks page 1 of MSIT's 사업공고 board, inserts anything new
   (deduped by `ntt_seq_no`)
2. **`:30` `extract-details`** — for notices without extracted fields yet, downloads attached
   `.hwpx`/`.zip` documents, pulls out full text (including tables), asks Gemini to extract
   budget/eligibility/deadline/etc.
3. **`:45` `match-notices`** — scores relevance (0-100) between recent notices and each active
   portfolio company via Gemini
4. **`:50` `embed-notices`** — generates a semantic-search vector embedding for new notices

All 4 only process notices from the **last 1 year** (`sinceDays` parameter, currently 365) —
this was intentionally narrowed down from 3 years to control Gemini cost. To change the window,
update the `sinceDays` default in `supabase/functions/extract-details/index.ts` and
`embed-notices/index.ts`, plus the cutoff calculation in `web/index.html`.

## Database schema

- `notices` — every scraped notice + extracted structured fields + embedding vector
- `portfolio_companies` — name + description (used for AI matching — the more specific the
  description, the better the match quality)
- `notice_matches` — relevance scores between notices and companies
- `scrape_runs` — log of each scrape attempt

Migrations live in `supabase/migrations/`, named to exactly match Supabase's internal tracked
history (10 files as of writing). **Do not rename or renumber these** — Supabase's GitHub
integration matches migrations by filename, not content, so mismatched names will cause it to
try re-running already-applied migrations and fail.

## Known limitations / things to watch

- **Gemini quota**: extraction/embedding/matching all cost real money per call. If Gemini
  credits run out mid-backfill, functions fail with 429s but don't crash anything — just retry
  once credits are topped up.
- **Scraper is HTML-scraping-based**: it parses `msit.go.kr`'s raw page structure (regex on
  inline JS). If MSIT changes their site layout, the scraper will likely break silently
  (stop finding new notices) rather than error loudly. Worth periodically checking
  `scrape_runs` table for anomalies (e.g. `notices_found: 0` on a run).
- **`.hwpx`/`.hwp` parsing**: Korean government documents use a proprietary format. The
  extraction function has custom XML parsing for this (see `extractHwpxText` /
  `tableToText` in `extract-details/index.ts`) including handling `.hwpx` files nested inside
  plain `.zip` attachments. This is fragile — if a document's structure doesn't match, extraction
  quietly returns "not stated" fields rather than erroring.
- **No user authentication system** — the whole site is open/public with the ADMIN_SECRET as
  the only gate on sensitive actions. Fine for the current scale; would need real auth
  (Supabase Auth) if this grows into a broader multi-user product.

## Making changes

Ask an AI coding assistant (e.g. Claude Code) with access to this repo and the Supabase project —
that's how this was built. Point it at this file plus the actual code for context. All edge
function code lives in `supabase/functions/*/index.ts`; the whole frontend is one file,
`web/index.html`.
