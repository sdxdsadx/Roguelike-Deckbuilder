/* 对局记录：存在这台设备上的记录、下载文件、反馈问卷，以及「对局记录」页面（列表、导入别人发来的记录、汇总）。
   记录的格式和汇总的算法在 record.js 里。导入的记录是别人发来的文件，显示时一律转义。 */
(function () {
  "use strict";
  const QW = window.QW;
  const D = QW.data;
  const U = QW.ui;
  const REC = QW.record;
  const { $, esc } = U;
  const STORE = "slot-roguelike-records-v1";
  const LIMIT = { run: 20, sandbox: 10 };
  const MAX_CHARS = 1500000;
  const MAX_FILE = 20 * 1024 * 1024;
  const MODE_NAME = { run: "完整一局", sandbox: "战斗沙盒" };
  const RESULT_NAME = {
    run: { win: "通关", lose: "失败", abandoned: "放弃", unfinished: "没打完" },
    sandbox: { win: "胜利", lose: "失败", unfinished: "没打完" }
  };
  const V = { imported: [], server: null, includeLocal: true, skipGod: true, sort: "offered", confirm: null, timer: null, survey: null, health: undefined };
  const arr = x => (Array.isArray(x) ? x : []);
  const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const uniq = list => Array.from(new Set(list.filter(Boolean).map(String)));
  const fmt1 = x => (Math.round(x * 10) / 10).toString();

  /* ---------- 存在这台设备上 ----------
     每种模式只留最近几份，总大小也有上限；存不下就从最旧的开始扔。要长期留着就下载。 */
  function readAll() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || "null");
      return raw && Array.isArray(raw.records) ? raw.records.filter(REC.isRecord) : [];
    } catch (e) { return []; }
  }

  function writeAll(list) {
    const seen = { run: 0, sandbox: 0 };
    const keep = REC.sort(list).filter(r => ++seen[r.mode] <= LIMIT[r.mode]);
    for (;;) {
      const text = JSON.stringify({ v: 1, records: keep });
      if (text.length <= MAX_CHARS || keep.length <= 1) {
        try { localStorage.setItem(STORE, text); return keep; } catch (e) { if (keep.length <= 1) return null; }
      }
      keep.pop();
    }
  }

  /* 存一份（同一个 id 只占一份）。已经填过的问卷不会被没填问卷的新版本冲掉。 */
  function put(rec) {
    const list = readAll();
    const i = list.findIndex(r => r.id === rec.id);
    const next = Object.assign({}, rec);
    if (i >= 0 && !next.survey && list[i].survey) next.survey = list[i].survey;
    if (i >= 0) list[i] = next; else list.push(next);
    const saved = writeAll(list);
    return !!saved && saved.some(r => r.id === rec.id);
  }

  function getLocal(id) { return readAll().find(r => r.id === id) || null; }
  function removeLocal(id) { writeAll(readAll().filter(r => r.id !== id)); }
  function clearLocal() { try { localStorage.removeItem(STORE); } catch (e) { /* 忽略 */ } }

  /* ---------- 下载 ----------
     普通网页直接下载；在 claude.ai 里打开时，要用页面的下载功能，看的人确认以后才会保存；
     都不行就把内容摆出来让人复制。 */
  const host = window.claude && typeof window.claude.use === "function" ? window.claude : null;
  const dlApi = host ? Promise.resolve().then(() => host.use("downloads")).catch(() => null) : null;

  function saveFile(filename, text) {
    if (!host) {
      try {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.hidden = true;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        U.flash(`已下载 ${filename}`, "ok");
      } catch (e) { showCopy(filename, text); }
      return;
    }
    dlApi.then(api => {
      if (!api) { showCopy(filename, text); return; }
      api.save({ filename, data: text }).then(r => {
        if (r && r.status === "saved") U.flash(`已保存 ${filename}`, "ok");
      }, err => {
        const code = err && err.code;
        if (code === "declined") U.flash("没有保存文件");
        else if (code === "rate_limited") U.flash("已经有一个保存提示开着，先处理那一个");
        else showCopy(filename, text);
      });
    });
  }

  function showCopy(filename, text) {
    U.openModal('<div class="result copy-view" role="dialog" aria-modal="true" aria-labelledby="copy-title">'
      + '<h2 id="copy-title">复制记录</h2>'
      + `<p class="note">这里没法直接下载文件。把下面的内容全部复制下来，存成 ${esc(filename)}，或者直接粘贴给策划。</p>`
      + `<textarea class="copy-text" readonly aria-label="记录内容">${esc(text)}</textarea>`
      + '<div class="actions"><button type="button" class="btn-main" data-rc="copy">复制</button>'
      + '<button type="button" class="btn" data-close-modal>关闭</button></div></div>');
  }

  function copyText() {
    const ta = $("#modal .copy-text");
    if (!ta) return;
    const done = () => U.flash("已复制", "ok");
    const legacy = () => {
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      if (ok) done(); else U.flash("复制不了，内容已经选中，请手动复制");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, legacy);
    else legacy();
  }

  function download(rec) { saveFile(REC.fileName(rec), JSON.stringify(rec, null, 2)); }

  function downloadMany(list) {
    if (!list.length) { U.flash("没有记录可以下载"); return; }
    if (list.length === 1) { download(list[0]); return; }
    saveFile(REC.bundleName(list.length), JSON.stringify(REC.bundle(list), null, 2));
  }

  /* ---------- 后台 ----------
     部署在 Cloudflare 上、并且配好了后台（见 functions/api 和 README）时，完整一局的记录自动上传；
     本地文件和 claude.ai 里的页面不上传。每份记录第一次上传时生成一个随机 token 存在这台设备上，
     之后补填问卷就用它更新同一份；别人拿不到这个 token，就改不了你的记录。 */
  const UPLOAD = "slot-roguelike-upload-v1";
  const ADMIN = "slot-roguelike-admin-v1";
  const canServe = !host && /^https?:$/.test(location.protocol);
  let healthP = null;
  function serverHealth() {
    if (!canServe) return Promise.resolve(null);
    if (!healthP) healthP = fetch("/api/health", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    return healthP;
  }

  function uploadState() {
    try { const st = JSON.parse(localStorage.getItem(UPLOAD) || "{}"); return st && typeof st === "object" ? st : {}; } catch (e) { return {}; }
  }
  function saveUploadState(st) {
    const ids = Object.keys(st);
    if (ids.length > 200) ids.sort((a, b) => String(st[a].at || "").localeCompare(String(st[b].at || ""))).slice(0, ids.length - 200).forEach(id => { delete st[id]; });
    try { localStorage.setItem(UPLOAD, JSON.stringify(st)); } catch (e) { /* 存不了就算了 */ }
  }
  function newToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("") + "-" + Date.now().toString(36);
  }
  const sigOf = rec => [rec.result, rec.endedAt, rec.survey ? rec.survey.at : "", arr(rec.fights).length, arr(rec.timeline).length].join("|");

  /* 上传一份完整一局的记录。返回 "off"（没开后台或者关掉了上传）、"same"（传过了、没变）、"sent"、"failed"。 */
  async function upload(rec) {
    if (!rec || rec.mode !== "run" || U.S.set.upload === false) return "off";
    const h = await serverHealth();
    if (!h || !h.db) return "off";
    const st = uploadState();
    const cur = st[rec.id] || (st[rec.id] = { token: newToken() });
    const sig = sigOf(rec);
    if (cur.sig === sig) return "same";
    saveUploadState(st);  // token 先存下来，万一请求到了服务器但回复丢了，下次还能用同一个 token 更新
    try {
      const r = await fetch("/api/records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ record: rec, token: cur.token }) });
      if (!r.ok) return "failed";
      const latest = uploadState();
      latest[rec.id] = Object.assign({}, latest[rec.id] || cur, { sig, at: new Date().toISOString() });
      saveUploadState(latest);
      return "sent";
    } catch (e) { return "failed"; }
  }

  function uploadText(state) {
    if (state === "sent" || state === "same") return "这一局的记录已经传到后台，策划能看到（只有游戏里的数据和你填的问卷）。不想传，可以在「对局记录」页关掉。";
    if (state === "failed") return "这一局的记录没传上去，可以点「只下载记录」，把文件发给策划。";
    return "";
  }

  const adminKey = () => { try { return localStorage.getItem(ADMIN) || ""; } catch (e) { return ""; } };
  function setAdminKey(k) { try { if (k) localStorage.setItem(ADMIN, k); else localStorage.removeItem(ADMIN); } catch (e) { /* 忽略 */ } }

  async function fetchServer(key) {
    try {
      const r = await fetch("/api/records", { headers: { authorization: `Bearer ${key}` }, cache: "no-store" });
      if (r.status === 401) return { error: "后台密码不对" };
      if (!r.ok) return { error: `后台出错了（${r.status}）` };
      return { records: REC.sort(REC.dedupe(REC.normalizeImport(await r.json()))) };
    } catch (e) { return { error: "连不上后台" }; }
  }

  async function loadServer(key) {
    const res = await fetchServer(key);
    if (res.error) { U.flash(res.error); if (res.error === "后台密码不对") setAdminKey(""); render(); return; }
    setAdminKey(key);
    V.server = res.records;
    const d = new Date();
    V.serverAt = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    render();
    U.flash(`从后台读到 ${res.records.length} 份记录`, "ok");
  }

  async function deleteServer(id) {
    try {
      const r = await fetch(`/api/records?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { authorization: `Bearer ${adminKey()}` } });
      if (!r.ok) { U.flash(`删不掉（${r.status}）`); return; }
      V.server = (V.server || []).filter(x => x.id !== id);
      render();
      U.flash("已经从后台删掉了", "ok");
    } catch (e) { U.flash("连不上后台"); }
  }

  /* ---------- 反馈问卷 ----------
     题目在 data.js 的 SURVEY 里。ctx.cards / ctx.enemies：这一局见过的牌和敌人，放在下拉框最前面。 */
  const baseName = n => String(n).replace(/\+$/, "");
  const allCards = () => uniq(Object.values(D.CARDS).map(c => c.name));
  const allEnemies = () => uniq(Object.keys(D.ENEMIES).filter(id => id !== "sheep").map(id => D.ENEMIES[id].name));

  /* prefix：同一页上可能同时有两份问卷（局末页面里一份、弹窗里一份），用前缀把 id 和单选组分开。 */
  function surveyFields(answers, ctx, prefix) {
    const a = answers || {};
    const c = ctx || {};
    return D.SURVEY.map(q => {
      const id = `${prefix || "sv"}-${q.id}`;
      const v = a[q.id] == null ? "" : String(a[q.id]);
      const pick = q.type === "scale" || q.type === "choice";
      const head = pick ? `<span class="sv-q" id="${id}">${esc(q.q)}</span>` : `<label class="sv-q" for="${id}">${esc(q.q)}</label>`;
      let body;
      if (q.type === "short") {
        body = `<input id="${id}" type="text" maxlength="40" data-sq="${q.id}" value="${esc(v)}" autocomplete="nickname">`;
      } else if (q.type === "text") {
        body = `<textarea id="${id}" rows="3" maxlength="2000" data-sq="${q.id}">${esc(v)}</textarea>`;
      } else if (pick) {
        const opts = q.type === "scale" ? ["1", "2", "3", "4", "5"] : q.options;
        const aria = o => (q.type !== "scale" ? o : `${o} 分${o === "1" ? `，${q.low}` : o === "5" ? `，${q.high}` : ""}`);
        body = `<div class="sv-opts${q.type === "scale" ? " scale" : ""}" role="radiogroup" aria-labelledby="${id}">`
          + opts.map(o => `<label class="sv-opt"><input type="radio" name="${id}" value="${esc(o)}" data-sq="${q.id}" aria-label="${esc(aria(o))}"${v === o ? " checked" : ""}><span aria-hidden="true">${esc(o)}</span></label>`).join("")
          + "</div>"
          + (q.type === "scale" ? `<div class="sv-ends" aria-hidden="true"><span>1 ${esc(q.low)}</span><span>5 ${esc(q.high)}</span></div>` : "");
      } else {
        const first = uniq(arr(q.type === "card" ? c.cards : c.enemies).map(baseName));
        const rest = (q.type === "card" ? allCards() : allEnemies()).filter(n => !first.includes(n));
        const opt = n => `<option value="${esc(n)}"${n === v ? " selected" : ""}>${esc(n)}</option>`;
        body = `<select id="${id}" data-sq="${q.id}"><option value="">（不选）</option>`
          + (first.length ? `<optgroup label="${q.type === "card" ? "这次卡组里的牌" : "这次遇到的敌人"}">${first.map(opt).join("")}</optgroup>` : "")
          + `<optgroup label="${first.length ? "其他" : "全部"}">${rest.map(opt).join("")}</optgroup></select>`;
      }
      return `<div class="sv-item">${head}${body}</div>`;
    }).join("");
  }

  function readSurvey(root) {
    const out = {};
    if (!root) return out;
    for (const q of D.SURVEY) {
      const el = q.type === "scale" || q.type === "choice"
        ? root.querySelector(`input[data-sq="${q.id}"]:checked`)
        : root.querySelector(`[data-sq="${q.id}"]`);
      const v = el ? String(el.value).trim() : "";
      if (v) out[q.id] = q.type === "scale" ? Number(v) : v;
    }
    return out;
  }

  /* 只填了名字不算填了问卷。 */
  const answered = ans => Object.keys(ans).some(k => k !== "tester");

  function rememberTester(name) {
    const v = String(name || "").slice(0, 40);
    if (U.S.set.tester !== v) { U.S.set.tester = v; U.saveSettings(); }
  }

  function defaultAnswers(survey) { return survey && survey.answers ? survey.answers : { tester: U.S.set.tester || "" }; }

  /* 弹窗里的问卷（战斗沙盒和对局记录页用）。o：{ about, answers, ctx, onSubmit(survey, download) } */
  function openSurvey(o) {
    V.survey = o;
    U.openModal('<div class="result survey-view" role="dialog" aria-modal="true" aria-labelledby="sv-title">'
      + '<h2 id="sv-title">反馈问卷</h2>'
      + `<p class="note">${esc(o.about)}。都是选填，填多少算多少。</p>`
      + `<div class="survey" id="modal-survey">${surveyFields(o.answers, o.ctx, "ms")}</div>`
      + '<div class="actions"><button type="button" class="btn-main" data-sv="save-dl">提交并下载记录</button>'
      + '<button type="button" class="btn" data-sv="save">只提交</button>'
      + '<button type="button" class="btn" data-sv="cancel">取消</button></div></div>', true);
  }

  function submitModalSurvey(dl) {
    const o = V.survey;
    if (!o) return;
    const ans = readSurvey($("#modal-survey"));
    if (!answered(ans)) { U.flash("问卷还是空的，至少答一题"); return; }
    rememberTester(ans.tester);
    V.survey = null;
    U.closeModal();
    o.onSubmit(REC.makeSurvey(ans), dl);
  }

  /* ---------- 「对局记录」页面 ---------- */
  function show() {
    QW.ui.combat.stop();
    document.querySelectorAll("main").forEach(m => { m.hidden = m.id !== "records"; });
    U.setTop("<span>每一局的记录和反馈问卷；可以导入别人发来的记录，或者从后台读所有人的，一起汇总</span>", [], null);
    render();
    if (V.health === undefined) serverHealth().then(h => { V.health = h; if (!$("#records").hidden) render(); });
  }

  function render() {
    const local = REC.sort(readAll());
    $("#records").innerHTML = `<div class="records">${localBox(local)}${serverBox()}${importBox()}${summaryBox(local)}</div>`;
  }

  function fmtTime(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return "";
    const p = n => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function resultName(r) {
    const names = RESULT_NAME[r.mode];
    return names && Object.prototype.hasOwnProperty.call(names, r.result) ? names[r.result] : "没打完";
  }
  const resultClass = r => (["win", "lose", "abandoned"].includes(r.result) ? r.result : "unfinished");

  function floorName(floor, floors) {
    const f = num(floor);
    if (!f) return "还没出发";
    return num(floors) && f >= num(floors) ? "Boss 层" : `第 ${f} 层`;
  }

  function reach(r) {
    const s = r.summary || {};
    if (r.result === "win") return "打完了 Boss";
    if (!num(s.floor)) return "还没出发";
    const where = floorName(s.floor, s.floors);
    return where === "Boss 层" ? "走到 Boss 层" : `走到${where}`;
  }

  function lineOf(r) {
    const s = r.summary || {};
    const god = (r.settings && r.settings.god) || {};
    const parts = r.mode === "run"
      ? [`种子 ${r.seed}`, reach(r), `打了 ${arr(r.fights).length} 场`, `卡组 ${num(s.deckSize)} 张`]
      : [arr(s.enemies).join("、") || "没有敌人", `${num(s.turns)} 回合`, `掉了 ${num(s.hpLost)} 血`];
    if (god.lockHp) parts.push("锁血");
    if (god.infiniteEnergy) parts.push("无限费用");
    const who = r.survey && r.survey.answers && r.survey.answers.tester;
    if (who) parts.push(`试玩：${who}`);
    return parts.map(String).join(" · ");
  }

  function rowHtml(r, src) {
    const attrs = `data-src="${src}" data-id="${esc(r.id)}"`;
    const del = src === "local"
      ? `<button type="button" class="btn" data-rc="del" ${attrs}>${V.confirm === "del:" + r.id ? "确定删除？再点一次" : "删除"}</button>`
      : src === "server"
        ? `<button type="button" class="btn" data-rc="server-del" ${attrs}>${V.confirm === "sdel:" + r.id ? "确定从后台删掉？再点一次" : "从后台删掉"}</button>`
        : `<button type="button" class="btn" data-rc="unimport" ${attrs}>移除</button>`;
    return `<li class="rec-row result-${resultClass(r)}"><div class="rec-main">`
      + `<b>${esc(MODE_NAME[r.mode])} · ${esc(resultName(r))}</b><span class="when">${esc(fmtTime(r.endedAt || r.startedAt))}</span>`
      + (r.survey ? '<span class="sv-tag done">已填问卷</span>' : '<span class="sv-tag">没填问卷</span>')
      + `<span class="rec-sub">${esc(lineOf(r))}</span></div><div class="rec-acts">`
      + `<button type="button" class="btn" data-rc="detail" ${attrs}>看详情</button>`
      + `<button type="button" class="btn" data-rc="survey" ${attrs}>${r.survey ? "改问卷" : "填问卷"}</button>`
      + `<button type="button" class="btn" data-rc="dl" ${attrs}>下载</button>${del}</div></li>`;
  }

  function localBox(local) {
    const runs = local.filter(r => r.mode === "run").length;
    return '<section class="box" aria-labelledby="h-rec-local"><div class="box-head"><h2 id="h-rec-local">这台设备上的记录</h2>'
      + `<span class="hint">${local.length ? `完整一局 ${runs} 份，战斗沙盒 ${local.length - runs} 份` : "还没有记录"}</span></div>`
      + (local.length
        ? `<ul class="rec-list">${local.map(r => rowHtml(r, "local")).join("")}</ul>`
          + '<div class="actions-row"><button type="button" class="btn-main" data-rc="dl-local">全部下载成一个文件</button>'
          + `<button type="button" class="btn" data-rc="clear">${V.confirm === "clear" ? "确定清空？再点一次" : "清空"}</button></div>`
        : '<p class="note">打完一局（中途放弃也算），或者在战斗沙盒里打完一场，记录就会自动存在这里。</p>')
      + `<p class="note">记录只存在这个浏览器里：完整一局最多留 ${LIMIT.run} 份，战斗沙盒最多 ${LIMIT.sandbox} 份，再多就把最旧的挤掉。想留着，或者要发给策划，就下载成文件。</p></section>`;
  }

  function serverBox() {
    const h = V.health;
    let body;
    if (!canServe) body = '<p class="note">在部署好的网站上才能用（现在打开的是本地文件，或者 claude.ai 里的页面）。</p>';
    else if (h === undefined) body = '<p class="note">正在看这个网站有没有开后台……</p>';
    else if (!h || !h.db) body = '<p class="note">这个网站还没开后台：要在 Cloudflare 里给这个 Pages 项目绑定一个 D1 数据库（变量名 DB），再加一个后台密码（Secret，名字 ADMIN_KEY）。步骤见项目 README 的「后台」一节。</p>';
    else if (!h.admin) body = '<p class="note">已经在收大家的记录了，但还没设后台密码（Secret，名字 ADMIN_KEY），所以读不出来。</p>';
    else if (!adminKey()) {
      body = '<div class="actions-row"><label class="field" for="admin-key">后台密码<input id="admin-key" type="password" autocomplete="current-password"></label>'
        + '<button type="button" class="btn-main" data-rc="server-login">登录并读取所有人的记录</button></div>';
    } else {
      body = `<div class="actions-row"><button type="button" class="btn-main" data-rc="server-load">${V.server ? "重新读取" : "读取所有人的记录"}</button>`
        + (V.server && V.server.length ? '<button type="button" class="btn" data-rc="dl-server">全部下载成一个文件</button>' : "")
        + '<button type="button" class="btn" data-rc="server-logout">退出后台</button></div>'
        + (V.server ? `<p class="note">后台一共 ${V.server.length} 份记录（${esc(V.serverAt)} 读取），已经算进下面的汇总。</p>` : "")
        + (V.server && V.server.length ? `<details class="server-list"${V.serverOpen ? " open" : ""}><summary>看列表（乱传的可以删掉）</summary><ul class="rec-list">${V.server.map(r => rowHtml(r, "server")).join("")}</ul></details>` : "");
    }
    const up = canServe && h && h.db
      ? `<label class="toggle"><input type="checkbox" data-rc="upload-toggle"${U.S.set.upload !== false ? " checked" : ""}>把我在这台设备上玩的完整一局自动传到后台</label>`
      : "";
    return '<section class="box" aria-labelledby="h-rec-server"><div class="box-head"><h2 id="h-rec-server">后台：所有人的记录</h2>'
      + '<span class="hint">试玩的人每打完一局，记录会自动传上来；策划登录以后，下面的汇总就是所有人的</span></div>'
      + body + up + "</section>";
  }

  function importBox() {
    const n = V.imported.length;
    return '<section class="box" aria-labelledby="h-rec-import"><div class="box-head"><h2 id="h-rec-import">导入别人发来的记录</h2>'
      + '<span class="hint">可以一次选好几个文件；「全部下载」得到的合集文件也能导入</span></div>'
      + '<div class="actions-row"><label class="btn file-btn">选记录文件<input type="file" accept=".json,application/json" multiple data-rc="file"></label>'
      + (n ? `<button type="button" class="btn" data-rc="dl-merged">${V.includeLocal ? "导入的和这台设备上的合并下载" : "把导入的合并下载"}</button>`
        + '<button type="button" class="btn" data-rc="unimport-all">清空导入</button>' : "")
      + "</div>"
      + '<details class="paste"><summary>选不了文件？把记录内容粘贴进来</summary>'
      + '<textarea id="rec-paste" rows="5" aria-label="粘贴记录内容"></textarea>'
      + '<div class="actions-row"><button type="button" class="btn" data-rc="paste">导入粘贴的内容</button></div></details>'
      + (n ? `<ul class="rec-list">${V.imported.map(r => rowHtml(r, "imported")).join("")}</ul>` : "")
      + '<p class="note">导入的记录只留在这个页面上，刷新就没了，不会存进这台设备。</p></section>';
  }

  /* ---------- 汇总 ----------
     数字用卡片；数量对比用横向条形（一种颜色，从同一条基线长出来，数写在条的末端）；卡牌选取率用表格。 */
  function tile(label, value, sub) {
    return `<div class="tile"><span class="tl">${esc(label)}</span><span class="tv">${esc(value)}</span><span class="ts">${esc(sub)}</span></div>`;
  }

  function bars(rows, empty) {
    if (!rows.length) return `<p class="note">${esc(empty || "还没有数据")}</p>`;
    const max = Math.max(1, ...rows.map(r => r.value));
    return `<ul class="bars">${rows.map(r => {
      const text = r.text != null ? r.text : String(r.value);
      return `<li title="${esc(r.title || `${r.label}：${text}`)}"><span class="bl">${esc(r.label)}</span>`
        + `<span class="bt"><i style="width:${(r.value / max * 100).toFixed(1)}%"></i></span><span class="bv">${esc(text)}</span></li>`;
    }).join("")}</ul>`;
  }

  function ranked(map, unit, limit) {
    return Object.keys(map).map(k => ({ label: k, value: num(map[k]) }))
      .sort((x, y) => y.value - x.value || x.label.localeCompare(y.label, "zh"))
      .slice(0, limit || 1000)
      .map(r => Object.assign(r, { text: `${r.value} ${unit}` }));
  }

  function part(title, body, note) {
    return `<div class="sum-part"><h3>${esc(title)}</h3>${note ? `<p class="note">${esc(note)}</p>` : ""}${body}</div>`;
  }

  function stopRows(a) {
    const map = {};
    for (const e of a.runEnds) {
      if (e.result === "win") continue;
      const label = floorName(e.floor, e.floors);
      const s = map[label] || (map[label] = { label, floor: num(e.floor), n: 0, lose: 0, abandoned: 0, unfinished: 0 });
      s.n++;
      s[e.result === "lose" || e.result === "abandoned" ? e.result : "unfinished"]++;
    }
    return Object.values(map).sort((x, y) => x.floor - y.floor).map(s => {
      const how = [s.lose && `失败 ${s.lose}`, s.abandoned && `放弃 ${s.abandoned}`, s.unfinished && `没打完 ${s.unfinished}`].filter(Boolean).join(" · ");
      return { label: s.label, value: s.n, text: how, title: `${s.label}：${s.n} 局（${how}）` };
    });
  }

  /* 卡牌表：每张牌一行，点表头换排序。胜率 = 最后的卡组里有这张牌、并且打完了的局里，通关的比例。 */
  const CARD_COLS = [
    ["offered", "奖励里出现"], ["picked", "被拿走"], ["pickRate", "选取率"], ["bought", "商店买"], ["removed", "删掉"],
    ["upgraded", "升级"], ["runs", "带着它的局"], ["winRate", "这些局的通关率"], ["plays", "打出次数"]
  ];
  const pct = (n, d) => (d ? Math.round(n / d * 100) : null);
  const rateCell = (n, d) => {
    const p = pct(n, d);
    return p == null ? '<td class="na">—</td>'
      : `<td><span class="meter" aria-hidden="true"><i style="width:${p}%"></i></span>${p}%<span class="frac">${n}/${d}</span></td>`;
  };

  function cardsTable(a) {
    const rows = Object.keys(a.cards).map(k => {
      const c = a.cards[k];
      return Object.assign({ name: k, pickRate: pct(c.picked, c.offered), winRate: pct(c.wins, c.finished) }, c);
    });
    if (!rows.length) return '<p class="note">还没有卡牌的记录。</p>';
    const key = V.sort || "offered";
    const val = r => (r[key] == null ? -1 : r[key]);
    rows.sort((x, y) => val(y) - val(x) || y.runs - x.runs || x.name.localeCompare(y.name, "zh"));
    const head = CARD_COLS.map(([k, label]) =>
      `<th scope="col"><button type="button" class="sort" data-rc="sort" data-k="${k}" aria-pressed="${k === key}">${esc(label)}${k === key ? " ↓" : ""}</button></th>`).join("");
    const base = pct(a.wins, a.finished);
    return `<p class="note">一共 ${a.rewardPicks + a.rewardSkips} 组卡牌奖励：拿了 ${a.rewardPicks} 次，跳过 ${a.rewardSkips} 次。`
      + `所有打完的完整一局（通关或失败，不算放弃和没打完的）一共 ${a.finished} 局，通关率 ${base == null ? "—" : `${base}%`}，`
      + "某张牌的通关率比它高，说明带着这张牌的局赢得多。局数少的时候数不太准。点表头可以换排序。</p>"
      + `<div class="table-wrap"><table class="rate cards"><thead><tr><th scope="col">牌</th>${head}</tr></thead><tbody>`
      + rows.map(r => `<tr><th scope="row">${esc(r.name)}</th><td>${r.offered}</td><td>${r.picked}</td>${rateCell(r.picked, r.offered)}`
        + `<td>${r.bought}</td><td>${r.removed}</td><td>${r.upgraded}</td><td>${r.runs}</td>${rateCell(r.wins, r.finished)}<td>${r.plays}</td></tr>`).join("")
      + "</tbody></table></div>";
  }

  function relicsTable(a) {
    const rows = Object.keys(a.relics).map(k => Object.assign({ name: k }, a.relics[k]))
      .sort((x, y) => y.runs - x.runs || x.name.localeCompare(y.name, "zh"));
    if (!rows.length) return '<p class="note">还没有奇物的记录。</p>';
    return '<div class="table-wrap"><table class="rate"><thead><tr><th scope="col">奇物</th><th scope="col">拿到它的局</th><th scope="col">这些局的通关率</th></tr></thead><tbody>'
      + rows.map(r => `<tr><th scope="row">${esc(r.name)}</th><td>${r.runs}</td>${rateCell(r.wins, r.finished)}</tr>`).join("")
      + "</tbody></table></div>";
  }

  function surveyPart(a) {
    const out = [];
    const who = a.survey.tester ? uniq(a.survey.tester.texts.map(t => t.text)) : [];
    for (const q of D.SURVEY) {
      if (q.id === "tester") continue;
      const s = a.survey[q.id];
      if (!s) { out.push(part(q.q, '<p class="note">没有人答。</p>')); continue; }
      let body;
      if (q.type === "scale") {
        const rows = ["1", "2", "3", "4", "5"].map(k => ({
          label: k === "1" ? `1 ${q.low}` : k === "5" ? `5 ${q.high}` : k, value: num(s.counts[k]), text: `${num(s.counts[k])} 人`
        }));
        body = `<p class="sv-avg">平均 <b>${fmt1(s.sum / s.n)}</b> 分（${s.n} 人答）</p>${bars(rows)}`;
      } else if (q.type === "choice") {
        const known = q.options.map(o => ({ label: o, value: num(s.counts[o]), text: `${num(s.counts[o])} 人` }));
        const other = Object.keys(s.counts).filter(k => !q.options.includes(k)).map(k => ({ label: k, value: num(s.counts[k]), text: `${num(s.counts[k])} 人` }));
        body = bars(known.concat(other));
      } else if (q.type === "text" || q.type === "short") {
        body = `<ul class="texts">${s.texts.map(t => `<li><p>${esc(t.text)}</p><span class="who">${esc([t.who, fmtTime(t.when)].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul>`;
      } else {
        body = bars(ranked(s.counts, "人"));
      }
      out.push(part(q.q, body));
    }
    return `<h3 class="sum-h">问卷（${a.surveyed} 份）</h3>`
      + (who.length ? `<p class="note">填问卷的人：${esc(who.join("、"))}</p>` : "")
      + `<div class="sum-grid">${out.join("")}</div>`;
  }

  function summaryBox(local) {
    const pool = REC.dedupe((V.includeLocal ? local : []).concat(V.imported, V.server || []));
    const head = '<section class="box" aria-labelledby="h-rec-sum"><div class="box-head"><h2 id="h-rec-sum">汇总</h2>'
      + `<label class="toggle"><input type="checkbox" data-rc="include-local"${V.includeLocal ? " checked" : ""}>把这台设备上的记录也算进去</label>`
      + `<label class="toggle"><input type="checkbox" data-rc="skip-god"${V.skipGod ? " checked" : ""}>不算开了锁血或无限费用的局</label></div>`
      + (V.server ? `<p class="note">包括从后台读到的 ${V.server.length} 份记录。</p>` : "");
    if (!pool.length) return `${head}<p class="note">还没有可以汇总的记录。</p></section>`;
    const a = REC.aggregate(pool, { skipGod: V.skipGod });
    if (!a.total) return `${head}<p class="note">${pool.length} 份记录都开了锁血或无限费用，取消上面的勾就能看到。</p></section>`;
    const rr = a.results.run;
    const ends = a.runEnds;
    const avgFloor = ends.length ? ends.reduce((s, e) => s + num(e.floor), 0) / ends.length : 0;
    const tiles = [
      tile("记录", String(a.total), `完整一局 ${a.runs} · 沙盒 ${a.sandbox}`),
      tile("完整一局通关", a.runs ? `${rr.win}/${a.runs}` : "—",
        a.runs ? [`失败 ${rr.lose}`, `放弃 ${rr.abandoned}`].concat(rr.unfinished ? [`没打完 ${rr.unfinished}`] : []).join(" · ") : "还没有完整一局的记录"),
      tile("平均走到", ends.length ? `第 ${fmt1(avgFloor)} 层` : "—", ends.length ? `一共 ${ends.length} 局` : "还没有完整一局的记录"),
      tile("每场战斗", a.fights ? `${fmt1(a.fightTurns / a.fights)} 回合` : "—", a.fights ? `平均掉 ${fmt1(a.fightHpLost / a.fights)} 血，一共 ${a.fights} 场` : "还没有打完的战斗"),
      tile("填了问卷", String(a.surveyed), `一共 ${a.total} 份记录`)
    ].join("");
    const parts = [
      part("完整一局停在哪一层", bars(stopRows(a), "还没有没打通的完整一局"), "不算通关的局；条的长短是局数。"),
      part("选路：进了哪种节点", bars(ranked(a.nodeChoices, "次"), "还没有完整一局的记录")),
      part("输在谁手上", bars(ranked(a.lostTo, "次"), "还没有打输的战斗"), "打输的那一场里一开始有哪些敌人。"),
      part("奇遇怎么选", bars(ranked(a.eventChoices, "次"), "还没有人遇到奇遇")),
      part("出牌次数（前 15 张）", bars(ranked(a.cardPlays, "次", 15), "还没有出过牌"))
    ].join("");
    return head + `<div class="tiles">${tiles}</div>`
      + `<div class="sum-grid">${parts}</div>`
      + (a.skipped ? `<p class="note">没算开了锁血或无限费用的 ${a.skipped} 份记录。</p>` : "")
      + `<h3 class="sum-h">卡牌：选取率和胜率</h3>${cardsTable(a)}`
      + `<h3 class="sum-h">奇物</h3>${relicsTable(a)}`
      + surveyPart(a)
      + "</section>";
  }

  /* ---------- 一份记录的详情 ---------- */
  function groupNames(list) {
    const groups = {};
    for (const n of list) groups[n] = (groups[n] || 0) + 1;
    return Object.keys(groups).map(k => `${k} ×${groups[k]}`).join("、") || "空";
  }

  function fightsHtml(fights, mode) {
    if (!fights.length) return '<p class="note">没有打完的战斗。</p>';
    return `<div class="fights">${fights.map(f => {
      const type = Object.prototype.hasOwnProperty.call(D.NODE_TYPES, f.type) ? D.NODE_TYPES[f.type] : "";
      const where = mode === "run" ? `第 ${num(f.floor)} 层${type ? ` · ${type}` : ""}` : "沙盒";
      const res = f.result === "win" ? "胜利" : f.result === "lose" ? "失败" : "没打完";
      return `<details><summary>${esc(where)}：${esc(arr(f.enemies).join("、"))} · ${res} · ${num(f.turns)} 回合 · 掉了 ${num(f.hpLost)} 血</summary>`
        + `<p class="note">打出 ${num(f.cardsPlayed)} 张牌，造成 ${num(f.damageDealt)} 点伤害，被打爆 ${num(f.slotsLost)} 个卡槽。</p>`
        + `<ol class="flog">${arr(f.log).map(l => `<li>${esc(l)}</li>`).join("")}</ol></details>`;
    }).join("")}</div>`;
  }

  function answersHtml(sv) {
    const ans = sv && sv.answers;
    if (!ans || typeof ans !== "object") return '<p class="note">没填。</p>';
    const qs = (sv.questions && typeof sv.questions === "object") ? sv.questions : {};
    const known = D.SURVEY.filter(q => ans[q.id] != null && String(ans[q.id]) !== "").map(q => [q.q, q.type === "scale" ? `${ans[q.id]} 分` : ans[q.id]]);
    const other = Object.keys(ans).filter(k => !D.SURVEY.some(q => q.id === k)).map(k => [qs[k] || k, ans[k]]);
    return `<p class="note">${esc(fmtTime(sv.at))} 填的</p><dl class="answers">${known.concat(other).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
  }

  function detailHtml(r, src) {
    const s = r.summary || {};
    const god = (r.settings && r.settings.god) || {};
    const rows = r.mode === "run"
      ? [["结果", resultName(r)], ["走到", floorName(s.floor, s.floors)], ["剩余生命", `${num(s.hp)}/${num(s.maxHp)}`], ["金币", num(s.gold)],
        ["打赢的战斗", num(s.battles)], ["打赢的挑战", num(s.elites)], ["一共掉血", num(s.hpLost)], ["战斗回合数", num(s.turns)],
        ["加入卡组的牌", num(s.cardsAdded)], ["删掉的牌", num(s.cardsRemoved)]]
      : [["结果", resultName(r)], ["回合数", num(s.turns)], ["剩余生命", `${num(s.hp)}/${num(s.maxHp)}`], ["掉血", num(s.hpLost)],
        ["被打爆的卡槽", num(s.slotsLost)], ["打出的牌", num(s.cardsPlayed)], ["造成伤害", num(s.damageDealt)]];
    const flags = [god.lockHp && "锁血", god.infiniteEnergy && "无限费用"].filter(Boolean);
    let html = `<div class="result rec-view" role="dialog" aria-modal="true" aria-labelledby="rv-title"><h2 id="rv-title">${esc(MODE_NAME[r.mode])} · ${esc(resultName(r))}</h2>`
      + `<p class="note">种子 ${esc(r.seed)} · 开始 ${esc(fmtTime(r.startedAt) || "不知道")}${r.endedAt ? ` · 结束 ${esc(fmtTime(r.endedAt))}` : ""}${flags.length ? ` · ${flags.join("、")}` : ""}</p>`
      + `<dl class="stats">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
    const sec = (title, body) => `<div class="rv-part"><h3 class="sub">${esc(title)}</h3>${body}</div>`;
    const nodeName = t => (Object.prototype.hasOwnProperty.call(D.NODE_TYPES, t) ? D.NODE_TYPES[t] : String(t));
    if (r.mode === "run") {
      /* 经过：进一个节点起一行（加粗），这个节点里发生的事排在它下面。 */
      const steps = arr(r.timeline).filter(t => t && typeof t === "object").map(t =>
        `<li class="${t.kind === "enter" ? "enter" : ""}">${esc(t.text)}</li>`).join("");
      html += sec("路线", `<p>${esc(arr(r.path).map(nodeName).join(" → ") || "还没出发")}</p>`)
        + sec(`最后的卡组（${arr(r.finalDeck).length} 张）`, `<p>${esc(groupNames(arr(r.finalDeck).map(String)))}</p>`)
        + sec("奇物", `<p>${esc(arr(s.relics).join("、") || "无")}</p>`)
        + sec("经过", steps ? `<ol class="timeline">${steps}</ol>` : '<p class="note">没有记录。</p>');
    } else {
      html += sec("敌人", `<p>${esc(arr(s.enemies).join("、") || "没有")}</p>`)
        + sec(`卡组（${arr(r.finalDeck).length} 张）`, `<p>${esc(groupNames(arr(r.finalDeck).map(String)))}</p>`);
    }
    html += sec("每场战斗（点开看日志）", fightsHtml(arr(r.fights), r.mode))
      + sec("问卷", answersHtml(r.survey))
      + `<div class="actions"><button type="button" class="btn-main" data-rc="dl" data-src="${src}" data-id="${esc(r.id)}">下载这份记录</button>`
      + '<button type="button" class="btn" data-close-modal>关闭</button></div></div>';
    return html;
  }

  /* ---------- 操作 ---------- */
  function find(src, id) {
    if (src === "imported") return V.imported.find(r => r.id === id) || null;
    if (src === "server") return (V.server || []).find(r => r.id === id) || null;
    return getLocal(id);
  }

  function armConfirm(key) {
    V.confirm = key;
    clearTimeout(V.timer);
    V.timer = setTimeout(() => { V.confirm = null; if (!$("#records").hidden) render(); }, 3500);
  }

  function surveyFor(rec, src) {
    openSurvey({
      about: `${MODE_NAME[rec.mode]} · ${resultName(rec)} · ${fmtTime(rec.endedAt || rec.startedAt)}`,
      answers: defaultAnswers(rec.survey),
      ctx: { cards: arr(rec.finalDeck), enemies: [].concat(...arr(rec.fights).map(f => arr(f && f.enemies))) },
      onSubmit(survey, dl) {
        const next = Object.assign({}, rec, { survey });
        if (src === "imported") V.imported = V.imported.map(r => (r.id === rec.id ? next : r));
        else if (src === "server") V.server = V.server.map(r => (r.id === rec.id ? next : r));
        else { if (!put(next)) U.flash("浏览器里存不下了，请直接下载"); upload(next); }
        render();
        if (dl) download(next); else U.flash("问卷已保存", "ok");
      }
    });
  }

  function importTexts(items) {
    let found = [];
    const bad = [];
    for (const it of items) {
      let list = [];
      try { list = REC.normalizeImport(JSON.parse(it.text)); } catch (e) { list = []; }
      if (list.length) found = found.concat(list); else bad.push(it.name);
    }
    const before = V.imported.length;
    V.imported = REC.sort(REC.dedupe(V.imported.concat(found)));
    render();
    const fresh = V.imported.length - before;
    const badText = bad.length ? `${bad.join("、")} 不是对局记录` : "";
    if (!found.length) { U.flash(badText || "没有可以导入的内容"); return; }
    U.flash(`导入了 ${fresh} 份记录${found.length > fresh ? `（另有 ${found.length - fresh} 份之前导入过）` : ""}${badText ? `；${badText}` : ""}`, bad.length ? undefined : "ok");
  }

  function readText(file) {
    if (file.size > MAX_FILE) return Promise.reject(new Error("too big"));
    if (file.text) return file.text();
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = rej;
      fr.readAsText(file);
    });
  }

  function onAct(b) {
    const act = b.dataset.rc;
    const id = b.dataset.id;
    const rec = id != null ? find(b.dataset.src, id) : null;
    switch (act) {
      case "detail": if (rec) U.openModal(detailHtml(rec, b.dataset.src)); return;
      case "dl": if (rec) download(rec); return;
      case "survey": if (rec) surveyFor(rec, b.dataset.src); return;
      case "del":
        if (V.confirm !== "del:" + id) { armConfirm("del:" + id); render(); return; }
        V.confirm = null;
        removeLocal(id);
        render();
        return;
      case "unimport": V.imported = V.imported.filter(r => r.id !== id); render(); return;
      case "unimport-all": V.imported = []; render(); return;
      case "dl-local": downloadMany(REC.sort(readAll())); return;
      case "dl-merged": downloadMany(REC.sort(REC.dedupe((V.includeLocal ? readAll() : []).concat(V.imported, V.server || [])))); return;
      case "dl-server": downloadMany(V.server || []); return;
      case "server-login": {
        const k = ($("#admin-key") || {}).value || "";
        if (!k.trim()) { U.flash("先填后台密码"); return; }
        loadServer(k.trim());
        return;
      }
      case "server-load": loadServer(adminKey()); return;
      case "server-logout": setAdminKey(""); V.server = null; render(); return;
      case "server-del":
        if (V.confirm !== "sdel:" + id) { armConfirm("sdel:" + id); render(); return; }
        V.confirm = null;
        deleteServer(id);
        return;
      case "clear":
        if (V.confirm !== "clear") { armConfirm("clear"); render(); return; }
        V.confirm = null;
        clearLocal();
        render();
        return;
      case "paste": {
        const ta = $("#rec-paste");
        if (ta && ta.value.trim()) importTexts([{ name: "粘贴的内容", text: ta.value }]);
        else U.flash("先把记录内容粘贴进来");
        return;
      }
      case "copy": copyText(); return;
      case "sort": V.sort = b.dataset.k; render(); return;
      default: return;
    }
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.dataset.rc === "include-local") { V.includeLocal = t.checked; render(); return; }
    if (t.dataset.rc === "skip-god") { V.skipGod = t.checked; render(); return; }
    if (t.dataset.rc === "upload-toggle") { U.S.set.upload = t.checked; U.saveSettings(); return; }
    if (t.dataset.rc === "file" && t.files && t.files.length) {
      const files = Array.from(t.files);
      Promise.all(files.map(f => readText(f).then(text => ({ name: f.name, text }), () => ({ name: f.name, text: "" })))).then(importTexts);
    }
  }

  $("#records").addEventListener("click", ev => {
    const b = ev.target.closest("[data-rc]");
    if (b && b.tagName !== "INPUT") onAct(b);
  });
  $("#records").addEventListener("change", onChange);
  // 页面重画时记住后台列表是不是展开着（不然点「删掉」要确认时列表会收起来）
  $("#records").addEventListener("toggle", ev => {
    if (ev.target.classList && ev.target.classList.contains("server-list")) V.serverOpen = ev.target.open;
  }, true);
  $("#modal").addEventListener("click", ev => {
    const b = ev.target.closest("[data-sv], [data-rc]");
    if (!b) return;
    if (b.dataset.sv === "save-dl" || b.dataset.sv === "save") submitModalSurvey(b.dataset.sv === "save-dl");
    else if (b.dataset.sv === "cancel") { V.survey = null; U.closeModal(); }
    else if (b.dataset.rc) onAct(b);
  });

  QW.ui.records = { show, put, download, upload, uploadText, surveyFields, readSurvey, answered, rememberTester, defaultAnswers, openSurvey };
})();
