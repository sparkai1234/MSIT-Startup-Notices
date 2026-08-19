import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const EMBED_MODEL = "gemini-embedding-001";

async function embedText(text: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini embed error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const values = data.embedding?.values;
  if (!Array.isArray(values)) throw new Error("no embedding values in response");
  return values;
}

function noticeToEmbeddingText(n: any): string {
  return [
    n.title,
    n.dept,
    n.support_type,
    n.eligibility,
    n.total_budget,
    n.support_cap_per_company,
    n.project_period,
    (n.body_text ?? "").slice(0, 2000),
  ]
    .filter(Boolean)
    .join("\n");
}

Deno.serve(async (req: Request) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let params: { limit?: number } = {};
  try {
    params = await req.json();
  } catch {
    // defaults
  }
  const limit = params.limit ?? 30;

  const { data: notices, error } = await supabase
    .from("notices")
    .select("*")
    .is("embedding", null)
    .order("posted_at", { ascending: false })
    .limit(limit);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let embedded = 0;
  const errors: string[] = [];

  for (const notice of notices ?? []) {
    try {
      const vector = await embedText(noticeToEmbeddingText(notice));
      const { error: updErr } = await supabase
        .from("notices")
        .update({ embedding: vector, embedded_at: new Date().toISOString() })
        .eq("id", notice.id);
      if (updErr) throw new Error(updErr.message);
      embedded++;
    } catch (e) {
      errors.push(`notice=${notice.id}: ${String(e)}`);
    }
  }

  return new Response(JSON.stringify({ embedded, checked: (notices ?? []).length, errors }), {
    headers: { "Content-Type": "application/json" },
  });
});
