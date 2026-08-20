import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-admin-secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (ADMIN_SECRET && req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS_HEADERS });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { action?: string; companies?: { name: string; description?: string | null }[]; id?: number } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400, headers: CORS_HEADERS });
  }

  try {
    if (body.action === "add") {
      if (!Array.isArray(body.companies) || body.companies.length === 0) {
        return new Response(JSON.stringify({ error: "companies array required" }), { status: 400, headers: CORS_HEADERS });
      }
      const rows = body.companies
        .filter((c) => c?.name?.trim())
        .map((c) => ({ name: c.name.trim(), description: c.description?.trim() || null }));
      const { data, error } = await supabase.from("portfolio_companies").insert(rows).select();
      if (error) throw error;
      return new Response(JSON.stringify({ added: data?.length ?? 0 }), { headers: CORS_HEADERS });
    }

    if (body.action === "delete") {
      if (!body.id) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: CORS_HEADERS });
      const { error } = await supabase.from("portfolio_companies").delete().eq("id", body.id);
      if (error) throw error;
      return new Response(JSON.stringify({ deleted: true }), { headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: CORS_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS_HEADERS });
  }
});
