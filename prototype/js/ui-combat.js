/* 战斗画面：战场、手牌、日志、牌堆、调试。沙盒和完整一局共用，差别交给 ctrl：
   ctrl.info(c) 顶栏文字，ctrl.actions(c) 顶栏按钮，ctrl.onAct(act) 处理按钮，
   ctrl.result(c) 结束时弹窗的标题和按钮，ctrl.continueLabel(c) 关掉弹窗后底部的继续按钮，
   ctrl.debug 调试面板里额外的按钮。 */
(function () {
  "use strict";
  const QW = window.QW;
  const D = QW.data;
  const U = QW.ui;
  const { $, esc, clamp, reduceMotion, TYPE_CLASS } = U;
  const LANES = [0, 1, 2, 3, 4];
  const V = { c: null, ctrl: null, selected: null, tab: "log", logShown: 0, drag: null, suppressClick: 0 };

  function start(c, ctrl) {
    clearFloats();
    V.c = c;
    V.ctrl = ctrl;
    V.selected = null;
    V.logShown = 0;
    $("#log").innerHTML = "";
    $("#panel-debug").dataset.ready = "";
    $("#overlay").hidden = true;
    document.querySelectorAll("main").forEach(m => { m.hidden = m.id !== "combat"; });
    render();
    if (c.result) showResult();
  }

  function stop() {
    clearFloats();
    V.c = null;
    V.ctrl = null;
    V.selected = null;
    $("#overlay").hidden = true;
    $("#side").classList.remove("open");
    U.hideTip();
  }

  function clearFloats() { document.querySelectorAll(".float").forEach(f => f.remove()); }

  /* ---------- 画面 ---------- */
  function bar(hp, max, cls) {
    const pct = max > 0 ? clamp(hp / max * 100, 0, 100) : 0;
    return `<div class="bar ${cls || ""}"><i style="width:${pct.toFixed(1)}%"></i><span>${hp}/${max}</span></div>`;
  }

  function badges(o) {
    const out = [];
    if (o.armor > 0) out.push(`<span class="bd armor">甲<span class="n">${o.armor}</span></span>`);
    if (o.cold > 0) out.push(`<span class="bd cold">寒<span class="n">${o.cold}</span></span>`);
    if (o.str > 0) out.push(`<span class="bd str">力<span class="n">${o.str}</span></span>`);
    if (o.sleep) out.push('<span class="bd info">休眠</span>');
    if (o.alibi) out.push('<span class="bd info">免伤一次</span>');
    return `<div class="badges">${out.join("")}</div>`;
  }

  function intentHtml(it, ownLane) {
    if (!it) return "";
    const text = esc(it.text).replace(/(\d+)/, '<span class="v">$1</span>');
    const title = it.detail ? ` title="${esc(it.detail)}"` : "";
    return `<div class="intent ${it.type}"${title}>${text}</div>`
      + (it.type === "attack" && it.lane != null && it.lane !== ownLane ? `<div class="aim">打第 ${it.lane + 1} 槽</div>` : "")
      + (it.note ? `<div class="note-line">${esc(it.note)}</div>` : "");
  }

  function foeHtml(c, lane) {
    if (c.boss) {
      const s = c.boss.slots[lane];
      if (s.destroyed) return `<div class="foe broken" data-tip="bslot" data-lane="${lane}" tabindex="0"><div class="foe-name">已打爆</div><div class="tier">打这一列就是打本体</div></div>`;
      return `<div class="foe" data-tip="bslot" data-lane="${lane}" tabindex="0" role="button" aria-label="魅影卡槽 ${lane + 1}，${s.hp}/${s.maxHp} 血">`
        + `${intentHtml(c.bossIntentOf(s), lane)}<div class="foe-name">魅影卡槽</div>${bar(s.hp, s.maxHp)}${badges({ armor: s.armor, cold: s.cold })}</div>`;
    }
    if (c.mirror) {
      const m = c.mirror.mirrors[lane];
      if (m.broken) return `<div class="foe broken" data-tip="mirror" data-lane="${lane}" tabindex="0"><div class="foe-name">碎了</div></div>`;
      const here = c.mirror.pos === lane;
      const v = c.mirrorAtk();
      return `<div class="foe${here ? " haunted" : ""}" data-tip="mirror" data-lane="${lane}" tabindex="0" role="button" aria-label="${here ? "镜中人在这面镜子里" : "镜子"}，${m.hp}/${m.maxHp} 血">`
        + (here ? intentHtml({ type: "attack", value: v, lane, text: `攻击 ${v}` }, lane) : "")
        + `<div class="foe-name">${here ? "镜中人" : "镜子"}</div>${bar(m.hp, m.maxHp)}${badges({ cold: m.cold })}</div>`;
    }
    const e = c.enemyAt(lane);
    if (!e) return "";
    return `<div class="foe" data-tip="enemy" data-uid="${e.uid}" tabindex="0" role="button" aria-label="${esc(e.name)}，${e.hp}/${e.maxHp} 血">`
      + `${intentHtml(c.intentOf(e), lane)}<div class="foe-name">${esc(e.name)}</div><div class="tier">${esc(e.tier)}</div>`
      + `${bar(e.hp, e.maxHp)}${badges({ cold: e.cold, str: e.str + e.tempStr, sleep: e.asleep })}</div>`;
  }

  function incoming(c) {
    const inc = [0, 0, 0, 0, 0];
    for (const e of c.enemies) {
      if (e.dead || e.fled) continue;
      const it = c.intentOf(e);
      if (it && it.type === "attack" && it.lane != null) inc[it.lane] += it.value;
    }
    if (c.boss && !c.boss.dead) for (const s of c.boss.slots) {
      const it = c.bossIntentOf(s);
      if (it && it.type === "attack") inc[s.i] += it.value;
    }
    if (c.mirror && c.mirror.pos != null) inc[c.mirror.pos] += c.mirrorAtk();
    return inc;
  }

  function occHtml(c, o) {
    if (o.kind === "card") return `<span class="occ">${esc(c.cardName(o.card))}${Number.isFinite(o.turnsLeft) ? `，还剩 ${o.turnsLeft} 回合` : ""}</span>`;
    if (o.kind === "pawn") return `<span class="occ pawn">影卒 ${o.atk}/${o.hp}</span>`;
    if (o.kind === "larva") return '<span class="occ larva">颤蚓幼虫</span>';
    if (o.kind === "doom") return '<span class="occ doom">厄运</span>';
    return '<span class="occ sludge">淤泥：本回合不能放牌</span>';
  }

  function slotHtml(c, s, choosing, valid, reasons, inc) {
    const cls = ["slot"];
    if (s.destroyed) cls.push("destroyed");
    else if (s.kind !== "normal") cls.push("kind-" + s.kind);
    if (choosing) cls.push(valid.has(s.i) ? "can" : "cannot");
    const name = s.destroyed ? "已打爆" : ({ shadow: "暗影卡槽", ice: "冰制卡槽", wax: "蜂蜡卡槽" }[s.kind] || "卡槽");
    let inner = `<span class="sname">${name}</span>`;
    if (!s.destroyed) inner += bar(s.hp, s.maxHp, "slot-hp");
    inner += badges({ armor: s.armor, alibi: s.alibi });
    if (s.occ) inner += occHtml(c, s.occ);
    for (const pc of s.played) inner += `<span class="placed ${TYPE_CLASS[c.def(pc).type]}">${esc(c.cardName(pc))}</span>`;
    const why = choosing && !valid.has(s.i) ? reasons[s.i] || "" : "";
    const label = `第 ${s.i + 1} 槽，${name}${s.destroyed ? "" : `，${s.hp}/${s.maxHp} 血`}${s.armor ? `，护甲 ${s.armor}` : ""}`
      + (inc[s.i] ? `，将受到 ${inc[s.i]} 点攻击` : "") + (choosing ? (valid.has(s.i) ? "，可以放这里" : `，不能放：${why}`) : "");
    return `<div class="cell">${inc[s.i] ? `<span class="incoming" aria-hidden="true">来袭 <span class="n">${inc[s.i]}</span></span>` : ""}`
      + `<button type="button" class="${cls.join(" ")}" data-slot="${s.i}" aria-label="${esc(label)}"${why ? ` title="${esc(why)}"` : ""}>${inner}</button>`
      + `<span class="paint" aria-hidden="true">${s.i + 1}</span></div>`;
  }

  function renderBoard() {
    const c = V.c;
    const valid = new Set();
    const reasons = {};
    const choosing = !!c.pending || V.selected != null;
    if (c.pending) c.freeIntactSlots().forEach(s => valid.add(s.i));
    else if (V.selected != null) for (const l of LANES) {
      const r = c.canPlay(V.selected, l);
      if (r.ok) valid.add(l); else reasons[l] = r.reason;
    }
    const inc = incoming(c);
    let html = '<div class="tube" aria-hidden="true"></div>';
    html += c.boss
      ? `<div class="boss-bar"><div class="bname">血色魅影</div>${bar(c.boss.body.hp, c.boss.body.maxHp)}${badges({ cold: c.boss.body.cold })}</div>`
      : "<div></div>";
    html += `<div class="row enemy-row">${LANES.map(l => `<div class="stall" data-stall="${l}"><span class="paint" aria-hidden="true">0${l + 1}</span>${foeHtml(c, l)}</div>`).join("")}</div>`;
    html += '<div class="drive" aria-hidden="true"><span>行车道</span></div>';
    html += `<div class="row slot-row">${c.slots.map(s => slotHtml(c, s, choosing, valid, reasons, inc)).join("")}</div>`;
    html += c.player.shield ? `<div class="shield">公共护盾 <span class="num">${c.player.shield}</span></div>` : "<div></div>";
    html += '<div class="legend"><span>甲：护甲</span><span>寒：寒冷</span><span>力：力量</span><span>点敌人看说明</span></div>';
    $("#board").innerHTML = html;
  }

  function relicChips(c) {
    const out = [];
    if (c.relics.ring) out.push(`逐梦者之戒 <b>${c.ring}</b>`);
    if (c.relics.watch) out.push(`时侠腕表 <b>${c.watchCount}/3</b>${c.freeNext ? "，下一张免费" : ""}`);
    if (c.relics.netsuke) out.push(`老旧的根付${c.netsukeUsed ? "已失效" : "生效中"}`);
    if (c.relics.beeswax) out.push(`蜂蜡在第 ${c.waxSlot + 1} 槽`);
    if (c.relics.yukiOnna) out.push("《雪女》");
    if (c.slots.some(s => s.occ && s.occ.kind === "card" && s.occ.card.id === "poetry")) {
      const got = D.FACTIONS.filter(f => c.factions.has(f));
      out.push(`流觞诗会 <b>${got.length}/4</b>${got.length ? `：${got.join("、")}` : ""}`);
    }
    if (c.god.lockHp) out.push("锁血");
    if (c.god.infiniteEnergy) out.push("无限费用");
    return out.map(x => `<span class="rchip">${x}</span>`).join("");
  }

  function renderHud() {
    const c = V.c;
    const p = c.player;
    const canEnd = c.phase === "player" && !c.pending;
    const cont = c.result && $("#overlay").hidden && V.ctrl.continueLabel ? V.ctrl.continueLabel(c) : null;
    $("#hud").innerHTML = `<div class="stat hp"><span class="n">${p.hp}</span><span class="of">/${p.maxHp}</span><span class="lbl">生命</span></div>`
      + `<div class="stat en"><span class="n">${c.god.infiniteEnergy ? "∞" : p.energy}</span><span class="of">/${p.maxEnergy}</span><span class="lbl">费用</span></div>`
      + `<div class="piles"><button type="button" class="btn" data-act="piles">抽牌堆<b>${c.drawPile.length}</b></button>`
      + `<button type="button" class="btn" data-act="piles">弃牌堆<b>${c.discardPile.length}</b></button>`
      + `<button type="button" class="btn" data-act="piles">消耗<b>${c.exhaustPile.length}</b></button></div>`
      + `<div class="relic-chips">${relicChips(c)}</div>`
      + '<button type="button" class="btn drawer-btn" data-act="drawer">日志和调试</button>'
      + (cont
        ? `<button type="button" class="btn-main end-turn" data-act="continue">${esc(cont)}</button>`
        : `<button type="button" class="btn-main end-turn" data-act="end"${canEnd ? "" : " disabled"}>结束回合</button>`);
  }

  function cardHtml(c, card, inHand) {
    const d = c.def(card);
    const cost = c.cost(card);
    const poor = cost != null && !c.god.infiniteEnergy && cost > c.player.energy;
    const locked = inHand && c.isLocked(card);
    const playable = c.canPlay(card.uid, null).ok;
    const cls = ["card", TYPE_CLASS[d.type]];
    if (V.selected === card.uid) cls.push("selected");
    if (!playable) cls.push("dim");
    const tags = `<i>${esc(d.type)}</i>${d.faction ? `<i>${esc(d.faction)}</i>` : ""}`;
    const label = `${c.cardName(card)}，${cost == null ? "无法打出" : `${cost} 费`}，${c.cardText(card)}${locked ? "，被红视-2000 封住" : ""}`;
    return `<button type="button" class="${cls.join(" ")}" data-card="${card.uid}" aria-pressed="${V.selected === card.uid}" aria-label="${esc(label)}">`
      + (cost != null ? `<span class="cost${poor ? " poor" : ""}">${cost}</span>` : "")
      + `<span class="cname">${esc(c.cardName(card))}</span><span class="ctags">${tags}</span><span class="ctext">${esc(c.cardText(card))}</span>`
      + (locked ? '<span class="stamp">被红视-2000 封住</span>' : "")
      + "</button>";
  }

  function renderHand() {
    const c = V.c;
    let html = "";
    if (c.pending) html += '<div class="banner">抽到了颤蚓幼虫：点一个亮起来的空卡槽，把它放进去。</div>';
    else if (V.selected != null) {
      const loc = c.locate(V.selected);
      if (loc) html += `<div class="banner">把「${esc(c.cardName(loc.card))}」放进一个亮起来的卡槽；再点一次这张牌就取消。</div>`;
    }
    const rev = c.drawPile.filter(x => c.revealed.includes(x.uid));
    if (rev.length) html += `<div class="revealed"><span class="label">灵视展示的牌，本回合可以直接打出</span><div class="hand small">${rev.map(x => cardHtml(c, x, false)).join("")}</div></div>`;
    html += `<div class="hand">${c.hand.map(x => cardHtml(c, x, true)).join("") || '<span class="note">没有手牌</span>'}</div>`;
    $("#hand-area").innerHTML = html;
  }

  function renderLog() {
    const ol = $("#log");
    const logs = V.c.logs;
    for (let i = V.logShown; i < logs.length; i++) {
      const li = document.createElement("li");
      li.className = logs[i].kind;
      li.textContent = logs[i].text;
      ol.appendChild(li);
    }
    V.logShown = logs.length;
    const panel = $("#panel-log");
    panel.scrollTop = panel.scrollHeight;
  }

  function renderPiles() {
    const c = V.c;
    const list = (cards, empty) => cards.length ? `<ol>${cards.map(x => `<li>${esc(c.cardName(x))}</li>`).join("")}</ol>` : `<p class="note">${empty}</p>`;
    $("#panel-piles").innerHTML = `<div class="pile"><h3>抽牌堆 ${c.drawPile.length} 张（从上往下，调试用）</h3>${list(c.drawPile.slice().reverse(), "空的")}</div>`
      + `<div class="pile"><h3>弃牌堆 ${c.discardPile.length} 张</h3>${list(c.discardPile, "空的")}</div>`
      + `<div class="pile"><h3>消耗 ${c.exhaustPile.length} 张</h3>${list(c.exhaustPile, "空的")}</div>`
      + (c.removedForever.length ? `<div class="pile"><h3>永久删掉</h3>${list(c.removedForever, "")}</div>` : "");
  }

  function renderDebug() {
    const c = V.c;
    const panel = $("#panel-debug");
    if (panel.dataset.ready === "1") {
      panel.querySelector('[data-dbg="lockHp"]').checked = c.god.lockHp;
      panel.querySelector('[data-dbg="infiniteEnergy"]').checked = c.god.infiniteEnergy;
      return;
    }
    const options = Object.keys(D.CARDS).map(id => `<option value="${id}">${esc(D.CARDS[id].name)}</option>`).join("");
    const extra = (V.ctrl.debug || []).map(b => `<button type="button" class="btn" data-ctrl-act="${esc(b.act)}">${esc(b.label)}</button>`).join("");
    panel.innerHTML = '<div class="debug">'
      + `<label class="toggle"><input type="checkbox" data-dbg="lockHp"${c.god.lockHp ? " checked" : ""}>锁血：不会掉血</label>`
      + `<label class="toggle"><input type="checkbox" data-dbg="infiniteEnergy"${c.god.infiniteEnergy ? " checked" : ""}>无限费用</label>`
      + `<div class="row-f"><label class="field" for="dbg-card">加一张牌到手牌<select id="dbg-card">${options}</select></label>`
      + '<label class="toggle"><input type="checkbox" id="dbg-up">升级版</label>'
      + '<button type="button" class="btn" data-dbg-act="add">加到手牌</button></div>'
      + '<div class="row-f"><button type="button" class="btn" data-dbg-act="draw">抽 1 张</button>'
      + '<button type="button" class="btn" data-dbg-act="energy">费用 +3</button>'
      + '<button type="button" class="btn" data-dbg-act="heal">回满血</button>'
      + '<button type="button" class="btn" data-dbg-act="repair">修好所有卡槽</button></div>'
      + (extra ? `<div class="row-f">${extra}</div>` : "")
      + '<p class="note">这里的改动只影响这一场。</p></div>';
    panel.dataset.ready = "1";
  }

  function render() {
    const c = V.c;
    if (!c) return;
    if (V.selected != null && !c.locate(V.selected)) V.selected = null;
    U.setTop(V.ctrl.info(c), V.ctrl.actions(c), act => V.ctrl.onAct(act));
    renderBoard();
    renderHud();
    renderHand();
    renderLog();
    if (V.tab === "piles") renderPiles();
    if (V.tab === "debug") renderDebug();
  }

  /* ---------- 数字飘字 ---------- */
  function snapshot() {
    const c = V.c;
    const m = { p: c.player.hp };
    c.slots.forEach(s => { m["s" + s.i] = s.destroyed ? 0 : s.hp; });
    c.enemies.forEach(e => { m["e" + e.uid] = e.dead ? 0 : e.hp; });
    if (c.boss) { m.b = c.boss.body.hp; c.boss.slots.forEach(s => { m["bs" + s.i] = s.hp; }); }
    if (c.mirror) c.mirror.mirrors.forEach(x => { m["m" + x.i] = x.hp; });
    return m;
  }

  function anchorFor(key) {
    const c = V.c;
    if (key === "p") return $(".stat.hp");
    if (key === "b") return $(".boss-bar");
    if (key.startsWith("bs")) return $(`[data-stall="${key.slice(2)}"]`);
    if (key[0] === "s") return $(`[data-slot="${key.slice(1)}"]`);
    if (key[0] === "m") return $(`[data-stall="${key.slice(1)}"]`);
    if (key[0] === "e") {
      const uid = Number(key.slice(1));
      const el = $(`[data-uid="${uid}"]`);
      if (el) return el;
      const e = c.enemies.find(x => x.uid === uid);
      return e ? $(`[data-stall="${e.lane}"]`) : null;
    }
    return null;
  }

  function floats(before, after) {
    let k = 0;
    for (const key of Object.keys(after)) {
      const delta = after[key] - (before[key] == null ? after[key] : before[key]);
      if (!delta) continue;
      const el = anchorFor(key);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const f = document.createElement("div");
      f.className = "float " + (delta < 0 ? "down" : "up");
      f.textContent = (delta > 0 ? "+" : "") + delta;
      f.style.left = (r.left + r.width / 2) + "px";
      f.style.top = (r.top + 6) + "px";
      f.style.animationDelay = (reduceMotion() ? 0 : k * 0.06) + "s";
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 1500);
      if (delta < 0 && key[0] === "s" && !reduceMotion()) el.classList.add("shake");
      k++;
    }
  }

  function act(fn) {
    const before = snapshot();
    const r = fn();
    render();
    floats(before, snapshot());
    if (V.c && V.c.result) showResult();
    return r;
  }

  function tryPlay(uid, lane) {
    const c = V.c;
    const check = c.canPlay(uid, lane);
    if (!check.ok) { U.flash(check.reason); return; }
    V.selected = null;
    act(() => c.play(uid, lane));
  }

  function select(uid) {
    const c = V.c;
    if (c.result) return;
    if (c.pending) { U.flash("先把颤蚓幼虫放进卡槽"); return; }
    if (V.selected === uid) { V.selected = null; render(); return; }
    const check = c.canPlay(uid, null);
    if (!check.ok) { U.flash(check.reason); return; }
    if (!c.validLanes(uid).length) { U.flash("没有能放这张牌的卡槽"); return; }
    V.selected = uid;
    render();
  }

  function showResult() {
    const c = V.c;
    if (!c || !c.result) return;
    const r = V.ctrl.result(c);
    U.hideFlash();
    $("#overlay").innerHTML = `<div class="result ${r.cls}" role="dialog" aria-modal="true" aria-labelledby="res-title">`
      + `<h2 id="res-title">${esc(r.title)}</h2>`
      + (r.rows && r.rows.length ? `<dl>${r.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "")
      + `<div class="actions">${r.buttons.map(b => `<button type="button" class="${b.main ? "btn-main" : "btn"}" data-act="${esc(b.act)}">${esc(b.label)}</button>`).join("")}</div></div>`;
    $("#overlay").hidden = false;
    const first = $("#overlay .btn-main");
    if (first) first.focus();
  }

  function statRows(c) {
    const rows = [["回合数", c.turn], ["剩余生命", `${c.player.hp}/${c.player.maxHp}`], ["掉血", c.stats.hpLost],
      ["被打爆的卡槽", c.stats.slotsLost], ["打出的牌", c.stats.cardsPlayed], ["造成伤害", c.stats.damageDealt]];
    if (c.removedForever.length) rows.push(["永久删掉的诅咒", c.removedForever.length]);
    return rows;
  }

  /* ---------- 说明浮窗 ---------- */
  function showFoeTip(el) {
    const c = V.c;
    let html = "";
    if (el.dataset.tip === "enemy") {
      const e = c.enemies.find(x => x.uid === Number(el.dataset.uid));
      if (!e) return;
      const d = D.ENEMIES[e.id];
      const it = c.intentOf(e);
      html = `<h3>${esc(e.name)}（${esc(e.tier)}）</h3><p>攻击 ${e.atk}${e.str ? `，力量 ${e.str}` : ""}${e.tempStr ? `，临时力量 ${e.tempStr}` : ""}，生命 ${e.hp}/${e.maxHp}</p>`
        + `<p>${esc(d.rule)}</p>` + (it && it.detail ? `<p>${esc(it.detail)}</p>` : "") + (d.flavor ? `<p class="flavor">${esc(d.flavor)}</p>` : "");
    } else if (el.dataset.tip === "bslot") {
      const s = c.boss.slots[Number(el.dataset.lane)];
      html = `<h3>魅影卡槽 ${s.i + 1}</h3><p>${s.destroyed ? "已打爆。打这一列的伤害直接落在本体上。" : `${s.hp}/${s.maxHp} 血，护甲 ${s.armor}，寒冷 ${s.cold}。`}</p>`
        + `<p>${esc(D.ENEMIES.phantom.rule)}</p><p>魅影抽牌堆 ${c.boss.draw.length} 张，弃牌堆 ${c.boss.discard.length} 张。</p>`;
    } else {
      const m = c.mirror.mirrors[Number(el.dataset.lane)];
      html = `<h3>第 ${m.i + 1} 面镜子</h3><p>${m.broken ? "已经碎了。" : `${m.hp}/${m.maxHp} 血，寒冷 ${m.cold}。`}</p><p>${esc(D.ENEMIES.mirror.rule)}</p>`;
    }
    U.showTip(html, el);
  }

  /* ---------- 拖拽出牌 ---------- */
  function slotUnder(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest("[data-slot]") : null;
  }

  function onPointerDown(ev) {
    const cardEl = ev.target.closest("[data-card]");
    if (!cardEl || ev.button > 0 || !V.c || V.c.pending || V.c.result) return;
    V.drag = { uid: Number(cardEl.dataset.card), x: ev.clientX, y: ev.clientY, pid: ev.pointerId, active: false, ghost: null, hover: null };
  }

  function onPointerMove(ev) {
    const d = V.drag;
    if (!d || ev.pointerId !== d.pid) return;
    const dx = ev.clientX - d.x;
    const dy = ev.clientY - d.y;
    if (!d.active) {
      if (Math.hypot(dx, dy) < 10) return;
      if (ev.pointerType !== "mouse" && Math.abs(dx) > Math.abs(dy)) { V.drag = null; return; }
      const c = V.c;
      if (!c || !c.canPlay(d.uid, null).ok || !c.validLanes(d.uid).length) { V.drag = null; return; }
      d.active = true;
      V.selected = d.uid;
      render();
      const loc = c.locate(d.uid);
      const holder = document.createElement("div");
      holder.innerHTML = cardHtml(c, loc.card, loc.where === "hand");
      d.ghost = holder.firstElementChild;
      d.ghost.classList.add("ghost");
      d.ghost.removeAttribute("data-card");
      d.ghost.setAttribute("aria-hidden", "true");
      document.body.appendChild(d.ghost);
    }
    ev.preventDefault();
    d.ghost.style.left = (ev.clientX - 68) + "px";
    d.ghost.style.top = (ev.clientY - 90) + "px";
    const slot = slotUnder(ev.clientX, ev.clientY);
    if (d.hover && d.hover !== slot) d.hover.classList.remove("drop-hover");
    if (slot && slot.classList.contains("can")) slot.classList.add("drop-hover");
    d.hover = slot;
  }

  function endDrag(ev, cancelled) {
    const d = V.drag;
    if (!d || ev.pointerId !== d.pid) return;
    V.drag = null;
    if (!d.active) return;
    V.suppressClick = Date.now();
    if (d.ghost) d.ghost.remove();
    if (!V.c) return;
    const slot = cancelled ? null : slotUnder(ev.clientX, ev.clientY);
    if (slot) tryPlay(d.uid, Number(slot.dataset.slot));
    else { V.selected = null; render(); }
  }

  /* ---------- 事件 ---------- */
  function onClick(ev) {
    if (Date.now() - V.suppressClick < 60) return;
    const c = V.c;
    if (!c) return;
    const cardEl = ev.target.closest("[data-card]");
    if (cardEl) { U.hideTip(); select(Number(cardEl.dataset.card)); return; }
    const slotEl = ev.target.closest("[data-slot]");
    if (slotEl) {
      U.hideTip();
      const lane = Number(slotEl.dataset.slot);
      if (c.pending) {
        const r = act(() => c.placeLarva(lane));
        if (!r.ok) U.flash(r.reason);
      } else if (V.selected != null) tryPlay(V.selected, lane);
      return;
    }
    const foe = ev.target.closest("[data-tip]");
    if (foe) { showFoeTip(foe); return; }
    const b = ev.target.closest("[data-act], [data-tab], [data-dbg-act], [data-ctrl-act]");
    if (!b) { if (V.selected != null && !ev.target.closest(".hand-area")) { V.selected = null; render(); } return; }
    if (b.dataset.tab) { setTab(b.dataset.tab); return; }
    if (b.dataset.dbgAct) { debugAction(b.dataset.dbgAct); return; }
    if (b.dataset.ctrlAct) { V.ctrl.onAct(b.dataset.ctrlAct); return; }
    switch (b.dataset.act) {
      case "end": V.selected = null; act(() => c.endTurn()); break;
      case "continue": V.ctrl.onAct("continue"); break;
      case "piles": setTab("piles"); openDrawer(true); break;
      case "drawer": openDrawer(); break;
      default: break;
    }
  }

  function onChange(ev) {
    const t = ev.target;
    if (!t.dataset || !t.dataset.dbg || !V.c) return;
    V.c.god[t.dataset.dbg] = t.checked;
    U.S.set.god[t.dataset.dbg] = t.checked;
    U.saveSettings();
    V.c.log(`调试：${t.dataset.dbg === "lockHp" ? "锁血" : "无限费用"}${t.checked ? "打开" : "关闭"}`, "god");
    render();
  }

  function debugAction(kind) {
    const c = V.c;
    if (kind === "add") {
      const id = $("#dbg-card").value;
      const up = $("#dbg-up").checked;
      act(() => c.debugAddCard(id, up && !!D.CARDS[id].cost));
    } else if (kind === "draw") act(() => c.drawCards(1));
    else if (kind === "energy") act(() => c.debugEnergy(c.player.energy + 3));
    else if (kind === "heal") act(() => c.debugHeal());
    else if (kind === "repair") act(() => c.debugRepairAll());
  }

  function setTab(tab) {
    V.tab = tab;
    for (const name of ["log", "piles", "debug"]) {
      $("#tab-" + name).setAttribute("aria-selected", String(name === tab));
      $("#panel-" + name).hidden = name !== tab;
    }
    if (!V.c) return;
    if (tab === "piles") renderPiles();
    if (tab === "debug") renderDebug();
    if (tab === "log") { const p = $("#panel-log"); p.scrollTop = p.scrollHeight; }
  }

  function openDrawer(force) {
    const side = $("#side");
    side.classList.toggle("open", force === true ? true : !side.classList.contains("open"));
  }

  function init() {
    const combat = $("#combat");
    combat.addEventListener("click", onClick);
    combat.addEventListener("change", onChange);
    combat.addEventListener("keydown", ev => {
      const foe = ev.target.closest && ev.target.closest("[data-tip]");
      if (foe && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); showFoeTip(foe); }
    });
    $("#hand-area").addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", ev => endDrag(ev, false));
    window.addEventListener("pointercancel", ev => endDrag(ev, true));
    $("#overlay").addEventListener("click", ev => {
      const b = ev.target.closest("[data-act]");
      if (!b || !V.c) return;
      if (b.dataset.act === "close-result") { $("#overlay").hidden = true; render(); return; }
      V.ctrl.onAct(b.dataset.act);
    });
    document.addEventListener("keydown", ev => {
      if (ev.key !== "Escape" || !V.c) return;
      if (V.selected != null) { V.selected = null; render(); }
      $("#side").classList.remove("open");
    });
    window.addEventListener("scroll", U.hideTip, { passive: true });
  }

  init();
  QW.ui.combat = { start, stop, render, statRows, showResult, current: () => V.c };
})();
