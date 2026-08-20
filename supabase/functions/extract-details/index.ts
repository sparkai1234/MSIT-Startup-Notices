import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const MODEL = "gemini-3.6-flash";

const SCHEMA_FIELDS = [
  "total_budget",
  "support_cap_per_company",
  "self_funding_ratio",
  "actual_support_amount",
  "support_type",
  "payment_method",
  "selection_scale",
  "project_period",
  "eligibility",
  "application_deadline",
  "application_status",
];

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const RUN_RE = /<hp:t(?:\s[^>]*)?>([^<]*)<\/hp:t>/g;

function runText(chunk: string): string {
  let text = "";
  let m: RegExpExecArray | null;
  RUN_RE.lastIndex = 0;
  while ((m = RUN_RE.exec(chunk)) !== null) text += m[1];
  return decodeXmlEntities(text).trim();
}

function paragraphsToLines(xml: string): string[] {
  const lines: string[] = [];
  for (const p of xml.split(/<hp:p\s/)) {
    const line = runText(p);
    if (line) lines.push(line);
  }
  return lines;
}

// A schedule/deadline is often in a table (<hp:tbl>/<hp:tr>/<hp:tc>), not plain prose.
// Flattening every <hp:p> in document order scrambles header cells and value cells
// together, losing which date belongs to which phase — so tables are rendered as
// "col1 | col2 | ..." rows instead, matching how the source actually pairs them.
function tableToText(tblXml: string): string {
  const rows: string[] = [];
  const rowRe = /<hp:tr[^>]*>([\s\S]*?)<\/hp:tr>/g;
  const cellRe = /<hp:tc[^>]*>([\s\S]*?)<\/hp:tc>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tblXml)) !== null) {
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(paragraphsToLines(cellMatch[1]).join(" "));
    }
    if (cells.some(Boolean)) rows.push(cells.join(" | "));
  }
  return rows.length ? "[표]\n" + rows.join("\n") : "";
}

// hwpx section XML: text lives in <hp:t> runs inside <hp:p> paragraphs, with
// <hp:tbl> tables needing separate row/column-aware handling (see tableToText).
// Preview/PrvText.txt is capped short, so read the full section body instead.
function hwpxSectionXmlToText(xml: string): string {
  const parts = xml.split(/(<hp:tbl[\s\S]*?<\/hp:tbl>)/);
  const lines: string[] = [];
  for (const part of parts) {
    if (part.startsWith("<hp:tbl")) {
      const rendered = tableToText(part);
      if (rendered) lines.push(rendered);
    } else {
      lines.push(...paragraphsToLines(part));
    }
  }
  return lines.join("\n");
}

async function hwpxBufferToText(buf: ArrayBuffer): Promise<string | null> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const sectionFiles = Object.keys(zip.files)
      .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
      .sort();
    if (sectionFiles.length === 0) return null;

    const texts: string[] = [];
    for (const name of sectionFiles) {
      const xml = await zip.file(name)!.async("text");
      const text = hwpxSectionXmlToText(xml);
      if (text) texts.push(text);
    }
    return texts.join("\n\n") || null;
  } catch {
    return null;
  }
}

async function extractHwpxText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    return await hwpxBufferToText(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// Announcement docs are sometimes bundled inside a plain .zip alongside forms/regs
// instead of being attached directly as .hwpx — open the zip and pull out any .hwpx
// files nested inside it too.
async function extractHwpxFromZipUrl(url: string): Promise<{ name: string; text: string }[]> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];
    const outerZip = await JSZip.loadAsync(await res.arrayBuffer());
    const innerHwpxNames = Object.keys(outerZip.files).filter((name) => name.toLowerCase().endsWith(".hwpx"));

    const found: { name: string; text: string }[] = [];
    for (const name of innerHwpxNames.slice(0, 2)) {
      const innerBuf = await outerZip.file(name)!.async("arraybuffer");
      const text = await hwpxBufferToText(innerBuf);
      if (text) found.push({ name, text });
    }
    return found;
  } catch {
    return [];
  }
}

async function gatherAttachmentText(attachments: { name: string; url: string }[] | null): Promise<string> {
  if (!attachments || attachments.length === 0) return "";

  const parts: string[] = [];
  const directHwpx = attachments.filter((a) => a.name.toLowerCase().endsWith(".hwpx")).slice(0, 2);
  for (const att of directHwpx) {
    const text = await extractHwpxText(att.url);
    if (text) parts.push(`--- ${att.name} ---\n${text}`);
  }

  if (parts.length === 0) {
    const zips = attachments.filter((a) => a.name.toLowerCase().endsWith(".zip")).slice(0, 2);
    for (const att of zips) {
      const nested = await extractHwpxFromZipUrl(att.url);
      for (const { name, text } of nested) {
        parts.push(`--- ${att.name} > ${name} ---\n${text}`);
      }
    }
  }

  return parts.join("\n\n").slice(0, 14000);
}

async function extractFields(notice: any, attachmentText: string) {
  const today = new Date().toISOString().slice(0, 10);
  const combinedBody = [notice.body_text ?? "", attachmentText].filter(Boolean).join("\n\n=== ATTACHMENT TEXT ===\n\n").slice(0, 20000);

  const prompt = `You extract structured facts from a Korean government (MSIT) business-support notice. Only use information present in the text; if a field isn't mentioned, use null. Do not guess or invent numbers.

Title: ${notice.title}
Posted: ${notice.posted_at ?? "unknown"}
Today's date: ${today}
Body (may include text extracted from an attached announcement document):
${combinedBody}

Extract these fields as JSON (Korean text values, keep original units/currency as written; application_deadline as YYYY-MM-DD or null; application_status must be one of "upcoming", "open", "closed", "unknown" based on today's date vs any stated deadline):
{
  "total_budget": "total program budget, as stated",
  "support_cap_per_company": "maximum support amount per company/project, as stated",
  "self_funding_ratio": "required self-funding ratio, as stated",
  "actual_support_amount": "concrete support amount if a specific figure is given",
  "support_type": "type of support (e.g. grant, subsidy, loan, voucher)",
  "payment_method": "payment method (e.g. lump sum, installments)",
  "selection_scale": "number of companies/projects to be selected",
  "project_period": "project execution period",
  "eligibility": "eligibility requirements to apply",
  "application_deadline": "application deadline — check schedule/date TABLES (marked [표], rendered as 'col1 | col2 | ...' rows) as carefully as prose; look for rows labeled 접수마감/신청마감/마감일/신청기간/접수기간 and use the closing date of that period",
  "application_status": "upcoming | open | closed | unknown",
  "extraction_notes": "one short sentence noting anything important that doesn't fit the fields above (e.g. 'no attachment text was available'), or null"
}
Write all extracted text VALUES in Korean (matching the source document's language), keeping the JSON keys and application_status value in English as specified. Respond ONLY with this JSON object, no other text.`;

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
  if (!jsonMatch) throw new Error("no JSON in response");
  return JSON.parse(jsonMatch[0]);
}

const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");

Deno.serve(async (req: Request) => {
  if (ADMIN_SECRET && req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let params: { limit?: number; sinceDays?: number } = {};
  try {
    params = await req.json();
  } catch {
    // defaults
  }
  const limit = params.limit ?? 20;
  const sinceDays = params.sinceDays ?? 365; // outer safety net; real status comes from the deadline text itself
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // titles that are obviously not open applications (results/announcements about a past selection)
  // no LLM call needed to know these are closed
  const NEVER_OPEN_PATTERNS = ["선정결과", "선정 결과", "선정자 발표", "합격자 발표", "결과 공고"];

  const { data: candidates, error: nErr } = await supabase
    .from("notices")
    .select("*")
    .is("extracted_at", null)
    .not("body_text", "is", null)
    .gte("posted_at", cutoff)
    .order("posted_at", { ascending: false })
    .limit(limit * 2); // overfetch since some will be filtered out below without an extraction call

  if (nErr) return new Response(JSON.stringify({ error: nErr.message }), { status: 500 });

  const notices = [];
  const skippedClosed: number[] = [];
  for (const n of candidates ?? []) {
    if (NEVER_OPEN_PATTERNS.some((p) => n.title.includes(p))) {
      skippedClosed.push(n.id);
    } else {
      notices.push(n);
    }
    if (notices.length >= limit) break;
  }

  if (skippedClosed.length > 0) {
    await supabase
      .from("notices")
      .update({ application_status: "closed", extracted_at: new Date().toISOString(), extraction_notes: "title indicates a results/selection announcement, not an open application" })
      .in("id", skippedClosed);
  }

  let extracted = 0;
  const errors: string[] = [];

  for (const notice of notices ?? []) {
    try {
      const attachmentText = await gatherAttachmentText(notice.attachments);
      const fields = await extractFields(notice, attachmentText);
      const update: Record<string, unknown> = { extracted_at: new Date().toISOString(), extraction_model: MODEL };
      for (const key of SCHEMA_FIELDS) {
        update[key] = fields[key] ?? null;
      }
      update.extraction_notes = fields.extraction_notes ?? null;
      if (update.application_deadline === "" || update.application_deadline === "null") {
        update.application_deadline = null;
      }

      const { error } = await supabase.from("notices").update(update).eq("id", notice.id);
      if (error) throw new Error(error.message);
      extracted++;
    } catch (e) {
      errors.push(`notice=${notice.id}: ${String(e)}`);
    }
  }

  return new Response(
    JSON.stringify({ extracted, skipped_by_title: skippedClosed.length, checked: notices.length, errors }),
    { headers: { "Content-Type": "application/json" } }
  );
});
