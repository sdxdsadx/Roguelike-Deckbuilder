/* 后台（Cloudflare Pages Functions）的测试：node --test prototype/test/backend.test.js
   用 Node 自带的 SQLite 模拟 D1，跑的是 functions/api 里真正的代码。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

for (const f of ["rng", "data", "engine", "run", "record"]) require(path.join(__dirname, `../js/${f}.js`));
const { run: R, record: REC } = globalThis.QW;

/* 把 Pages Function 文件当成普通函数加载（去掉 export）。 */
function load(file, names) {
  const src = fs.readFileSync(path.join(__dirname, "../../functions/api", file), "utf8").replace(/^export /gm, "");
  return new Function(`${src}\nreturn { ${names.join(", ")} };`)();
}
const API = load("records.js", ["onRequestGet", "onRequestPost", "onRequestDelete"]);
const HEALTH = load("health.js", ["onRequestGet"]);

/* 和 D1 一样的接口：prepare(sql).bind(...).run() / first(列名) / all()。 */
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, args) => ({
    bind: (...a) => statement(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    first: async col => { const row = db.prepare(sql).get(...args); return row == null ? null : col ? row[col] : row; },
    all: async () => ({ success: true, results: db.prepare(sql).all(...args) })
  });
  return { prepare: sql => statement(sql, []) };
}

const KEY = "correct horse battery staple";
const env = () => ({ DB: fakeD1(), ADMIN_KEY: KEY });
const post = (e, body, ip) => API.onRequestPost({
  env: e, request: new Request("https://site/api/records", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "cf-connecting-ip": ip || "1.1.1.1" } })
});
const get = (e, key) => API.onRequestGet({ env: e, request: new Request("https://site/api/records", { headers: key ? { authorization: `Bearer ${key}` } : {} }) });
const del = (e, id, key) => API.onRequestDelete({ env: e, request: new Request(`https://site/api/records?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { authorization: `Bearer ${key}` } }) });

function sampleRecord(id) {
  const run = R.createRun({ seed: "srv" + id, id });
  R.go(run, R.available(run)[0]);
  return REC.fromRun(run, {});
}
const TOKEN = "token-0123456789abcdef";

test("没绑数据库：上传和读取都返回 503；health 能看出来缺什么", async () => {
  const r = await post({}, { record: sampleRecord("a"), token: TOKEN });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "no-db");
  assert.equal((await get({}, KEY)).status, 503);
  assert.deepEqual(await (await HEALTH.onRequestGet({ env: {} })).json(), { ok: true, db: false, admin: false });
  assert.deepEqual(await (await HEALTH.onRequestGet({ env: env() })).json(), { ok: true, db: true, admin: true });
});

test("上传：第一次新建；同一个 token 可以更新（补填问卷）；别的 token 改不了", async () => {
  const e = env();
  const rec = sampleRecord("b");
  let r = await post(e, { record: rec, token: TOKEN });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, updated: false });
  const withSurvey = Object.assign({}, rec, { survey: REC.makeSurvey({ tester: "小王", fun: 4 }) });
  r = await post(e, { record: withSurvey, token: TOKEN });
  assert.deepEqual(await r.json(), { ok: true, updated: true });
  r = await post(e, { record: Object.assign({}, rec, { result: "win" }), token: "someone-else-token-123" });
  assert.equal(r.status, 403);
  const all = await (await get(e, KEY)).json();
  assert.equal(all.records.length, 1);
  assert.equal(all.records[0].survey.answers.tester, "小王", "存下的是补填了问卷的那一版");
  assert.equal(REC.normalizeImport(all).length, 1, "读回来的就是能直接导入的合集");
});

test("不是记录、token 太短、太大、不是 JSON 的都不收", async () => {
  const e = env();
  assert.equal((await post(e, { record: { hello: 1 }, token: TOKEN })).status, 400);
  assert.equal((await post(e, { record: sampleRecord("c"), token: "short" })).status, 400);
  assert.equal((await post(e, "{not json")).status, 400);
  const big = Object.assign(sampleRecord("d"), { padding: "x".repeat(700 * 1024) });
  assert.equal((await post(e, { record: big, token: TOKEN })).status, 413);
  assert.equal((await (await get(e, KEY)).json()).records.length, 0);
});

test("后台读取和删除要密码；没设密码时直接拒绝", async () => {
  const e = env();
  await post(e, { record: sampleRecord("e"), token: TOKEN });
  assert.equal((await get(e)).status, 401);
  assert.equal((await get(e, "wrong")).status, 401);
  assert.equal((await get(e, KEY)).status, 200);
  assert.equal((await del(e, "e", "wrong")).status, 401);
  assert.deepEqual(await (await del(e, "e", KEY)).json(), { ok: true, deleted: 1 });
  assert.equal((await (await get(e, KEY)).json()).records.length, 0);
  const noKey = { DB: fakeD1() };
  assert.equal((await get(noKey, "anything")).status, 503);
});

test("同一个 IP 一小时最多传 60 次", async () => {
  const e = env();
  let last;
  for (let k = 0; k < 61; k++) last = await post(e, { record: sampleRecord("r" + k), token: TOKEN }, "9.9.9.9");
  assert.equal(last.status, 429);
  assert.equal((await post(e, { record: sampleRecord("other"), token: TOKEN }, "8.8.8.8")).status, 200, "别的 IP 不受影响");
});
