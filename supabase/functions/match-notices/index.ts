import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const MODEL = "gemini-3.6-flash";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-admin-secret",
};

const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");

async function scoreMatch(notice: any, company: any) {
  const prompt = `You evaluate whether a Korean government (MSIT) notice is relevant to a startup.

Notice:
Title: ${notice.title}
Department: ${notice.dept ?? "unknown"}
Body: ${(notice.body_text ?? "").slice(0, 3000)}

Company:
Name: ${company.name}
Sector: ${company.sector ?? "unknown"}
Description: ${company.description ?? "unknown"}
Keywords: ${(company.keywords ?? []).join(", ")}

Score relevance 0-100 (0 = not relevant at all, 100 = directly applicable, e.g. a grant/support program this company should apply to).
Respond ONLY with JSON: {"score": <int>, "rationale": "<one sentence in Korean>"}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { score: 0, rationale: "parse error" };
  return { score: Math.max(0, Math.min(100, Math.round(parsed.score ?? 0))), rationale: parsed.rationale ?? "" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (ADMIN_SECRET && req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS_HEADERS });
  }

  let params: { limitPairs?: number; noticeLimit?: number } = {};
  try {
    params = await req.json();
  } catch {
    // defaults
  }
  const limitPairs = params.limitPairs ?? 15;
  const noticeLimit = params.noticeLimit ?? 50;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: companies, error: cErr } = await supabase
    .from("portfolio_companies")
    .select("*")
    .eq("active", true);
  if (cErr) return new Response(JSON.stringify({ error: cErr.message }), { status: 500, headers: CORS_HEADERS });
  if (!companies || companies.length === 0) {
    return new Response(JSON.stringify({ message: "no active portfolio companies", scored: 0, remaining: 0 }), { headers: CORS_HEADERS });
  }

  const { data: existingMatches } = await supabase
    .from("notice_matches")
    .select("notice_id, company_id");
  const matchedSet = new Set((existingMatches ?? []).map((m) => `${m.notice_id}:${m.company_id}`));

  const { data: notices, error: nErr } = await supabase
    .from("notices")
    .select("*")
    .or("application_status.is.null,application_status.neq.closed")
    .order("posted_at", { ascending: false })
    .limit(noticeLimit);
  if (nErr) return new Response(JSON.stringify({ error: nErr.message }), { status: 500, headers: CORS_HEADERS });

  const pending: { notice: any; company: any }[] = [];
  for (const notice of notices ?? []) {
    for (const company of companies) {
      const key = `${notice.id}:${company.id}`;
      if (!matchedSet.has(key)) pending.push({ notice, company });
    }
  }

  const batch = pending.slice(0, limitPairs);
  let scored = 0;
  const errors: string[] = [];

  for (const { notice, company } of batch) {
    try {
      const { score, rationale } = await scoreMatch(notice, company);
      await supabase.from("notice_matches").insert({
        notice_id: notice.id,
        company_id: company.id,
        relevance_score: score,
        rationale,
        model: MODEL,
      });
      scored++;
    } catch (e) {
      errors.push(`notice=${notice.id} company=${company.id}: ${String(e)}`);
    }
  }

  return new Response(
    JSON.stringify({ scored, remaining: pending.length - batch.length, errors }),
    { headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
});
