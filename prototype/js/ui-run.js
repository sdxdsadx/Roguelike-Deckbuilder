/* 完整一局的页面：开局、地图、奇遇、商店、阳台、宝箱、奖励、结算。战斗用 ui-combat.js。
   这一局的进度会存在浏览器里，刷新页面后可以接着走；如果是在战斗中刷新，这一场会从头打。 */
(function () {
  "use strict";
  const QW = window.QW;
  const D = QW.data;
  const U = QW.ui;
  const R = QW.run;
  const RC = QW.ui.records;
  const { $, esc, clamp, clone, RUN_RANGE } = U;
  const RUN_STORE = "slot-roguelike-run-v1";
  const TYPE_NAME = D.NODE_TYPES;
  const RS = { run: null, confirmNew: false, confirmAbandon: false, timer: null };

  const RUN_FIELDS = [
    ["floors", "一共几层（含 Boss）"], ["rewardFloor", "固定出宝箱的层"], ["startGold", "开局金币"], ["goldBattle", "普通战斗掉金币"], ["goldElite", "挑战掉金币"],
    ["goldBoss", "Boss 掉金币"], ["restHeal", "阳台回血"], ["rarePct", "梦想卡出现率（%）"], ["eliteRarePct", "挑战后梦想卡出现率（%）"],
    ["shopCards", "商店卖几张牌"], ["shopRelics", "商店卖几个奇物"], ["cardPrice", "商店卡牌价格"]
  ];
  const WEIGHT_FIELDS = [["event", "奇遇"], ["elite", "挑战"], ["rest", "阳台"], ["shop", "商店"]];

  /* ---------- 存档 ---------- */
  function saveRun() { try { if (RS.run) localStorage.setItem(RUN_STORE, JSON.stringify(RS.run)); } catch (e) { /* 存不了就不存 */ } }
  function clearRun() { try { localStorage.removeItem(RUN_STORE); } catch (e) { /* 忽略 */ } }
  function loadRun() {
    try {
      const r = JSON.parse(localStorage.getItem(RUN_STORE) || "null");
      if (r && r.v === 2 && r.map && Array.isArray(r.map.rows) && r.screen && Array.isArray(r.deck) && r.deck.every(x => x && D.CARDS[x.id])) {
        // 加对局记录之前存下的进度：从现在开始记
        if (!r.record || !Array.isArray(r.record.timeline) || !Array.isArray(r.record.fights)) {
          r.record = { id: `run-${r.seed}-${Date.now().toString(36)}`, startedAt: null, timeline: [], fights: [] };
        }
        if (r.survey === undefined) r.survey = null;
        return r;
      }
    } catch (e) { /* 存档坏了就当没有 */ }
    return null;
  }

  /* ---------- 对局记录 ----------
     一局结束（或者中途放弃）就存一份到「对局记录」里；之后填问卷、再结束都只更新这一份。 */
  function keepRecord(run) {
    if (!run || !run.record || !run.visited.length) return null;
    const rec = QW.record.fromRun(run, U.S.set);
    if (!RC.put(rec)) U.flash("浏览器里存不下这份记录了，请直接下载");
    return rec;
  }

  function abandonRecord(run) {
    if (!run || run.result || !run.record || !run.visited.length) return null;
    run.record.abandoned = true;
    run.record.endedAt = new Date().toISOString();
    return keepRecord(run);
  }

  function surveyContext(run) {
    const enemies = [].concat(...(run.record ? run.record.fights : []).map(f => f.enemies || []));
    return { cards: run.deck.map(c => D.CARDS[c.id].name), enemies };
  }

  function submitSurvey(download) {
    const run = RS.run;
    const answers = RC.readSurvey($("#run-survey"));
    if (!RC.answered(answers)) { U.flash("问卷还是空的，至少答一题"); return; }
    RC.rememberTester(answers.tester);
    run.survey = QW.record.makeSurvey(answers);
    const rec = keepRecord(run);
    saveRun();
    renderPlay();
    if (download && rec) RC.download(rec); else U.flash("问卷已保存，和这一局的记录存在一起", "ok");
  }

  function floorText(run) {
    if (run.floor === 0) return "还没出发";
    return run.floor >= run.cfg.floors ? "Boss 层" : `第 ${run.floor} 层`;
  }

  function showMain() { document.querySelectorAll("main").forEach(m => { m.hidden = m.id !== "run"; }); }

  /* ---------- 入口 ---------- */
  function show() {
    QW.ui.combat.stop();
    if (!RS.run) RS.run = loadRun();
    if (RS.run && !(RS.run.result && RS.run.screen.kind === "end")) route();
    else renderStart();
  }

  function route() {
    const run = RS.run;
    run.lockHp = !!U.S.set.god.lockHp;
    if (run.result) keepRecord(run);
    saveRun();
    if (run.screen.kind === "combat") startFight();
    else renderPlay();
  }

  function newRun(seed) {
    const s = U.S.set;
    s.runSeed = String(seed);
    U.saveSettings();
    abandonRecord(RS.run);  // 覆盖掉没打完的上一局：记成放弃
    RS.run = R.createRun({ seed: s.runSeed, run: s.run, config: s.config });
    RS.confirmNew = false;
    window.scrollTo(0, 0);
    route();
  }

  /* 需要再点一次确认的按钮：3.5 秒内没再点，就把文字改回去。 */
  function armConfirm(key) {
    RS[key] = true;
    clearTimeout(RS.timer);
    RS.timer = setTimeout(() => {
      RS[key] = false;
      const b = key === "confirmNew" ? document.querySelector('#run [data-ract="new"]') : document.querySelector('.top [data-act="abandon"]');
      if (b) b.textContent = key === "confirmNew" ? "开始新的一局" : "放弃这一局";
    }, 3500);
  }

  /* ---------- 开局页 ---------- */
  function renderStart() {
    QW.ui.combat.stop();
    showMain();
    U.setTop("<span>从第一层走到血色魅影</span>", [], null);
    const s = U.S.set;
    const saved = RS.run && !RS.run.result ? RS.run : null;
    const last = RS.run && RS.run.result ? RS.run : null;
    const fields = RUN_FIELDS.map(([k, label]) =>
      `<label class="field" for="run-${k}">${label}<input id="run-${k}" type="number" inputmode="numeric" data-rset="${k}" min="${RUN_RANGE[k][0]}" max="${RUN_RANGE[k][1]}" value="${s.run[k]}"></label>`).join("");
    const weights = WEIGHT_FIELDS.map(([k, label]) =>
      `<label class="field" for="w-${k}">${label}<input id="w-${k}" type="number" inputmode="numeric" data-rweight="${k}" min="0" max="100" value="${s.run.weights[k]}"></label>`).join("");
    $("#run").innerHTML = '<div class="run-start">'
      + '<section class="box" aria-labelledby="h-run"><h2 id="h-run">第一区域</h2>'
      + "<p>一共 12 层。第 1 层打小怪，第 6 层固定是宝箱，第 11 层是阳台，第 12 层打血色魅影；其余每层有 3 个选项，任选一个往上走。整张地图开局就能看到，血量、卡组、金币和奇物一路带着走。</p>"
      + (saved ? `<div class="resume"><p>上一局停在第 ${saved.floor} 层，生命 ${saved.hp}/${saved.maxHp}，金币 ${saved.gold}。</p><button type="button" class="btn-main" data-ract="resume">继续上一局</button></div>` : "")
      + (last ? `<p class="note">上一局（种子 ${esc(last.seed)}，${last.result === "win" ? "通关" : "失败"}）的记录在「对局记录」里，可以在那里补填问卷、下载。</p>` : "")
      + `<div class="seed-row"><label class="field" for="run-seed">随机种子<input id="run-seed" type="text" maxlength="24" data-rset="runSeed" value="${esc(s.runSeed)}"></label><button type="button" class="btn" data-ract="seed-new">换一个</button></div>`
      + `<div class="actions-row"><button type="button" class="${saved ? "btn" : "btn-main"}" data-ract="new">${saved && RS.confirmNew ? "会覆盖上一局，再点一次确认" : "开始新的一局"}</button></div>`
      + "</section>"
      + '<section class="box" aria-labelledby="h-run-rules"><div class="box-head"><h2 id="h-run-rules">这一局的数</h2><button type="button" class="btn" data-ract="cfg-reset">恢复默认</button></div>'
      + `<div class="fields">${fields}</div><h3 class="sub">随机层的另外 2 个选项按这个比例分配（每个随机层固定有 1 个战斗）</h3><div class="fields">${weights}</div>`
      + "<p class=\"note\">层数和固定层已经确认，金币和商店卡牌价格是问卷里定的；宝箱放在第几层、节点比例、阳台回血、梦想卡出现率、商店货量是我先定的默认值（待确认），改完下一局生效。卡牌和敌人的数值、锁血和无限费用在「战斗沙盒」的设置页里改，两边通用。</p>"
      + "</section></div>";
  }

  /* ---------- 一局中的页面 ---------- */
  function relicButtons(run) {
    return Object.keys(run.relics).filter(id => run.relics[id]).map(id => {
      const extra = id === "ring" ? `（剩 ${run.ring}）` : id === "netsuke" && run.netsukeUsed ? "（已失效）" : id === "beeswax" && run.waxSlot != null ? `（第 ${run.waxSlot + 1} 槽）` : "";
      return `<button type="button" class="rbtn" data-rtip="${id}">${esc(D.RELICS[id].name)}${esc(extra)}</button>`;
    }).join("");
  }

  function hudHtml(run) {
    return `<div class="run-hud"><div class="stat hp"><span class="n">${run.hp}</span><span class="of">/${run.maxHp}</span><span class="lbl">生命</span></div>`
      + `<div class="stat gold"><span class="n">${run.gold}</span><span class="lbl">金币</span></div>`
      + (run.floor >= run.cfg.floors ? '<div class="stat"><span class="n">Boss</span><span class="lbl">层</span></div>'
        : `<div class="stat"><span class="n">${run.floor}</span><span class="of">/${run.cfg.floors}</span><span class="lbl">层</span></div>`)
      + `<button type="button" class="btn" data-ract="deck">卡组 ${run.deck.length} 张</button>`
      + (run.nextStrength ? `<span class="rchip">下一场敌人 +${run.nextStrength} 力量</span>` : "")
      + `<div class="relic-row">${relicButtons(run)}</div></div>`;
  }

  /* 地图：从下往上，第 1 层在最下面。每层的选项横着排开；走过的路连成实线，从当前位置到下一层的选项画虚线。 */
  function mapHtml(run) {
    const rows = run.map.rows.slice().sort((a, b) => a.floor - b.floor);
    const n = rows.length;
    const first = rows[0].floor;
    const yOf = f => (n - (f - first) - 0.5) / n * 100;
    const xsFor = k => (k === 1 ? [50] : k === 2 ? [30, 70] : Array.from({ length: k }, (_, i) => (i + 0.5) / k * 100));
    const pos = {};
    for (const r of rows) {
      const xs = xsFor(r.options.length);
      r.options.forEach((o, i) => { pos[o.id] = { x: xs[i], y: yOf(r.floor) }; });
    }
    const avail = new Set(R.available(run));
    const seg = (a, b, cls) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${cls}"></line>`;
    const walked = run.visited.filter(id => pos[id]);
    let lines = "";
    for (let k = 1; k < walked.length; k++) lines += seg(pos[walked[k - 1]], pos[walked[k]], "walked");
    if (run.pos && pos[run.pos] && !run.freeTravel) for (const id of avail) lines += seg(pos[run.pos], pos[id], "open");
    const btn = o => {
      const can = avail.has(o.id);
      const cls = ["mnode", "t-" + o.type];
      if (can) cls.push("avail");
      if (run.visited.includes(o.id)) cls.push("visited");
      if (run.pos === o.id) cls.push("here");
      const where = o.type === "boss" ? "第 12 层，Boss：血色魅影" : `第 ${o.floor} 层，${TYPE_NAME[o.type]}`;
      return `<button type="button" class="${cls.join(" ")}" data-node="${o.id}" style="left:${pos[o.id].x}%;top:${pos[o.id].y}%"${can ? "" : " disabled"} aria-label="${esc(where)}${can ? "，可以去" : ""}">${TYPE_NAME[o.type]}</button>`;
    };
    const labels = rows.map(r => `<span class="floor-no${r.floor === run.floor + 1 ? " next" : ""}" style="top:${yOf(r.floor)}%">${r.floor}</span>`).join("");
    const bands = rows.map(r => r.floor === run.floor + 1 ? `<span class="floor-band" style="top:${yOf(r.floor)}%"></span>` : "").join("");
    return `<div class="map-wrap"><div class="map" style="height:${n * 64}px">${bands}<svg class="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>`
      + `${labels}${rows.map(r => r.options.map(btn).join("")).join("")}</div></div>`;
  }

  function mapScreen(run) {
    const legend = Object.entries(TYPE_NAME).map(([k, v]) => `<span class="lg t-${k}">${v}</span>`).join("");
    return `<section class="map-screen" aria-labelledby="h-map"><div class="box-head"><h2 id="h-map">第一区域地图</h2><span class="hint">从下往上走，每层任选一个；整张地图开局就能看到</span></div>`
      + mapHtml(run) + `<div class="map-legend">${legend}</div>`
      + '<details class="run-debug"><summary>调试</summary><div class="row-f">'
      + '<button type="button" class="btn" data-ract="dbg-gold">金币 +10</button>'
      + '<button type="button" class="btn" data-ract="dbg-heal">回满血</button>'
      + '<button type="button" class="btn" data-ract="dbg-boss">直接打 Boss</button>'
      + `<button type="button" class="btn" data-ract="dbg-free" aria-pressed="${!!run.freeTravel}">${run.freeTravel ? "关掉随便走" : "可以随便走"}</button>`
      + "</div></details></section>";
  }

  function notesHtml(list) {
    return list && list.length ? `<ul class="notes">${list.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
  }

  function stepHtml(run) {
    const s = R.currentStep(run);
    if (!s) return "";
    let body = "";
    if (s.kind === "cards") {
      body = `<div class="hand pick-row">${s.options.map((c, i) => U.ticket(c, { attrs: `data-ract="pick" data-i="${i}"` })).join("")}</div>`
        + '<div class="actions-row"><button type="button" class="btn" data-ract="skip">不要了，跳过</button></div>';
    } else if (s.kind === "remove") {
      body = `<div class="deck-grid">${run.deck.map((c, i) => U.ticket(c, { attrs: `data-ract="pick" data-i="${i}"`, cls: ["small"] })).join("")}</div>`;
    } else if (s.kind === "upgrade") {
      body = `<p class="note">下面显示的是升级以后的样子。</p><div class="deck-grid">${run.deck.map((c, i) => R.canUpgrade(c)
        ? U.ticket({ id: c.id, up: true }, { attrs: `data-ract="pick" data-i="${i}"`, cls: ["small"] }) : "").join("")}</div>`
        + (s.cancel ? '<div class="actions-row"><button type="button" class="btn" data-ract="cancel">先不升级了</button></div>' : "");
    } else if (s.kind === "wax") {
      body = `<div class="slot-pick">${[0, 1, 2, 3, 4].map(i => `<button type="button" class="btn" data-ract="pick" data-i="${i}">第 ${i + 1} 槽</button>`).join("")}</div>`;
    }
    const left = s.kind === "remove" && s.count > 1 ? `（还要删 ${s.count} 张）` : "";
    return `<div class="step" role="group" aria-labelledby="h-step"><h3 id="h-step">${esc(s.title)}${left}</h3>${body}</div>`;
  }

  function continueBtn(run, label) {
    return R.currentStep(run) ? "" : `<div class="actions-row"><button type="button" class="btn-main" data-ract="leave">${esc(label || (run.result ? "看这局总结" : "回到地图"))}</button></div>`;
  }

  function eventScreen(run) {
    const sc = run.screen;
    const ev = D.EVENTS.find(e => e.id === sc.event);
    let html = `<section class="box event" aria-labelledby="h-ev"><h2 id="h-ev">${esc(ev.name)}</h2><div class="event-text">${ev.text.split("\n").map(p => `<p>${esc(p)}</p>`).join("")}</div>`;
    if (sc.choice == null) {
      html += `<div class="choices">${ev.options.map((o, i) =>
        `<button type="button" class="choice" data-ract="choose" data-i="${i}"><b>${esc(o.label)}</b><span>${esc(o.effect)}</span></button>`).join("")}</div>`;
    } else {
      html += `<div class="outcome"><p class="chosen">你选了「${esc(ev.options[sc.choice].label)}」</p>${notesHtml(sc.lines)}`
        + (sc.note ? `<p class="record">表里的记录：${esc(sc.note)}</p>` : "") + "</div>";
      html += notesHtml(sc.notes) + stepHtml(run) + continueBtn(run);
    }
    return html + "</section>";
  }

  function shopScreen(run) {
    const sh = run.screen.shop;
    const price = R.removalPrice(run);
    const cards = sh.cards.map((c, i) => U.ticket(c, {
      attrs: `data-ract="buy-card" data-i="${i}"${c.sold ? " disabled" : ""}`,
      cls: c.sold ? ["sold"] : [],
      label: `${U.cardLabel(c)}，${c.sold ? "已买" : `${c.price} 金币`}，${U.cardText(c)}`,
      extra: `<span class="price${!c.sold && run.gold < c.price ? " poor" : ""}">${c.sold ? "已买" : `${c.price} 金币`}</span>`
    })).join("");
    const relics = sh.relics.map((r, i) => `<button type="button" class="relic-item" data-ract="buy-relic" data-i="${i}"${r.sold ? " disabled" : ""}>`
      + `<b>${esc(D.RELICS[r.id].name)}</b><span>${esc(D.RELICS[r.id].text)}</span><span class="price">${r.sold ? "已买" : `${r.price} 金币`}</span></button>`).join("");
    return `<section class="box shop" aria-labelledby="h-shop"><div class="box-head"><h2 id="h-shop">商店</h2><span class="hint">你有 ${run.gold} 金币</span></div>`
      + `<h3 class="sub">卡牌</h3><div class="hand shop-row">${cards || '<span class="note">没有卡牌卖</span>'}</div>`
      + `<h3 class="sub">奇物</h3><div class="relic-shop">${relics || '<span class="note">没有奇物卖</span>'}</div>`
      + `<h3 class="sub">删牌</h3><div class="actions-row"><button type="button" class="btn" data-ract="buy-removal"${sh.removeUsed ? " disabled" : ""}>${sh.removeUsed ? "这个商店已经删过一次牌了" : `花 ${price} 金币删一张牌`}</button></div>`
      + notesHtml(run.screen.notes) + stepHtml(run) + continueBtn(run, "离开商店") + "</section>";
  }

  function restScreen(run) {
    const sc = run.screen;
    const healTo = Math.min(run.maxHp, run.hp + run.cfg.restHeal);
    let html = '<section class="box rest" aria-labelledby="h-rest"><h2 id="h-rest">阳台</h2>';
    if (!sc.done) {
      html += '<div class="choices">'
        + `<button type="button" class="choice" data-ract="rest-heal"><b>回血</b><span>回复 ${run.cfg.restHeal} 点生命（${run.hp} → ${healTo}）</span></button>`
        + '<button type="button" class="choice" data-ract="rest-upgrade"><b>升级一张牌</b><span>从卡组里挑一张升级</span></button></div>';
    }
    return html + notesHtml(sc.notes) + stepHtml(run) + (sc.done ? continueBtn(run) : "") + "</section>";
  }

  function treasureScreen(run) {
    const sc = run.screen;
    return '<section class="box" aria-labelledby="h-chest"><h2 id="h-chest">宝箱</h2>'
      + (sc.opened ? `${notesHtml(sc.lines.map(l => `获得${l}`))}${notesHtml(sc.notes)}${stepHtml(run)}${continueBtn(run)}`
        : '<div class="actions-row"><button type="button" class="btn-main" data-ract="open">打开宝箱</button></div>')
      + "</section>";
  }

  function rewardScreen(run) {
    const sc = run.screen;
    const title = { battle: "战斗胜利", elite: "挑战胜利", boss: "击败了血色魅影" }[sc.type] || "胜利";
    return `<section class="box reward" aria-labelledby="h-reward"><h2 id="h-reward">${title}</h2>`
      + (sc.got.length ? notesHtml(sc.got.map(g => `获得${g}`)) : "")
      + notesHtml(sc.notes) + stepHtml(run) + continueBtn(run) + "</section>";
  }

  function endScreen(run) {
    const win = run.result === "win";
    const st = run.stats;
    const groups = {};
    for (const c of run.deck) { const k = U.cardLabel(c); groups[k] = (groups[k] || 0) + 1; }
    const deckText = Object.entries(groups).map(([k, n]) => `${k} ×${n}`).join("、") || "空";
    const relicText = Object.keys(run.relics).filter(id => run.relics[id]).map(id => D.RELICS[id].name).join("、");
    const rows = [["走到哪里", floorText(run)], ["打赢的战斗", st.battles], ["打赢的挑战", st.elites], ["剩余生命", `${run.hp}/${run.maxHp}`],
      ["一共掉血", st.hpLost], ["战斗回合数", st.turns], ["赚到的金币", st.goldEarned], ["花掉的金币", st.goldSpent], ["加入卡组的牌", st.cardsAdded], ["删掉的牌", st.cardsRemoved]];
    return `<section class="box end ${win ? "win" : "lose"}" aria-labelledby="h-end"><h2 id="h-end">${win ? "第一区域通关" : "这一局结束了"}</h2>`
      + `<p>${win ? "你击败了血色魅影。" : `你倒在了${floorText(run)}。`}种子 ${esc(run.seed)}。</p>`
      + notesHtml(run.screen.notes)
      + `<dl class="stats">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`
      + `<p><b>路线</b>：${esc(st.path.map(t => TYPE_NAME[t]).join(" → ") || "还没出发")}</p>`
      + `<p><b>最后的卡组（${run.deck.length} 张）</b>：${esc(deckText)}</p>`
      + `<p><b>奇物</b>：${esc(relicText || "无")}</p>`
      + '<div class="actions-row"><button type="button" class="btn-main" data-ract="again-new">再来一局</button>'
      + '<button type="button" class="btn" data-ract="again-same">同一个种子再来一局</button>'
      + '<button type="button" class="btn" data-ract="to-start">改开局设置</button></div></section>'
      + surveyBox(run);
  }

  /* 局末的反馈问卷：和这一局的记录存在一起，提交时顺便下载记录文件，发给策划。 */
  function surveyBox(run) {
    const done = run.survey;
    const when = done ? new Date(done.at) : null;
    const at = when && !isNaN(when.getTime()) ? `${when.getHours()}:${String(when.getMinutes()).padStart(2, "0")}` : "";
    return '<section class="box survey-box" aria-labelledby="h-survey"><div class="box-head"><h2 id="h-survey">反馈问卷</h2>'
      + `<span class="hint">${done ? `${at} 提交过了，改完可以再提交一次` : "都是选填，填多少算多少"}</span></div>`
      + `<div class="survey" id="run-survey">${RC.surveyFields(RC.defaultAnswers(done), surveyContext(run), "rs")}</div>`
      + `<div class="actions-row"><button type="button" class="btn-main" data-ract="survey-dl">${done ? "更新问卷并下载记录" : "提交问卷并下载记录"}</button>`
      + `<button type="button" class="btn" data-ract="survey-save">${done ? "只更新问卷" : "只提交问卷"}</button>`
      + '<button type="button" class="btn" data-ract="record-dl">只下载记录</button></div>'
      + '<p class="note">记录是一个 JSON 文件，里面有这一局的路线、每一步的选择、每场战斗的日志和问卷的答案，直接发给策划就行。所有记录都能在顶上的「对局记录」里找到。</p></section>';
  }

  function topInfo(run) {
    return `<span>第一区域</span><span>${esc(floorText(run))}</span><span>种子 <b class="num">${esc(run.seed)}</b></span>`;
  }

  function onTop(a) {
    if (a === "deck") showDeck();
    else if (a === "abandon") {
      if (!RS.confirmAbandon) { armConfirm("confirmAbandon"); renderPlay(); return; }
      RS.confirmAbandon = false;
      const kept = abandonRecord(RS.run);
      clearRun();
      RS.run = null;
      renderStart();
      if (kept) U.flash("这一局记成了「放弃」，记录在「对局记录」里，可以在那里填问卷", "ok");
    }
  }

  function renderPlay() {
    showMain();
    const run = RS.run;
    const ended = run.screen.kind === "end";
    U.setTop(topInfo(run), [{ act: "deck", label: `卡组 ${run.deck.length}` }].concat(ended ? [] : [{ act: "abandon", label: RS.confirmAbandon ? "确定放弃这一局？再点一次" : "放弃这一局" }]), onTop);
    const kind = run.screen.kind;
    const body = kind === "map" ? mapScreen(run)
      : kind === "event" ? eventScreen(run)
        : kind === "shop" ? shopScreen(run)
          : kind === "rest" ? restScreen(run)
            : kind === "treasure" ? treasureScreen(run)
              : kind === "reward" ? rewardScreen(run)
                : endScreen(run);
    $("#run").innerHTML = `<div class="run">${hudHtml(run)}${body}</div>`;
    if (kind === "map") {
      const el = document.querySelector(".mnode.avail");
      if (el) el.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }

  function showDeck() {
    const run = RS.run;
    if (!run) return;
    const order = { "攻击": 0, "防御": 1, "技能": 2, "能力": 3, "状态": 4, "诅咒": 5 };
    const cards = run.deck.slice().sort((a, b) => order[D.CARDS[a.id].type] - order[D.CARDS[b.id].type] || D.CARDS[a.id].name.localeCompare(D.CARDS[b.id].name, "zh"));
    U.openModal(`<div class="result deck-view" role="dialog" aria-modal="true" aria-labelledby="deck-title"><h2 id="deck-title">卡组 ${run.deck.length} 张</h2>`
      + `<div class="deck-grid">${cards.map(c => U.ticket(c, { tag: "div", cls: ["small"] })).join("")}</div>`
      + '<div class="actions"><button type="button" class="btn-main" data-close-modal data-focus>关闭</button></div></div>');
  }

  function showRelicTip(el) {
    const id = el.dataset.rtip;
    const r = D.RELICS[id];
    U.showTip(`<h3>${esc(r.name)}</h3><p>${esc(r.text)}</p>`, el);
  }

  /* ---------- 战斗 ---------- */
  const fightCtrl = {
    info: c => `<span>${esc(floorText(RS.run))}</span><span>${esc(TYPE_NAME[RS.run.screen.type])}</span><span>第 <b class="num">${c.turn}</b> 回合</span><span>金币 <b class="num">${RS.run.gold}</b></span>`,
    actions: () => [{ act: "deck", label: `卡组 ${RS.run.deck.length}` }],
    onAct(a) {
      if (a === "continue") finishFight();
      else if (a === "retry") startFight();
      else if (a === "deck") showDeck();
    },
    result: c => c.result === "win"
      ? { cls: "win", title: { battle: "战斗胜利", elite: "挑战胜利", boss: "击败了血色魅影" }[RS.run.screen.type], rows: QW.ui.combat.statRows(c),
        buttons: [{ act: "continue", label: "领取奖励", main: true }, { act: "close-result", label: "回去看战场" }] }
      : { cls: "lose", title: "你倒下了", rows: QW.ui.combat.statRows(c),
        buttons: [{ act: "continue", label: "看这局总结", main: true }, { act: "retry", label: "重打这一场" }, { act: "close-result", label: "回去看战场" }] },
    continueLabel: c => (c.result === "win" ? "领取奖励" : "看这局总结"),
    debug: [{ act: "retry", label: "重打这一场" }]
  };

  function startFight() {
    const c = new QW.Combat(R.combatOptions(RS.run, U.S.set)).start();
    QW.ui.combat.start(c, fightCtrl);
  }

  function finishFight() {
    const c = QW.ui.combat.current();
    if (!c || !c.result) return;
    R.finishCombat(RS.run, c);
    QW.ui.combat.stop();
    window.scrollTo(0, 0);
    route();
  }

  /* ---------- 操作 ---------- */
  function onClick(ev) {
    const t = ev.target.closest("[data-ract], [data-node], [data-rtip]");
    if (!t || t.disabled) return;
    const run = RS.run;
    if (t.dataset.rtip) { showRelicTip(t); return; }
    if (t.dataset.node) {
      const r = R.go(run, t.dataset.node);
      if (!r.ok) { U.flash(r.reason); return; }
      window.scrollTo(0, 0);
      route();
      return;
    }
    const a = t.dataset.ract;
    const i = Number(t.dataset.i);
    let r = { ok: true };
    switch (a) {
      case "new":
        if (RS.run && !RS.run.result && !RS.confirmNew) { armConfirm("confirmNew"); renderStart(); return; }
        newRun(U.S.set.runSeed);
        return;
      case "resume": route(); return;
      case "seed-new": U.S.set.runSeed = U.randomSeed(); U.saveSettings(); renderStart(); return;
      case "cfg-reset": U.S.set.run = clone(D.RUN); U.saveSettings(); renderStart(); return;
      case "again-new": newRun(U.randomSeed()); return;
      case "again-same": newRun(run.seed); return;
      case "to-start": renderStart(); return;
      case "deck": showDeck(); return;
      case "survey-dl": submitSurvey(true); return;
      case "survey-save": submitSurvey(false); return;
      case "record-dl": { const rec = keepRecord(run); if (rec) RC.download(rec); return; }
      case "choose": r = R.chooseEvent(run, i); break;
      case "pick": r = R.resolveStep(run, { index: i }); break;
      case "skip": r = R.resolveStep(run, { skip: true }); break;
      case "cancel": r = R.cancelStep(run); break;
      case "buy-card": r = R.buyCard(run, i); break;
      case "buy-relic": r = R.buyRelic(run, i); break;
      case "buy-removal": r = R.buyRemoval(run); break;
      case "rest-heal": r = R.restHeal(run); break;
      case "rest-upgrade": r = R.restUpgrade(run); break;
      case "open": r = R.openTreasure(run); break;
      case "leave": r = R.leave(run); if (r.ok) window.scrollTo(0, 0); break;
      case "dbg-gold": R.debugGold(run, 10); break;
      case "dbg-heal": R.debugHeal(run); break;
      case "dbg-boss": r = R.debugBoss(run); break;
      case "dbg-free": run.freeTravel = !run.freeTravel; break;
      default: return;
    }
    if (!r.ok) { U.flash(r.reason); return; }
    route();
  }

  function onChange(ev) {
    const t = ev.target;
    const s = U.S.set;
    if (t.dataset.rset === "runSeed") { s.runSeed = t.value.trim().slice(0, 24) || U.randomSeed(); U.saveSettings(); return; }
    const v = Number(t.value);
    if (t.value === "" || !Number.isFinite(v)) return;
    if (t.dataset.rset) { const rg = RUN_RANGE[t.dataset.rset]; s.run[t.dataset.rset] = clamp(Math.round(v), rg[0], rg[1]); }
    else if (t.dataset.rweight) s.run.weights[t.dataset.rweight] = clamp(Math.round(v), 0, 100);
    else return;
    U.saveSettings();
  }

  $("#run").addEventListener("click", onClick);
  $("#run").addEventListener("change", onChange);

  QW.ui.run = { show, renderStart };
})();
