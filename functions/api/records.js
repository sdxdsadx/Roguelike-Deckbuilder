/* Cloudflare Pages Function：试玩记录的收集和后台读取。
     POST   /api/records          上传一份记录：{ record, token }。不用登录。
                                  同一份记录（id 相同）以后只有带着第一次上传时的 token 才能更新（补填问卷时用）。
     GET    /api/records          后台读取所有记录，要带 Authorization: Bearer <后台密码>。
     DELETE /api/records?id=...   后台删掉一份记录（比如乱传的），同样要带后台密码。
   需要在 Cloudflare 里给这个 Pages 项目绑定一个 D1 数据库，变量名 DB；再加一个 Secret，名字 ADMIN_KEY，值就是后台密码。
   表第一次用的时候自动建，不用手动跑 SQL。 */

const FORMAT = "slot-roguelike-record";
const BUNDLE = "slot-roguelike-records";
const MAX_BYTES = 600 * 1024;  // 一份记录最大 600 KB（实际一局通常几十 KB）
const MAX_PER_HOUR = 60;       // 同一个 IP 一小时最多上传几次

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}

/* 比较两个字符串：先各算一次哈希再逐位比，花的时间不随内容变。 */
async function same(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function ready(env) {
  if (!env.DB) return false;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY, mode TEXT NOT NULL, result TEXT, seed TEXT, tester TEXT,
    started_at TEXT, ended_at TEXT, received_at TEXT NOT NULL, has_survey INTEGER NOT NULL DEFAULT 0,
    token_hash TEXT NOT NULL, body TEXT NOT NULL)`).run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS upload_rate (ip TEXT NOT NULL, hour TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip, hour))").run();
  return true;
}

function validRecord(r) {
  return !!r && typeof r === "object" && r.format === FORMAT && r.version === 1
    && typeof r.id === "string" && r.id.length > 0 && r.id.length <= 120
    && (r.mode === "run" || r.mode === "sandbox");
}

const text40 = v => (v == null ? null : String(v).slice(0, 40));

async function isAdmin(request, env) {
  if (!env.ADMIN_KEY) return false;
  const m = /^Bearer\s+(.+)$/.exec(request.headers.get("authorization") || "");
  return !!m && same(m[1], env.ADMIN_KEY);
}

async function adminGate(request, env) {
  if (!(await ready(env))) return json({ ok: false, error: "no-db" }, 503);
  if (!env.ADMIN_KEY) return json({ ok: false, error: "no-admin-key" }, 503);
  if (!(await isAdmin(request, env))) return json({ ok: false, error: "wrong-key" }, 401);
  return null;
}

export async function onRequestPost({ request, env }) {
  if (!(await ready(env))) return json({ ok: false, error: "no-db" }, 503);
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return json({ ok: false, error: "too-large" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ ok: false, error: "bad-json" }, 400); }
  const rec = body && body.record;
  const token = body && typeof body.token === "string" ? body.token : "";
  if (!validRecord(rec) || token.length < 16 || token.length > 200) return json({ ok: false, error: "bad-record" }, 400);

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const hour = new Date().toISOString().slice(0, 13);
  await env.DB.prepare("DELETE FROM upload_rate WHERE hour < ?").bind(hour).run();
  await env.DB.prepare("INSERT INTO upload_rate (ip, hour, n) VALUES (?, ?, 1) ON CONFLICT(ip, hour) DO UPDATE SET n = n + 1").bind(ip, hour).run();
  const used = await env.DB.prepare("SELECT n FROM upload_rate WHERE ip = ? AND hour = ?").bind(ip, hour).first("n");
  if (used > MAX_PER_HOUR) return json({ ok: false, error: "rate-limited" }, 429);

  const tokenHash = await sha256(token);
  const old = await env.DB.prepare("SELECT token_hash FROM records WHERE id = ?").bind(rec.id).first();
  if (old && old.token_hash !== tokenHash) return json({ ok: false, error: "not-yours" }, 403);

  const answers = rec.survey && rec.survey.answers;
  const fields = [rec.mode, text40(rec.result), text40(rec.seed), answers ? text40(answers.tester) : null,
    text40(rec.startedAt), text40(rec.endedAt), new Date().toISOString(), rec.survey ? 1 : 0, JSON.stringify(rec)];
  if (old) {
    await env.DB.prepare("UPDATE records SET mode = ?, result = ?, seed = ?, tester = ?, started_at = ?, ended_at = ?, received_at = ?, has_survey = ?, body = ? WHERE id = ?")
      .bind(...fields, rec.id).run();
  } else {
    await env.DB.prepare("INSERT INTO records (mode, result, seed, tester, started_at, ended_at, received_at, has_survey, body, id, token_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(...fields, rec.id, tokenHash).run();
  }
  return json({ ok: true, updated: !!old });
}

export async function onRequestGet({ request, env }) {
  const denied = await adminGate(request, env);
  if (denied) return denied;
  const { results } = await env.DB.prepare("SELECT body FROM records ORDER BY received_at DESC").all();
  const records = [];
  for (const row of results || []) {
    try { records.push(JSON.parse(row.body)); } catch (e) { /* 坏掉的那一份跳过 */ }
  }
  return json({ format: BUNDLE, version: 1, exportedAt: new Date().toISOString(), records });
}

export async function onRequestDelete({ request, env }) {
  const denied = await adminGate(request, env);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ ok: false, error: "no-id" }, 400);
  const r = await env.DB.prepare("DELETE FROM records WHERE id = ?").bind(id).run();
  return json({ ok: true, deleted: (r && r.meta && r.meta.changes) || 0 });
}
