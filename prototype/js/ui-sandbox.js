/* 战斗沙盒：设置页 + 单场战斗。数值和调试开关跟完整一局共用。 */
(function () {
  "use strict";
  const QW = window.QW;
  const D = QW.data;
  const U = QW.ui;
  const { $, esc, clamp, clone, TYPE_CLASS, CONFIG_RANGE } = U;
  const LANES = [0, 1, 2, 3, 4];
  const PARAM_LABEL = { dmg: "伤害", block: "护甲", cold: "寒冷", draw: "抽牌", reveal: "展示", lose: "失去生命", pawns: "影卒", energy: "费用" };
  const CONFIG_LABEL = [
    ["playerHp", "血量上限"], ["startHp", "开局血量"], ["slotHp", "卡槽血量"], ["energy", "每回合费用"],
    ["draw", "每回合抽牌"], ["handLimit", "手牌上限"], ["enemyStrength", "敌人开局力量"]
  ];

  const set = () => U.S.set;
  const encEmpty = enc => enc.kind === "lanes" && enc.lanes.every(x => !x);
  const summaryText = () => `${set().encName}，卡组 ${set().deck.length} 张，种子 ${set().seed}`;

  function baseText(id) {
    const d = D.CARDS[id];
    const p = {};
    for (const k of Object.keys(d.params || {})) p[k] = d.params[k][0];
    return d.text(p, false);
  }

  function enemyOptions(selected) {
    const opt = id => `<option value="${id}"${id === selected ? " selected" : ""}>${esc(D.ENEMIES[id].name)}</option>`;
    return `<option value=""${selected ? "" : " selected"}>空</option>`
      + `<optgroup label="弱怪">${D.WEAK.map(opt).join("")}</optgroup>`
      + `<optgroup label="强怪">${D.STRONG.map(opt).join("")}</optgroup>`;
  }

  function encounterBox() {
    const s = set();
    const chips = D.PRESETS.map((p, i) =>
      `<button type="button" class="chip" data-act="preset" data-i="${i}" aria-pressed="${s.encName === p.name}">${esc(p.name)}</button>`).join("")
      + `<button type="button" class="chip" data-act="random-enc" aria-pressed="${s.encName === "随机普通战斗"}">随机普通战斗</button>`;
    let body;
    if (s.enc.kind === "lanes") {
      body = `<div class="stalls">${LANES.map(l =>
        `<label for="lane-${l}">第 ${l + 1} 列<select id="lane-${l}" data-act="lane" data-lane="${l}">${enemyOptions(s.enc.lanes[l])}</select></label>`).join("")}</div>`
        + "<p class=\"note\">回声开场会掷 D20 重新选站位；随机普通战斗是 2–3 个弱怪，或 1 个强怪带 1 个弱怪。</p>";
    } else {
      body = `<p class="note">${s.enc.kind === "mirror" ? "镜中人占满 5 列，每列一面 7 血的镜子。" : "血色魅影占满 5 列，每列一个 16 血的魅影卡槽。"}</p>`;
    }
    return `<section class="box" aria-labelledby="h-enc"><div class="box-head"><h2 id="h-enc">敌人</h2><span class="hint">选一个预设，或者逐列挑敌人</span></div><div class="chips">${chips}</div>${body}</section>`;
  }

  function deckBox() {
    const s = set();
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
        + "</span>";
    }).join("");
    const rarities = [["初始", ["初始"]], ["扩充", ["扩充"]], ["梦想", ["梦想"]], ["事件", ["事件"]], ["状态和诅咒", ["状态", "诅咒"]]];
    const catalog = rarities.map(([label, rs]) => {
      const ids = Object.keys(D.CARDS).filter(id => rs.includes(D.CARDS[id].rarity));
      return `<div class="cat-group"><h3>${label}</h3><div class="cat-row">${ids.map(id =>
        `<button type="button" class="add-card ${TYPE_CLASS[D.CARDS[id].type]}" data-act="add" data-id="${id}" title="${esc(baseText(id))}">${esc(D.CARDS[id].name)}</button>`).join("")}</div></div>`;
    }).join("");
    return `<section class="box" aria-labelledby="h-deck"><div class="box-head"><h2 id="h-deck">卡组</h2><span class="hint">${s.deck.length} 张</span>`
      + '<button type="button" class="btn" data-act="deck-reset">恢复初始卡组</button></div>'
      + `<div class="deck-list">${list || '<span class="note">卡组是空的，从下面加牌。</span>'}</div>`
      + `<details open><summary>加牌（点一下加一张基础版）</summary><div class="catalog">${catalog}</div></details>`
      + '<p class="note">加入寒霜之触时，卡组里的冰霜之触会直接变成寒霜之触。</p></section>';
  }

  function relicBox() {
    const s = set();
    const items = Object.entries(D.RELICS).map(([id, r]) => {
      if (!r.combat) return `<div class="relic off"><span></span><span class="rname">${esc(r.name)}</span><span class="rtext">${esc(r.text)}只在完整一局里生效。</span></div>`;
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
    const s = set();
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
    const rule = `<label class="field wide" for="cfg-broken">被打爆的卡槽能放哪些牌（待确认）<select id="cfg-broken" data-act="cfg-rule">${Object.entries(D.BROKEN_SLOT_RULES).map(([k, v]) =>
      `<option value="${k}"${s.config.brokenSlotCards === k ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`
      + '<p class="note">选「只能放即冻术、诡药、冷场、黄金锤」时，正对被打爆卡槽的敌人只有全体伤害打得到；初始卡组没有全体伤害，遇到睡着的怠惰幼兽这类情况会打不完。</p>';
    return `<section class="box" aria-labelledby="h-tune"><div class="box-head"><h2 id="h-tune">数值和规则</h2><span class="hint">改完下一场生效，完整一局也用这些设置</span>`
      + '<button type="button" class="btn" data-act="tune-reset">恢复默认</button></div>'
      + `<div class="fields">${cfg}</div>${rule}`
      + `<details><summary>敌人数值</summary><div class="table-wrap"><table class="tune"><tbody>${enemyRows}</tbody></table></div></details>`
      + `<details><summary>卡牌数值（每格两个数：基础 / 升级）</summary><div class="table-wrap"><table class="tune"><tbody>${cardRows}</tbody></table></div></details>`
      + "</section>";
  }

  function debugBox() {
    const s = set();
    return '<section class="box" aria-labelledby="h-debug"><h2 id="h-debug">调试</h2>'
      + `<label class="toggle"><input type="checkbox" data-act="god" data-k="lockHp"${s.god.lockHp ? " checked" : ""}>锁血：不会掉血</label>`
      + `<label class="toggle"><input type="checkbox" data-act="god" data-k="infiniteEnergy"${s.god.infiniteEnergy ? " checked" : ""}>无限费用</label>`
      + `<div class="seed-row"><label class="field" for="seed">随机种子<input id="seed" type="text" data-act="seed" maxlength="24" value="${esc(s.seed)}"></label>`
      + '<button type="button" class="btn" data-act="seed-new">换一个</button></div>'
      + '<p class="note">锁血和无限费用在完整一局里也生效。同一个种子、同样的操作，洗牌和敌人的随机行为完全一样，方便复现问题。</p></section>';
  }

  function noticeBox() {
    return '<aside class="notice" aria-label="停车场守则"><h2>B2 停车场守则</h2><ol>'
      + "<li>每张牌都要放进一个卡槽才算打出，一个卡槽可以放好几张；持续型的牌放下后，那个卡槽就被占住了。</li>"
      + "<li>单体牌只打它所在卡槽正对面的敌人。</li>"
      + "<li>护甲只护住它所在的卡槽，下个回合开始时清零。</li>"
      + "<li>卡槽被打爆，你掉 6 血；再有东西打这一列，会直接打在你身上。</li>"
      + "<li>没用完的费用不会留到下回合。</li>"
      + "<li>如果你看见一扇电梯门，请记住：凡派尔商务大厦没有电梯。</li>"
      + '</ol><p class="sign">凡派尔商务大厦物业管理处</p></aside>';
  }

  function show() {
    QW.ui.combat.stop();
    document.querySelectorAll("main").forEach(m => { m.hidden = m.id !== "setup"; });
    const s = set();
    const blocked = !s.deck.length ? "卡组是空的" : encEmpty(s.enc) ? "至少放一个敌人" : "";
    U.setTop("<span>设好敌人和卡组，打一场单独的战斗</span>", [], null);
    $("#setup").innerHTML = `<div class="setup-main">${encounterBox()}${deckBox()}${relicBox()}${tuneBox()}${debugBox()}</div>${noticeBox()}`
      + `<div class="start-bar"><span class="summary" id="summary">${esc(blocked || summaryText())}</span>`
      + `<button type="button" class="btn-main" data-act="start"${blocked ? " disabled" : ""}>开始战斗</button></div>`;
  }

  function addToDeck(id) {
    const deck = set().deck;
    if (id === "frostbite") {
      const i = deck.findIndex(x => x.id === "frostTouch");
      if (i >= 0) { deck[i] = { id: "frostbite", up: false }; return; }
    }
    deck.push({ id, up: false });
  }

  function onClick(ev) {
    const b = ev.target.closest("[data-act]");
    if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
    const s = set();
    const up = b.dataset.up === "1";
    const find = () => s.deck.findIndex(x => x.id === b.dataset.id && x.up === up);
    switch (b.dataset.act) {
      case "preset": { const p = D.PRESETS[Number(b.dataset.i)]; s.enc = clone(p.enc); s.encName = p.name; break; }
      case "random-enc": s.enc = D.randomEncounter(U.randomSeed()); s.encName = "随机普通战斗"; break;
      case "add": addToDeck(b.dataset.id); break;
      case "deck-minus": { const i = find(); if (i >= 0) s.deck.splice(i, 1); break; }
      case "deck-plus": s.deck.push({ id: b.dataset.id, up }); break;
      case "deck-up": { const i = find(); if (i >= 0) s.deck[i].up = !up; break; }
      case "deck-reset": s.deck = clone(D.STARTER_DECK); break;
      case "tune-reset": s.config = clone(D.CONFIG); s.overrides = { enemies: {}, cards: {} }; break;
      case "seed-new": s.seed = U.randomSeed(); break;
      case "start": startCombat(); return;
      default: return;
    }
    U.saveSettings();
    show();
  }

  function onChange(ev) {
    const t = ev.target;
    const a = t.dataset && t.dataset.act;
    if (!a) return;
    const s = set();
    let rerender = false;
    const num = () => (t.value !== "" && Number.isFinite(Number(t.value)) ? Math.round(Number(t.value)) : null);
    switch (a) {
      case "lane": s.enc.lanes[Number(t.dataset.lane)] = t.value || null; s.encName = "自定义"; rerender = true; break;
      case "relic": s.relics[t.dataset.id] = t.checked; rerender = t.dataset.id === "beeswax"; break;
      case "wax": s.waxSlot = Number(t.value); break;
      case "cfg": { const v = num(); const r = CONFIG_RANGE[t.dataset.k]; if (v != null) s.config[t.dataset.k] = clamp(v, r[0], r[1]); break; }
      case "en": { const v = num(); if (v != null) (s.overrides.enemies[t.dataset.id] = s.overrides.enemies[t.dataset.id] || {})[t.dataset.k] = clamp(v, 0, 999); break; }
      case "cardp": {
        const v = num();
        if (v == null) break;
        const d = D.CARDS[t.dataset.id];
        const map = s.overrides.cards[t.dataset.id] = s.overrides.cards[t.dataset.id] || {};
        const k = t.dataset.k;
        const pair = (map[k] || (k === "cost" ? d.cost : d.params[k])).slice();
        pair[Number(t.dataset.i)] = clamp(v, 0, 99);
        map[k] = pair;
        break;
      }
      case "cfg-rule": if (D.BROKEN_SLOT_RULES[t.value]) s.config.brokenSlotCards = t.value; break;
      case "god": s.god[t.dataset.k] = t.checked; break;
      case "seed": s.seed = t.value.trim().slice(0, 24) || U.randomSeed(); break;
      default: return;
    }
    U.saveSettings();
    if (rerender) show();
    else { const el = $("#summary"); if (el) el.textContent = summaryText(); }
  }

  const ctrl = {
    info: c => `<span>第 <b class="num">${c.turn}</b> 回合</span><span>${esc(set().encName)}</span><span>种子 <b class="num">${esc(c.seed)}</b></span>`,
    actions: () => [{ act: "restart-same", label: "同种子重开" }, { act: "restart-new", label: "换种子重开" }, { act: "to-setup", label: "改设置" }],
    onAct(a) {
      const c = QW.ui.combat.current();
      if (a === "restart-same") startCombat(c ? c.seed : set().seed);
      else if (a === "restart-new") startCombat(U.randomSeed());
      else if (a === "to-setup") show();
    },
    result: c => ({
      cls: c.result === "win" ? "win" : "lose",
      title: c.result === "win" ? "战斗胜利" : "你倒下了",
      rows: QW.ui.combat.statRows(c),
      buttons: [
        { act: "restart-same", label: "同种子再打一次", main: true },
        { act: "restart-new", label: "换个种子" },
        { act: "to-setup", label: "改设置" },
        { act: "close-result", label: "回去看战场" }
      ]
    }),
    continueLabel: null,
    debug: []
  };

  function startCombat(seed) {
    const s = set();
    if (seed != null) s.seed = String(seed);
    if (!s.deck.length || encEmpty(s.enc)) { show(); return; }
    U.saveSettings();
    const c = new QW.Combat({
      seed: s.seed, encounter: clone(s.enc), deck: clone(s.deck), relics: clone(s.relics), waxSlot: s.waxSlot,
      config: clone(s.config), god: clone(s.god), overrides: clone(s.overrides)
    }).start();
    QW.ui.combat.start(c, ctrl);
  }

  $("#setup").addEventListener("click", onClick);
  $("#setup").addEventListener("change", onChange);
  QW.ui.sandbox = { show, startCombat };
})();
