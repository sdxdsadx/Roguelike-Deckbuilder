/* 沙盒界面：设置页 + 战斗页。规则全在 engine.js 里，这里只负责显示和操作。 */
(function () {
  "use strict";
  const QW = window.QW;
  const D = QW.data;
  const STORE = "qinwu-sandbox-v1";
  const LANES = [0, 1, 2, 3, 4];
  const TYPE_CLASS = { "攻击": "t-attack", "防御": "t-defense", "技能": "t-skill", "能力": "t-power", "状态": "t-status", "诅咒": "t-status" };
  const PARAM_LABEL = { dmg: "伤害", block: "护甲", cold: "寒冷", draw: "抽牌", reveal: "展示", lose: "失去生命", pawns: "影卒", energy: "费用" };
  const CONFIG_LABEL = [
    ["playerHp", "血量上限"], ["startHp", "开局血量"], ["slotHp", "卡槽血量"], ["energy", "每回合费用"],
    ["draw", "每回合抽牌"], ["handLimit", "手牌上限"], ["enemyStrength", "敌人开局力量"]
  ];
  const CONFIG_RANGE = { playerHp: [1, 999], startHp: [1, 999], slotHp: [1, 99], energy: [0, 30], draw: [0, 15], handLimit: [1, 20], enemyStrength: [0, 20] };

  const $ = sel => document.querySelector(sel);
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const S = { set: null, c: null, selected: null, tab: "log", logShown: 0, drag: null, suppressClick: 0, flashTimer: null };

  /* ================= 设置 ================= */
  function randomSeed() { return String(10000 + Math.floor(Math.random() * 90000)); }

  function defaults() {
    return {
      encName: D.PRESETS[0].name, enc: clone(D.PRESETS[0].enc),
      deck: clone(D.STARTER_DECK), relics: {}, waxSlot: 2,
      config: clone(D.CONFIG), god: { lockHp: false, infiniteEnergy: false },
      overrides: { enemies: {}, cards: {} }, seed: randomSeed()
    };
  }

  function validEnc(enc) {
    if (!enc || typeof enc !== "object") return false;
    if (enc.kind === "mirror" || enc.kind === "phantom") return true;
    return enc.kind === "lanes" && Array.isArray(enc.lanes) && enc.lanes.length === 5
      && enc.lanes.every(id => id === null || (D.ENEMIES[id] && (D.WEAK.includes(id) || D.STRONG.includes(id))));
  }

  function loadSettings() {
    const d = defaults();
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || "null");
      const s = raw && raw.v === 1 ? raw.set : null;
      if (!s) return d;
      if (Array.isArray(s.deck)) d.deck = s.deck.filter(x => x && D.CARDS[x.id]).map(x => ({ id: x.id, up: !!x.up })).slice(0, 80);
      if (validEnc(s.enc)) { d.enc = s.enc; d.encName = String(s.encName || "自定义").slice(0, 30); }
      if (s.relics) for (const k of Object.keys(D.RELICS)) if (s.relics[k] && D.RELICS[k].combat) d.relics[k] = true;
      if (Number.isInteger(s.waxSlot) && s.waxSlot >= 0 && s.waxSlot < 5) d.waxSlot = s.waxSlot;
      if (s.config) for (const [k, r] of Object.entries(CONFIG_RANGE)) {
        const v = Number(s.config[k]);
        if (Number.isFinite(v)) d.config[k] = clamp(Math.round(v), r[0], r[1]);
      }
      if (s.god) { d.god.lockHp = !!s.god.lockHp; d.god.infiniteEnergy = !!s.god.infiniteEnergy; }
      if (s.overrides) d.overrides = sanitizeOverrides(s.overrides);
      if (s.seed) d.seed = String(s.seed).slice(0, 24);
    } catch (e) { /* 没有存档就用默认 */ }
    return d;
  }

  function sanitizeOverrides(o) {
    const out = { enemies: {}, cards: {} };
    for (const id of Object.keys(D.ENEMIES)) {
      const src = o.enemies && o.enemies[id];
      if (!src) continue;
      for (const k of ["atk", "hp", "mirrorHp", "slotHp"]) {
        const v = Number(src[k]);
        if (src[k] != null && Number.isFinite(v)) (out.enemies[id] = out.enemies[id] || {})[k] = clamp(Math.round(v), 0, 999);
      }
    }
    for (const id of Object.keys(D.CARDS)) {
      const src = o.cards && o.cards[id];
      if (!src) continue;
      const keys = Object.keys(D.CARDS[id].params || {}).concat(D.CARDS[id].cost ? ["cost"] : []);
      for (const k of keys) {
        const pair = src[k];
        if (Array.isArray(pair) && pair.length === 2 && pair.every(v => Number.isFinite(Number(v)))) {
          (out.cards[id] = out.cards[id] || {})[k] = pair.map(v => clamp(Math.round(Number(v)), 0, 99));
        }
      }
    }
    return out;
  }

  function saveSettings() {
    try { localStorage.setItem(STORE, JSON.stringify({ v: 1, set: S.set })); } catch (e) { /* 存不了就不存 */ }
  }

  function encEmpty(enc) { return enc.kind === "lanes" && enc.lanes.every(x => !x); }

  function baseText(id) {
    const d = D.CARDS[id];
    const p = {};
    for (const k of Object.keys(d.params || {})) p[k] = d.params[k][0];
    return d.text(p, false);
  }

  function summaryText() {
    const s = S.set;
    return `${s.encName}，卡组 ${s.deck.length} 张，种子 ${s.seed}`;
  }

  function enemyOptions(selected) {
    const opt = id => `<option value="${id}"${id === selected ? " selected" : ""}>${esc(D.ENEMIES[id].name)}</option>`;
    return `<option value=""${selected ? "" : " selected"}>空</option>`
      + `<optgroup label="弱怪">${D.WEAK.map(opt).join("")}</optgroup>`
      + `<optgroup label="强怪">${D.STRONG.map(opt).join("")}</optgroup>`;
  }

  function encounterBox() {
    const s = S.set;
    const chips = D.PRESETS.map((p, i) =>
      `<button type="button" class="chip" data-act="preset" data-i="${i}" aria-pressed="${s.encName === p.name}">${esc(p.name)}</button>`).join("")
      + `<button type="button" class="chip" data-act="random-enc" aria-pressed="${s.encName === "随机普通战斗"}">随机普通战斗</button>`;
    let body;
    if (s.enc.kind === "lanes") {
      body = `<div class="stalls">${LANES.map(l =>
        `<label for="lane-${l}">第 ${l + 1} 列<select id="lane-${l}" data-act="lane" data-lane="${l}">${enemyOptions(s.enc.lanes[l])}</select></label>`).join("")}</div>`
        + `<p class="note">回声开场会掷 D20 重新选站位；随机普通战斗是 2–3 个弱怪，或 1 个强怪带 1 个弱怪。</p>`;
    } else {
      body = `<p class="note">${s.enc.kind === "mirror" ? "镜中人占满 5 列，每列一面 7 血的镜子。" : "血色魅影占满 5 列，每列一个 16 血的魅影卡槽。"}</p>`;
    }
    return `<section class="box" aria-labelledby="h-enc"><div class="box-head"><h2 id="h-enc">敌人</h2><span class="hint">选一个预设，或者逐列挑敌人</span></div><div class="chips">${chips}</div>${body}</section>`;
  }

  function deckBox() {
    const s = S.set;
    const groups = [];
    for (const x of s.deck) {
      const key = x.id + (x.up ? "+" : "");
      let g = groups.find(y => y.key === key);
      if (!g) groups.push(g = { key, id: x.id, up: x.up, n: 0 });
      g.n++;
    }
    const list = groups.map(g => {
      const d = D.CARDS[g.id];
      const attrs = `data-id="${g.id}" data-up="${g.up ? 1 : 0}"`;
      return `<span class="deck-item ${TYPE_CLASS[d.type]}">${esc(d.name)}${g.up ? "+" : ""}<span class="cnt">×${g.n}</span>`
        + `<button type="button" class="mini" data-act="deck-minus" ${attrs} aria-label="去掉一张${esc(d.name)}">−</button>`
        + `<button type="button" class="mini" data-act="deck-plus" ${attrs} aria-label="再加一张${esc(d.name)}">+</button>`
        + (d.cost ? `<button type="button" class="mini" data-act="deck-up" ${attrs}>${g.up ? "降级一张" : "升级一张"}</button>` : "")
        + `</span>`;
    }).join("");
    const rarities = [["初始", ["初始"]], ["扩充", ["扩充"]], ["梦想", ["梦想"]], ["事件", ["事件"]], ["状态和诅咒", ["状态", "诅咒"]]];
    const catalog = rarities.map(([label, rs]) => {
      const ids = Object.keys(D.CARDS).filter(id => rs.includes(D.CARDS[id].rarity));
      return `<div class="cat-group"><h3>${label}</h3><div class="cat-row">${ids.map(id =>
        `<button type="button" class="add-card ${TYPE_CLASS[D.CARDS[id].type]}" data-act="add" data-id="${id}" title="${esc(baseText(id))}">${esc(D.CARDS[id].name)}</button>`).join("")}</div></div>`;
    }).join("");
    return `<section class="box" aria-labelledby="h-deck"><div class="box-head"><h2 id="h-deck">卡组</h2><span class="hint">${s.deck.length} 张</span>`
      + `<button type="button" class="btn" data-act="deck-reset">恢复初始卡组</button></div>`
      + `<div class="deck-list">${list || '<span class="note">卡组是空的，从下面加牌。</span>'}</div>`
      + `<details open><summary>加牌（点一下加一张基础版）</summary><div class="catalog">${catalog}</div></details>`
      + `<p class="note">加入寒霜之触时，卡组里的冰霜之触会直接变成寒霜之触。</p></section>`;
  }

  function relicBox() {
    const s = S.set;
    const items = Object.entries(D.RELICS).map(([id, r]) => {
      if (!r.combat) {
        return `<div class="relic off"><span></span><span class="rname">${esc(r.name)}</span><span class="rtext">${esc(r.text)}只在完整一局里生效。</span></div>`;
      }
      let html = `<label class="relic"><input type="checkbox" data-act="relic" data-id="${id}"${s.relics[id] ? " checked" : ""}><span class="rname">${esc(r.name)}</span><span class="rtext">${esc(r.text)}</span></label>`;
      if (id === "beeswax" && s.relics.beeswax) {
        html += `<label class="field" for="wax-slot">蜂蜡卡槽在第几槽<select id="wax-slot" data-act="wax">${LANES.map(l =>
          `<option value="${l}"${l === s.waxSlot ? " selected" : ""}>第 ${l + 1} 槽</option>`).join("")}</select></label>`;
      }
      return html;
    }).join("");
    return `<section class="box" aria-labelledby="h-relic"><h2 id="h-relic">奇物</h2><div class="relics">${items}</div></section>`;
  }

  function tuneBox() {
    const s = S.set;
    const cfg = CONFIG_LABEL.map(([k, label]) =>
      `<label class="field" for="cfg-${k}">${label}<input id="cfg-${k}" type="number" inputmode="numeric" data-act="cfg" data-k="${k}" min="${CONFIG_RANGE[k][0]}" max="${CONFIG_RANGE[k][1]}" value="${s.config[k]}"></label>`).join("");
    const enemyRows = Object.keys(D.ENEMIES).filter(id => id !== "sheep").map(id => {
      const base = D.ENEMIES[id];
      const ov = s.overrides.enemies[id] || {};
      const cell = (k, label) => base[k] == null ? "<td></td>"
        : `<td>${label}<br><input type="number" inputmode="numeric" aria-label="${esc(base.name)}${label}" data-act="en" data-id="${id}" data-k="${k}" value="${ov[k] != null ? ov[k] : base[k]}"></td>`;
      return `<tr><th scope="row">${esc(base.name)}</th>${cell("atk", "攻击")}${cell("hp", id === "phantom" ? "本体血量" : "血量")}${cell(id === "mirror" ? "mirrorHp" : "slotHp", id === "mirror" ? "镜子血量" : "卡槽血量")}</tr>`;
    }).join("");
    const cardRows = Object.keys(D.CARDS).filter(id => D.CARDS[id].cost).map(id => {
      const d = D.CARDS[id];
      const ov = s.overrides.cards[id] || {};
      const pair = (k, label, src) => {
        const v = ov[k] || src;
        return `<td>${label}<br>${[0, 1].map(i =>
          `<input type="number" inputmode="numeric" aria-label="${esc(d.name)}${label}${i ? "（升级）" : ""}" data-act="cardp" data-id="${id}" data-k="${k}" data-i="${i}" value="${v[i]}">`).join(" ")}</td>`;
      };
      const params = Object.keys(d.params || {}).map(k => pair(k, PARAM_LABEL[k] || k, d.params[k])).join("");
      return `<tr><th scope="row">${esc(d.name)}</th>${pair("cost", "费用", d.cost)}${params}</tr>`;
    }).join("");
    return `<section class="box" aria-labelledby="h-tune"><div class="box-head"><h2 id="h-tune">数值</h2><span class="hint">改完下一场生效</span>`
      + `<button type="button" class="btn" data-act="tune-reset">恢复默认数值</button></div>`
      + `<div class="fields">${cfg}</div>`
      + `<details><summary>敌人数值</summary><div class="table-wrap"><table class="tune"><tbody>${enemyRows}</tbody></table></div></details>`
      + `<details><summary>卡牌数值（每格两个数：基础 / 升级）</summary><div class="table-wrap"><table class="tune"><tbody>${cardRows}</tbody></table></div></details>`
      + `</section>`;
  }

  function debugBox() {
    const s = S.set;
    return `<section class="box" aria-labelledby="h-debug"><h2 id="h-debug">调试</h2>`
      + `<label class="toggle"><input type="checkbox" data-act="god" data-k="lockHp"${s.god.lockHp ? " checked" : ""}>锁血：不会掉血</label>`
      + `<label class="toggle"><input type="checkbox" data-act="god" data-k="infiniteEnergy"${s.god.infiniteEnergy ? " checked" : ""}>无限费用</label>`
      + `<div class="seed-row"><label class="field" for="seed">随机种子<input id="seed" type="text" data-act="seed" maxlength="24" value="${esc(s.seed)}"></label>`
      + `<button type="button" class="btn" data-act="seed-new">换一个</button></div>`
      + `<p class="note">同一个种子、同样的操作，洗牌和敌人的随机行为完全一样，方便复现问题。</p></section>`;
  }

  function noticeBox() {
    return `<aside class="notice" aria-label="停车场守则"><h2>B2 停车场守则</h2><ol>`
      + "<li>每张牌都要放进一个卡槽才算打出，一个卡槽一回合只放一张。</li>"
      + "<li>单体牌只打它所在卡槽正对面的敌人。</li>"
      + "<li>护甲只护住它所在的卡槽，下个回合开始时清零。</li>"
      + "<li>卡槽被打爆，你掉 6 血；再有东西打这一列，会直接打在你身上。</li>"
      + "<li>没用完的费用不会留到下回合。</li>"
      + "<li>如果你看见一扇电梯门，请记住：凡派尔商务大厦没有电梯。</li>"
      + `</ol><p class="sign">凡派尔商务大厦物业管理处</p></aside>`;
  }

  function renderSetup() {
    $("#top-info").innerHTML = "<span>设好敌人和卡组，然后开打</span>";
    $("#top-actions").innerHTML = "";
    const s = S.set;
    const blocked = !s.deck.length ? "卡组是空的" : encEmpty(s.enc) ? "至少放一个敌人" : "";
    $("#setup").innerHTML = `<div class="setup-main">${encounterBox()}${deckBox()}${relicBox()}${tuneBox()}${debugBox()}</div>${noticeBox()}`
      + `<div class="start-bar"><span class="summary" id="summary">${esc(blocked || summaryText())}</span>`
      + `<button type="button" class="btn-main" data-act="start"${blocked ? " disabled" : ""}>开始战斗</button></div>`;
  }

  function addToDeck(id) {
    const deck = S.set.deck;
    if (id === "frostbite") {
      const i = deck.findIndex(x => x.id === "frostTouch");
      if (i >= 0) { deck[i] = { id: "frostbite", up: false }; return; }
    }
    deck.push({ id, up: false });
  }

  function onSetupClick(ev) {
    const b = ev.target.closest("[data-act]");
    if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
    const s = S.set;
    const act = b.dataset.act;
    const up = b.dataset.up === "1";
    const find = () => s.deck.findIndex(x => x.id === b.dataset.id && x.up === up);
    switch (act) {
      case "preset": { const p = D.PRESETS[Number(b.dataset.i)]; s.enc = clone(p.enc); s.encName = p.name; break; }
      case "random-enc": s.enc = D.randomEncounter(randomSeed()); s.encName = "随机普通战斗"; break;
      case "add": addToDeck(b.dataset.id); break;
      case "deck-minus": { const i = find(); if (i >= 0) s.deck.splice(i, 1); break; }
      case "deck-plus": s.deck.push({ id: b.dataset.id, up }); break;
      case "deck-up": { const i = find(); if (i >= 0) s.deck[i].up = !up; break; }
      case "deck-reset": s.deck = clone(D.STARTER_DECK); break;
      case "tune-reset": s.config = clone(D.CONFIG); s.overrides = { enemies: {}, cards: {} }; break;
      case "seed-new": s.seed = randomSeed(); break;
      case "start": startCombat(); return;
      default: return;
    }
    saveSettings();
    renderSetup();
  }

  function onSetupChange(ev) {
    const t = ev.target;
    const act = t.dataset && t.dataset.act;
    if (!act) return;
    const s = S.set;
    let rerender = false;
    switch (act) {
      case "lane": s.enc.lanes[Number(t.dataset.lane)] = t.value || null; s.encName = "自定义"; rerender = true; break;
      case "relic": s.relics[t.dataset.id] = t.checked; rerender = t.dataset.id === "beeswax"; break;
      case "wax": s.waxSlot = Number(t.value); break;
      case "cfg": {
        const r = CONFIG_RANGE[t.dataset.k];
        const v = Number(t.value);
        if (t.value !== "" && Number.isFinite(v)) s.config[t.dataset.k] = clamp(Math.round(v), r[0], r[1]);
        break;
      }
      case "en": {
        const v = Number(t.value);
        if (t.value !== "" && Number.isFinite(v)) (s.overrides.enemies[t.dataset.id] = s.overrides.enemies[t.dataset.id] || {})[t.dataset.k] = clamp(Math.round(v), 0, 999);
        break;
      }
      case "cardp": {
        const v = Number(t.value);
        if (t.value === "" || !Number.isFinite(v)) break;
        const d = D.CARDS[t.dataset.id];
        const map = s.overrides.cards[t.dataset.id] = s.overrides.cards[t.dataset.id] || {};
        const k = t.dataset.k;
        const pair = map[k] || (k === "cost" ? d.cost : d.params[k]).slice();
        pair[Number(t.dataset.i)] = clamp(Math.round(v), 0, 99);
        map[k] = pair;
        break;
      }
      case "god": s.god[t.dataset.k] = t.checked; break;
      case "seed": s.seed = t.value.trim().slice(0, 24) || randomSeed(); break;
      default: return;
    }
    saveSettings();
    if (rerender) renderSetup();
    else { const el = $("#summary"); if (el) el.textContent = summaryText(); }
  }

  /* ================= 战斗 ================= */
  function startCombat(seed) {
    const s = S.set;
    if (seed != null) s.seed = String(seed);
    if (!s.deck.length || encEmpty(s.enc)) { showSetup(); return; }
    saveSettings();
    clearFloats();
    S.c = new QW.Combat({
      seed: s.seed, encounter: clone(s.enc), deck: clone(s.deck), relics: clone(s.relics), waxSlot: s.waxSlot,
      config: clone(s.config), god: clone(s.god), overrides: clone(s.overrides)
    }).start();
    S.selected = null;
    S.logShown = 0;
    $("#log").innerHTML = "";
    $("#overlay").hidden = true;
    $("#setup").hidden = true;
    $("#combat").hidden = false;
    renderCombat();
    if (S.c.result) showResult();
  }

  function clearFloats() { document.querySelectorAll(".float").forEach(f => f.remove()); }

  function showSetup() {
    clearFloats();
    S.c = null;
    S.selected = null;
    $("#overlay").hidden = true;
    $("#combat").hidden = true;
    $("#setup").hidden = false;
    hideTip();
    renderSetup();
  }

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
    if (s.played) inner += `<span class="placed ${TYPE_CLASS[c.def(s.played).type]}">${esc(c.cardName(s.played))}</span>`;
    const why = choosing && !valid.has(s.i) ? reasons[s.i] || "" : "";
    const label = `第 ${s.i + 1} 槽，${name}${s.destroyed ? "" : `，${s.hp}/${s.maxHp} 血`}${s.armor ? `，护甲 ${s.armor}` : ""}`
      + (inc[s.i] ? `，将受到 ${inc[s.i]} 点攻击` : "") + (choosing ? (valid.has(s.i) ? "，可以放这里" : `，不能放：${why}`) : "");
    return `<div class="cell">${inc[s.i] ? `<span class="incoming" aria-hidden="true">来袭 <span class="n">${inc[s.i]}</span></span>` : ""}`
      + `<button type="button" class="${cls.join(" ")}" data-slot="${s.i}" aria-label="${esc(label)}"${why ? ` title="${esc(why)}"` : ""}>${inner}</button>`
      + `<span class="paint" aria-hidden="true">${s.i + 1}</span></div>`;
  }

  function renderBoard() {
    const c = S.c;
    const valid = new Set();
    const reasons = {};
    const choosing = !!c.pending || S.selected != null;
    if (c.pending) c.freeIntactSlots().forEach(s => valid.add(s.i));
    else if (S.selected != null) for (const l of LANES) {
      const r = c.canPlay(S.selected, l);
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
    const c = S.c;
    const p = c.player;
    const canEnd = c.phase === "player" && !c.pending;
    $("#hud").innerHTML = `<div class="stat hp"><span class="n">${p.hp}</span><span class="of">/${p.maxHp}</span><span class="lbl">生命</span></div>`
      + `<div class="stat en"><span class="n">${c.god.infiniteEnergy ? "∞" : p.energy}</span><span class="of">/${p.maxEnergy}</span><span class="lbl">费用</span></div>`
      + `<div class="piles"><button type="button" class="btn" data-act="piles">抽牌堆<b>${c.drawPile.length}</b></button>`
      + `<button type="button" class="btn" data-act="piles">弃牌堆<b>${c.discardPile.length}</b></button>`
      + `<button type="button" class="btn" data-act="piles">消耗<b>${c.exhaustPile.length}</b></button></div>`
      + `<div class="relic-chips">${relicChips(c)}</div>`
      + '<button type="button" class="btn drawer-btn" data-act="drawer">日志和调试</button>'
      + `<button type="button" class="btn-main end-turn" data-act="end"${canEnd ? "" : " disabled"}>结束回合</button>`;
  }

  function cardHtml(c, card, inHand) {
    const d = c.def(card);
    const cost = c.cost(card);
    const poor = cost != null && !c.god.infiniteEnergy && cost > c.player.energy;
    const locked = inHand && c.isLocked(card);
    const playable = c.canPlay(card.uid, null).ok;
    const cls = ["card", TYPE_CLASS[d.type]];
    if (S.selected === card.uid) cls.push("selected");
    if (!playable) cls.push("dim");
    const tags = `<i>${esc(d.type)}</i>${d.faction ? `<i>${esc(d.faction)}</i>` : ""}`;
    const label = `${c.cardName(card)}，${cost == null ? "无法打出" : `${cost} 费`}，${c.cardText(card)}${locked ? "，被红视-2000 封住" : ""}`;
    return `<button type="button" class="${cls.join(" ")}" data-card="${card.uid}" aria-pressed="${S.selected === card.uid}" aria-label="${esc(label)}">`
      + (cost != null ? `<span class="cost${poor ? " poor" : ""}">${cost}</span>` : "")
      + `<span class="cname">${esc(c.cardName(card))}</span><span class="ctags">${tags}</span><span class="ctext">${esc(c.cardText(card))}</span>`
      + (locked ? '<span class="stamp">被红视-2000 封住</span>' : "")
      + "</button>";
  }

  function renderHand() {
    const c = S.c;
    let html = "";
    if (c.pending) html += '<div class="banner">抽到了颤蚓幼虫：点一个亮起来的空卡槽，把它放进去。</div>';
    else if (S.selected != null) {
      const loc = c.locate(S.selected);
      if (loc) html += `<div class="banner">把「${esc(c.cardName(loc.card))}」放进一个亮起来的卡槽；再点一次这张牌就取消。</div>`;
    }
    const rev = c.drawPile.filter(x => c.revealed.includes(x.uid));
    if (rev.length) html += `<div class="revealed"><span class="label">灵视展示的牌，本回合可以直接打出</span><div class="hand small">${rev.map(x => cardHtml(c, x, false)).join("")}</div></div>`;
    html += `<div class="hand">${c.hand.map(x => cardHtml(c, x, true)).join("") || '<span class="note">没有手牌</span>'}</div>`;
    $("#hand-area").innerHTML = html;
  }

  function renderLog() {
    const ol = $("#log");
    const logs = S.c.logs;
    for (let i = S.logShown; i < logs.length; i++) {
      const li = document.createElement("li");
      li.className = logs[i].kind;
      li.textContent = logs[i].text;
      ol.appendChild(li);
    }
    S.logShown = logs.length;
    const panel = $("#panel-log");
    panel.scrollTop = panel.scrollHeight;
  }

  function renderPiles() {
    const c = S.c;
    const list = (cards, empty) => cards.length ? `<ol>${cards.map(x => `<li>${esc(c.cardName(x))}</li>`).join("")}</ol>` : `<p class="note">${empty}</p>`;
    $("#panel-piles").innerHTML = `<div class="pile"><h3>抽牌堆 ${c.drawPile.length} 张（从上往下，调试用）</h3>${list(c.drawPile.slice().reverse(), "空的")}</div>`
      + `<div class="pile"><h3>弃牌堆 ${c.discardPile.length} 张</h3>${list(c.discardPile, "空的")}</div>`
      + `<div class="pile"><h3>消耗 ${c.exhaustPile.length} 张</h3>${list(c.exhaustPile, "空的")}</div>`
      + (c.removedForever.length ? `<div class="pile"><h3>永久删掉</h3>${list(c.removedForever, "")}</div>` : "");
  }

  function renderDebug() {
    const c = S.c;
    const panel = $("#panel-debug");
    if (panel.dataset.ready === "1") {
      panel.querySelector('[data-dbg="lockHp"]').checked = c.god.lockHp;
      panel.querySelector('[data-dbg="infiniteEnergy"]').checked = c.god.infiniteEnergy;
      return;
    }
    const options = Object.keys(D.CARDS).map(id => `<option value="${id}">${esc(D.CARDS[id].name)}</option>`).join("");
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
      + '<p class="note">这里的改动只影响这一场。想让下一场也这样，回「改设置」里改。</p></div>';
    panel.dataset.ready = "1";
  }

  function renderTop() {
    const c = S.c;
    $("#top-info").innerHTML = `<span>第 <b class="num">${c.turn}</b> 回合</span><span>${esc(S.set.encName)}</span><span>种子 <b class="num">${esc(c.seed)}</b></span>`;
    $("#top-actions").innerHTML = '<button type="button" class="btn" data-act="restart-same">同种子重开</button>'
      + '<button type="button" class="btn" data-act="restart-new">换种子重开</button>'
      + '<button type="button" class="btn" data-act="to-setup">改设置</button>';
  }

  function renderCombat() {
    if (!S.c) return;
    if (S.selected != null && !S.c.locate(S.selected)) S.selected = null;
    renderTop();
    renderBoard();
    renderHud();
    renderHand();
    renderLog();
    if (S.tab === "piles") renderPiles();
    if (S.tab === "debug") renderDebug();
  }

  /* ---------- 数字飘字 ---------- */
  function snapshot() {
    const c = S.c;
    const m = { p: c.player.hp };
    c.slots.forEach(s => { m["s" + s.i] = s.destroyed ? 0 : s.hp; });
    c.enemies.forEach(e => { m["e" + e.uid] = e.dead ? 0 : e.hp; });
    if (c.boss) { m.b = c.boss.body.hp; c.boss.slots.forEach(s => { m["bs" + s.i] = s.hp; }); }
    if (c.mirror) c.mirror.mirrors.forEach(x => { m["m" + x.i] = x.hp; });
    return m;
  }

  function anchorFor(key) {
    const c = S.c;
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
    renderCombat();
    floats(before, snapshot());
    if (S.c.result) showResult();
    return r;
  }

  function flash(text) {
    const el = $("#flash");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(S.flashTimer);
    S.flashTimer = setTimeout(() => { el.hidden = true; }, 2400);
  }

  function tryPlay(uid, lane) {
    const c = S.c;
    const check = c.canPlay(uid, lane);
    if (!check.ok) { flash(check.reason); return; }
    S.selected = null;
    act(() => c.play(uid, lane));
  }

  function select(uid) {
    const c = S.c;
    if (c.pending) { flash("先把颤蚓幼虫放进卡槽"); return; }
    if (S.selected === uid) { S.selected = null; renderCombat(); return; }
    const check = c.canPlay(uid, null);
    if (!check.ok) { flash(check.reason); return; }
    if (!c.validLanes(uid).length) { flash("没有能放这张牌的卡槽"); return; }
    S.selected = uid;
    renderCombat();
  }

  function showResult() {
    const c = S.c;
    const win = c.result === "win";
    $("#flash").hidden = true;
    const rows = [["回合数", c.turn], ["剩余生命", `${c.player.hp}/${c.player.maxHp}`], ["掉血", c.stats.hpLost],
      ["被打爆的卡槽", c.stats.slotsLost], ["打出的牌", c.stats.cardsPlayed], ["造成伤害", c.stats.damageDealt]];
    if (c.removedForever.length) rows.push(["永久删掉的诅咒", c.removedForever.length]);
    $("#overlay").innerHTML = `<div class="result ${win ? "win" : "lose"}" role="dialog" aria-modal="true" aria-labelledby="res-title">`
      + `<h2 id="res-title">${win ? "战斗胜利" : "你倒下了"}</h2>`
      + `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`
      + '<div class="actions"><button type="button" class="btn-main" data-act="restart-same">同种子再打一次</button>'
      + '<button type="button" class="btn" data-act="restart-new">换个种子</button>'
      + '<button type="button" class="btn" data-act="to-setup">改设置</button>'
      + '<button type="button" class="btn" data-act="close-result">回去看战场</button></div></div>';
    $("#overlay").hidden = false;
    const first = $("#overlay .btn-main");
    if (first) first.focus();
  }

  /* ---------- 说明浮窗 ---------- */
  function showTip(el) {
    const c = S.c;
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
    const tip = $("#tip");
    tip.innerHTML = html;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 16);
    tip.style.left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8) + "px";
    tip.style.top = Math.min(r.bottom + 8, window.innerHeight - tip.offsetHeight - 8) + "px";
  }
  function hideTip() { const t = $("#tip"); if (t) t.hidden = true; }

  /* ---------- 拖拽出牌 ---------- */
  function slotUnder(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest("[data-slot]") : null;
  }

  function onPointerDown(ev) {
    const cardEl = ev.target.closest("[data-card]");
    if (!cardEl || ev.button > 0 || !S.c || S.c.pending) return;
    S.drag = { uid: Number(cardEl.dataset.card), x: ev.clientX, y: ev.clientY, pid: ev.pointerId, active: false, ghost: null, hover: null };
  }

  function onPointerMove(ev) {
    const d = S.drag;
    if (!d || ev.pointerId !== d.pid) return;
    const dx = ev.clientX - d.x;
    const dy = ev.clientY - d.y;
    if (!d.active) {
      if (Math.hypot(dx, dy) < 10) return;
      if (ev.pointerType !== "mouse" && Math.abs(dx) > Math.abs(dy)) { S.drag = null; return; }
      const c = S.c;
      if (!c.canPlay(d.uid, null).ok || !c.validLanes(d.uid).length) { S.drag = null; return; }
      d.active = true;
      S.selected = d.uid;
      renderCombat();
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
    const d = S.drag;
    if (!d || ev.pointerId !== d.pid) return;
    S.drag = null;
    if (!d.active) return;
    S.suppressClick = Date.now();
    if (d.ghost) d.ghost.remove();
    const slot = cancelled ? null : slotUnder(ev.clientX, ev.clientY);
    if (slot) tryPlay(d.uid, Number(slot.dataset.slot));
    else { S.selected = null; renderCombat(); }
  }

  /* ---------- 事件 ---------- */
  function onCombatClick(ev) {
    if (Date.now() - S.suppressClick < 60) return;
    const c = S.c;
    if (!c) return;
    const cardEl = ev.target.closest("[data-card]");
    if (cardEl) { hideTip(); select(Number(cardEl.dataset.card)); return; }
    const slotEl = ev.target.closest("[data-slot]");
    if (slotEl) {
      hideTip();
      const lane = Number(slotEl.dataset.slot);
      if (c.pending) {
        const r = act(() => c.placeLarva(lane));
        if (!r.ok) flash(r.reason);
      } else if (S.selected != null) tryPlay(S.selected, lane);
      return;
    }
    const foe = ev.target.closest("[data-tip]");
    if (foe) { showTip(foe); return; }
    const b = ev.target.closest("[data-act], [data-tab], [data-dbg-act]");
    hideTip();
    if (!b) { if (S.selected != null && !ev.target.closest(".hand-area")) { S.selected = null; renderCombat(); } return; }
    if (b.dataset.tab) { setTab(b.dataset.tab); return; }
    if (b.dataset.dbgAct) { debugAction(b.dataset.dbgAct); return; }
    switch (b.dataset.act) {
      case "end": S.selected = null; act(() => c.endTurn()); break;
      case "piles": setTab("piles"); openDrawer(true); break;
      case "drawer": openDrawer(); break;
      default: break;
    }
  }

  function onCombatChange(ev) {
    const t = ev.target;
    if (!t.dataset || !t.dataset.dbg || !S.c) return;
    S.c.god[t.dataset.dbg] = t.checked;
    S.set.god[t.dataset.dbg] = t.checked;
    saveSettings();
    S.c.log(`调试：${t.dataset.dbg === "lockHp" ? "锁血" : "无限费用"}${t.checked ? "打开" : "关闭"}`, "god");
    renderCombat();
  }

  function debugAction(kind) {
    const c = S.c;
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
    S.tab = tab;
    for (const name of ["log", "piles", "debug"]) {
      $("#tab-" + name).setAttribute("aria-selected", String(name === tab));
      $("#panel-" + name).hidden = name !== tab;
    }
    if (tab === "piles") renderPiles();
    if (tab === "debug") renderDebug();
    if (tab === "log") { const p = $("#panel-log"); p.scrollTop = p.scrollHeight; }
  }

  function openDrawer(force) {
    const side = $("#side");
    const open = force === true ? true : !side.classList.contains("open");
    side.classList.toggle("open", open);
  }

  function onTopClick(ev) {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    handleGlobalAct(b.dataset.act);
  }

  function handleGlobalAct(a) {
    if (a === "restart-same") startCombat(S.c ? S.c.seed : S.set.seed);
    else if (a === "restart-new") startCombat(randomSeed());
    else if (a === "to-setup") showSetup();
    else if (a === "close-result") $("#overlay").hidden = true;
  }

  function init() {
    S.set = loadSettings();
    const flashEl = document.createElement("div");
    flashEl.id = "flash";
    flashEl.className = "flash";
    flashEl.setAttribute("role", "status");
    flashEl.hidden = true;
    document.body.appendChild(flashEl);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "drawer-close";
    close.dataset.act = "drawer";
    close.textContent = "关闭";
    $("#side .tabs").appendChild(close);

    $("#setup").addEventListener("click", onSetupClick);
    $("#setup").addEventListener("change", onSetupChange);
    $("#combat").addEventListener("click", onCombatClick);
    $("#combat").addEventListener("change", onCombatChange);
    $("#combat").addEventListener("keydown", ev => {
      const foe = ev.target.closest && ev.target.closest("[data-tip]");
      if (foe && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); showTip(foe); }
    });
    $("#hand-area").addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", ev => endDrag(ev, false));
    window.addEventListener("pointercancel", ev => endDrag(ev, true));
    document.querySelector(".top").addEventListener("click", onTopClick);
    $("#overlay").addEventListener("click", ev => {
      const b = ev.target.closest("[data-act]");
      if (b) handleGlobalAct(b.dataset.act);
    });
    document.addEventListener("keydown", ev => {
      if (ev.key !== "Escape") return;
      hideTip();
      if (S.c && S.selected != null) { S.selected = null; renderCombat(); }
      $("#side").classList.remove("open");
    });
    document.addEventListener("click", ev => {
      if (!ev.target.closest("[data-tip]") && !ev.target.closest("#tip")) hideTip();
    }, true);
    window.addEventListener("scroll", hideTip, { passive: true });
    window.addEventListener("resize", hideTip);
    renderSetup();
  }

  init();
})();
