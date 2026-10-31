/* 界面通用部分：设置存档、顶栏、提示条、说明浮窗、卡组里的牌（战斗外显示用）。 */
(function () {
  "use strict";
  const QW = window.QW;
  const D = QW.data;
  const STORE = "qinwu-sandbox-v1";

  const $ = sel => document.querySelector(sel);
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const TYPE_CLASS = { "攻击": "t-attack", "防御": "t-defense", "技能": "t-skill", "能力": "t-power", "状态": "t-status", "诅咒": "t-status" };
  const CONFIG_RANGE = { playerHp: [1, 999], startHp: [1, 999], slotHp: [1, 99], energy: [0, 30], draw: [0, 15], handLimit: [1, 20], enemyStrength: [0, 20] };
  const RUN_RANGE = {
    floors: [5, 20], rewardFloor: [2, 18], startGold: [0, 999], goldBattle: [0, 99], goldElite: [0, 99], goldBoss: [0, 99], restHeal: [0, 999],
    rarePct: [0, 100], eliteRarePct: [0, 100], shopCards: [0, 10], shopRelics: [0, 6], cardPrice: [0, 99]
  };

  const S = { set: null };

  function randomSeed() { return String(10000 + Math.floor(Math.random() * 90000)); }

  function defaults() {
    return {
      mode: "run",
      encName: D.PRESETS[0].name, enc: clone(D.PRESETS[0].enc),
      deck: clone(D.STARTER_DECK), relics: {}, waxSlot: 2,
      config: clone(D.CONFIG), god: { lockHp: false, infiniteEnergy: false },
      overrides: { enemies: {}, cards: {} }, seed: randomSeed(),
      run: clone(D.RUN), runV: 2, runSeed: randomSeed(), tester: ""
    };
  }

  function validEnc(enc) {
    if (!enc || typeof enc !== "object") return false;
    if (enc.kind === "mirror" || enc.kind === "phantom") return true;
    return enc.kind === "lanes" && Array.isArray(enc.lanes) && enc.lanes.length === 5
      && enc.lanes.every(id => id === null || (D.ENEMIES[id] && (D.WEAK.includes(id) || D.STRONG.includes(id))));
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

  function loadSettings() {
    const d = defaults();
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || "null");
      const s = raw && raw.v === 1 ? raw.set : null;
      if (!s) return d;
      if (s.mode === "run" || s.mode === "sandbox" || s.mode === "records") d.mode = s.mode;
      if (typeof s.tester === "string") d.tester = s.tester.slice(0, 40);
      if (Array.isArray(s.deck)) d.deck = s.deck.filter(x => x && D.CARDS[x.id]).map(x => ({ id: x.id, up: !!x.up })).slice(0, 80);
      if (validEnc(s.enc)) { d.enc = s.enc; d.encName = String(s.encName || "自定义").slice(0, 30); }
      if (s.relics) for (const k of Object.keys(D.RELICS)) if (s.relics[k] && D.RELICS[k].combat) d.relics[k] = true;
      if (Number.isInteger(s.waxSlot) && s.waxSlot >= 0 && s.waxSlot < 5) d.waxSlot = s.waxSlot;
      if (s.config) for (const [k, r] of Object.entries(CONFIG_RANGE)) {
        const v = Number(s.config[k]);
        if (Number.isFinite(v)) d.config[k] = clamp(Math.round(v), r[0], r[1]);
      }
      if (s.config && D.BROKEN_SLOT_RULES[s.config.brokenSlotCards]) d.config.brokenSlotCards = s.config.brokenSlotCards;
      if (s.god) { d.god.lockHp = !!s.god.lockHp; d.god.infiniteEnergy = !!s.god.infiniteEnergy; }
      if (s.overrides) d.overrides = sanitizeOverrides(s.overrides);
      if (s.seed) d.seed = String(s.seed).slice(0, 24);
      if (s.runSeed) d.runSeed = String(s.runSeed).slice(0, 24);
      if (s.run && s.runV === 2) {  // 旧版地图的设置（10 层、按路线走）不再沿用
        for (const [k, r] of Object.entries(RUN_RANGE)) {
          const v = Number(s.run[k]);
          if (Number.isFinite(v)) d.run[k] = clamp(Math.round(v), r[0], r[1]);
        }
        if (s.run.weights) for (const k of Object.keys(D.RUN.weights)) {
          const v = Number(s.run.weights[k]);
          if (Number.isFinite(v)) d.run.weights[k] = clamp(Math.round(v), 0, 100);
        }
        if (typeof s.run.noStreak === "boolean") d.run.noStreak = s.run.noStreak;
      }
    } catch (e) { /* 没有存档就用默认 */ }
    return d;
  }

  function saveSettings() {
    try { localStorage.setItem(STORE, JSON.stringify({ v: 1, set: S.set })); } catch (e) { /* 存不了就不存 */ }
  }

  /* ---------- 顶栏 ---------- */
  let topHandler = null;
  function setTop(info, actions, handler) {
    $("#top-info").innerHTML = info || "";
    $("#top-actions").innerHTML = (actions || []).map(a => `<button type="button" class="btn" data-act="${esc(a.act)}">${esc(a.label)}</button>`).join("");
    topHandler = handler || null;
  }

  /* ---------- 提示条 ----------
     默认是「做不了」的红色提示；kind 为 "ok" 时是「已经办好了」的绿色提示。 */
  let flashTimer = null;
  function flash(text, kind) {
    const el = $("#flash");
    el.textContent = text;
    el.className = "flash" + (kind ? " " + kind : "");
    el.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.hidden = true; }, kind === "ok" ? 3200 : 2400);
  }
  function hideFlash() { $("#flash").hidden = true; }

  /* ---------- 弹窗 ----------
     keep：里面有没提交的表单，点背景或按 Esc 不关，只能点里面的按钮关。 */
  let modalBack = null;
  function openModal(html, keep) {
    const m = $("#modal");
    if (m.hidden) modalBack = document.activeElement;
    m.innerHTML = html;
    m.dataset.keep = keep ? "1" : "";
    m.hidden = false;
    m.scrollTop = 0;
    const box = m.querySelector("[data-focus]") || m.querySelector('[role="dialog"]');
    if (box) {
      if (!box.hasAttribute("tabindex") && box.getAttribute("role") === "dialog") box.setAttribute("tabindex", "-1");
      box.focus({ preventScroll: true });
    }
  }
  function closeModal() {
    const m = $("#modal");
    if (m.hidden) return;
    m.hidden = true;
    m.innerHTML = "";
    if (modalBack && document.contains(modalBack) && typeof modalBack.focus === "function") modalBack.focus({ preventScroll: true });
    modalBack = null;
  }
  $("#modal").addEventListener("click", ev => {
    const m = ev.currentTarget;
    if ((ev.target === m && m.dataset.keep !== "1") || ev.target.closest("[data-close-modal]")) closeModal();
  });
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !$("#modal").hidden && $("#modal").dataset.keep !== "1") closeModal();
  });

  /* ---------- 说明浮窗 ---------- */
  function showTip(html, el) {
    const tip = $("#tip");
    tip.innerHTML = html;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 16);
    tip.style.left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8) + "px";
    tip.style.top = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - tip.offsetHeight - 8)) + "px";
  }
  function hideTip() { const t = $("#tip"); if (t) t.hidden = true; }

  /* ---------- 战斗外的牌 ---------- */
  function cardParams(id, up) {
    const d = D.CARDS[id];
    const over = (S.set && S.set.overrides.cards[id]) || {};
    const p = {};
    for (const k of Object.keys(d.params || {})) p[k] = (over[k] || d.params[k])[up ? 1 : 0];
    return p;
  }
  function cardCost(id, up) {
    const d = D.CARDS[id];
    if (!d.cost) return null;
    const over = (S.set && S.set.overrides.cards[id]) || {};
    return (over.cost || d.cost)[up ? 1 : 0];
  }
  function cardLabel(c) { return D.CARDS[c.id].name + (c.up ? "+" : ""); }
  function cardText(c) { return D.CARDS[c.id].text(cardParams(c.id, c.up), c.up); }

  /* 一张停车票样子的牌。o.attrs：额外属性；o.extra：牌底下附加的 HTML；o.tag：用 div 还是 button。 */
  function ticket(c, o) {
    const opt = o || {};
    const d = D.CARDS[c.id];
    const cost = cardCost(c.id, c.up);
    const tag = opt.tag || "button";
    const cls = ["card", TYPE_CLASS[d.type]].concat(opt.cls || []);
    const tags = `<i>${esc(d.type)}</i>${d.faction ? `<i>${esc(d.faction)}</i>` : ""}`;
    const label = `${cardLabel(c)}，${cost == null ? "无法打出" : `${cost} 费`}，${cardText(c)}`;
    return `<${tag}${tag === "button" ? ' type="button"' : ""} class="${cls.join(" ")}" ${opt.attrs || ""} aria-label="${esc(opt.label || label)}">`
      + (cost != null ? `<span class="cost">${cost}</span>` : "")
      + `<span class="cname">${esc(cardLabel(c))}</span><span class="ctags">${tags}</span><span class="ctext">${esc(cardText(c))}</span>`
      + (opt.extra || "") + `</${tag}>`;
  }

  document.addEventListener("click", ev => {
    const b = ev.target.closest(".top [data-act]");
    if (b && topHandler) topHandler(b.dataset.act);
    if (!ev.target.closest("[data-tip], [data-rtip], #tip")) hideTip();
  });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape") hideTip(); });
  window.addEventListener("resize", hideTip);

  QW.ui = {
    $, esc, clamp, clone, reduceMotion, TYPE_CLASS, CONFIG_RANGE, RUN_RANGE, S,
    randomSeed, defaults, validEnc, loadSettings, saveSettings, setTop, flash, hideFlash, openModal, closeModal, showTip, hideTip,
    cardParams, cardCost, cardLabel, cardText, ticket
  };
})();
