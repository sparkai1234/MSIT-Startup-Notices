import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BOARDS = [{ board: "business_notice", mId: "311", mPid: "121" }];

function stripJsComments(html: string) {
  let c = html.replace(/\/\*[\s\S]*?\*\//g, "");
  c = c.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  return c;
}

function fieldMap(cleaned: string, field: string) {
  const re = new RegExp(`\\$\\('#td_'\\+'${field}'\\+'_(\\d+)'\\)\\.html\\('([^']*)'\\)`, "g");
  const map: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) map[m[1]] = m[2];
  return map;
}

async function fetchListPage(mId: string, mPid: string, pageIndex: number) {
  const url = `https://www.msit.go.kr/bbs/list.do?sCode=user&mId=${mId}&mPid=${mPid}&pageIndex=${pageIndex}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();

  const bbsSeqNoMatch = html.match(/name="bbsSeqNo"\s+id="bbsSeqNo"\s+value="(\d+)"/);
  const bbsSeqNo = bbsSeqNoMatch ? bbsSeqNoMatch[1] : "";

  const detailRe = /fn_detail\((\d+)\);/g;
  const ids: string[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = detailRe.exec(html)) !== null) ids.push(dm[1]);

  const unescRe = /unescape\('((?:[^'\\]|\\.)*)'\)/g;
  const titles: string[] = [];
  let um: RegExpExecArray | null;
  while ((um = unescRe.exec(html)) !== null) if (um[1]) titles.push(um[1]);

  const cleaned = stripJsComments(html);
  const dept = fieldMap(cleaned, "CHRG_DEPT_NM");
  const contact = fieldMap(cleaned, "NTCR");
  const phone = fieldMap(cleaned, "TELNO");
  const date = fieldMap(cleaned, "REG_DT");

  const rows = ids.map((nttSeqNo, i) => {
    const posted_raw = date[String(i)] || null;
    const posted_at = posted_raw ? new Date(posted_raw).toISOString().slice(0, 10) : null;
    return {
      nttSeqNo,
      title: titles[i] || "",
      dept: dept[String(i)] || null,
      contact_name: contact[String(i)] || null,
      contact_phone: phone[String(i)] || null,
      posted_at,
    };
  }).filter((r) => r.title);

  return { rows, bbsSeqNo };
}

async function fetchDetail(mId: string, mPid: string, bbsSeqNo: string, nttSeqNo: string) {
  const url = `https://www.msit.go.kr/bbs/view.do?sCode=user&mId=${mId}&mPid=${mPid}&bbsSeqNo=${bbsSeqNo}&nttSeqNo=${nttSeqNo}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const noComments = html.replace(/<!--[\s\S]*?-->/g, "");

  const bodyMatch = noComments.match(/id="cont-wrap" class="view_cont">([\s\S]*?)<div class="view_file">/);
  const bodyText = bodyMatch
    ? bodyMatch[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000)
    : null;

  const attachments: { name: string; url: string }[] = [];
  const attRe = /class="ico_file_\w+"[^>]*>([^<]+)<\/a>[\s\S]{0,400}?onclick="fn_download\('(\d+)', '(\d+)', '(\w+)'\);"/g;
  let am: RegExpExecArray | null;
  while ((am = attRe.exec(noComments)) !== null) {
    const [, name, atchFileNo, fileOrd] = am;
    attachments.push({
      name: name.trim(),
      url: `https://www.msit.go.kr/ssm/file/fileDown.do?atchFileNo=${atchFileNo}&fileOrd=${fileOrd}&fileBtn=A`,
    });
  }

  return { url, bodyText, attachments };
}

const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");

Deno.serve(async (req: Request) => {
  if (ADMIN_SECRET && req.headers.get("x-admin-secret") !== ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let params: { startPage?: number; pageCount?: number } = {};
  try {
    params = await req.json();
  } catch {
    // no body: default to just page 1 (normal incremental cron run)
  }
  const startPage = params.startPage ?? 1;
  const pageCount = params.pageCount ?? 1;

  const results: Record<string, { found: number; inserted: number; lastPage: number; morePages: boolean }> = {};

  for (const cfg of BOARDS) {
    const startedAt = new Date().toISOString();
    let found = 0;
    let inserted = 0;
    let errorMsg: string | null = null;
    let lastPage = startPage - 1;
    let morePages = false;

    try {
      for (let page = startPage; page < startPage + pageCount; page++) {
        const { rows, bbsSeqNo } = await fetchListPage(cfg.mId, cfg.mPid, page);
        if (rows.length === 0) {
          morePages = false;
          break;
        }
        lastPage = page;
        morePages = true;
        found += rows.length;

        for (const row of rows) {
          const { data: existing } = await supabase
            .from("notices")
            .select("id")
            .eq("ntt_seq_no", row.nttSeqNo)
            .maybeSingle();
          if (existing) continue;

          const detail = await fetchDetail(cfg.mId, cfg.mPid, bbsSeqNo, row.nttSeqNo);

          const { error } = await supabase.from("notices").insert({
            ntt_seq_no: row.nttSeqNo,
            bbs_seq_no: bbsSeqNo,
            board: cfg.board,
            title: row.title,
            dept: row.dept,
            contact_name: row.contact_name,
            contact_phone: row.contact_phone,
            posted_at: row.posted_at,
            detail_url: detail.url,
            body_text: detail.bodyText,
            attachments: detail.attachments,
          });
          if (!error) inserted++;
        }
      }
    } catch (e) {
      errorMsg = String(e);
    }

    await supabase.from("scrape_runs").insert({
      board: cfg.board,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      notices_found: found,
      notices_new: inserted,
      ok: !errorMsg,
      error: errorMsg,
    });

    results[cfg.board] = { found, inserted, lastPage, morePages };
  }

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
});
