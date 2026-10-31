/* 对局记录：把一局（或沙盒里的一场战斗）整理成一个 JSON，导入别人发来的记录，再把多份记录汇总。
   不碰页面，方便测试。 */
(function (root) {
  "use strict";
  const QW = root.QW || (root.QW = {});
  const D = QW.data;
  const FORMAT = "slot-roguelike-record";
  const BUNDLE = "slot-roguelike-records";
  const MODES = ["run", "sandbox"];
  const clone = o => JSON.parse(JSON.stringify(o));
  const cardName = c => (D.CARDS[c.id] ? D.CARDS[c.id].name + (c.up ? "+" : "") : String(c.id));
  const relicNames = relics => Object.keys(relics || {}).filter(k => relics[k] && D.RELICS[k]).map(k => D.RELICS[k].name);

  /* 完整一局 → 记录。settings 是界面上的设置（数值、规则、锁血等）。 */
  function fromRun(run, settings) {
    const r = run.record || { timeline: [], fights: [] };
    const st = run.stats || {};
    const result = run.result || (r.abandoned ? "abandoned" : "unfinished");
    if (result !== "unfinished" && !r.endedAt) r.endedAt = new Date().toISOString();
    return {
      format: FORMAT, version: 1, id: r.id, mode: "run",
      startedAt: r.startedAt, endedAt: r.endedAt || null,
      seed: String(run.seed), result,
      settings: settingsPart(settings, { run: clone(run.cfg) }),
      summary: {
        floor: run.floor, floors: run.cfg.floors, hp: run.hp, maxHp: run.maxHp, gold: run.gold,
        deckSize: run.deck.length, relics: relicNames(run.relics),
        battles: st.battles || 0, elites: st.elites || 0, bosses: st.bosses || 0, turns: st.turns || 0, hpLost: st.hpLost || 0,
        goldEarned: st.goldEarned || 0, goldSpent: st.goldSpent || 0, cardsAdded: st.cardsAdded || 0, cardsRemoved: st.cardsRemoved || 0
      },
      path: (st.path || []).slice(),
      timeline: clone(r.timeline || []),
      fights: clone(r.fights || []),
      finalDeck: run.deck.map(cardName),
      survey: run.survey ? clone(run.survey) : null
    };
  }

  /* 沙盒里的一场战斗 → 记录。meta：{id, startedAt, endedAt, encName, survey}。 */
  function fromSandbox(c, meta, settings) {
    const s = settings || {};
    return {
      format: FORMAT, version: 1, id: meta.id, mode: "sandbox",
      startedAt: meta.startedAt, endedAt: meta.endedAt || null,
      seed: String(c.seed), result: c.result || "unfinished",
      settings: settingsPart(s, { encounter: meta.encName || "", relics: relicNames(s.relics) }),
      summary: {
        enemies: c.encounterNames(), turns: c.turn, hp: c.player.hp, maxHp: c.player.maxHp, hpLost: c.stats.hpLost,
        slotsLost: c.stats.slotsLost, cardsPlayed: c.stats.cardsPlayed, damageDealt: c.stats.damageDealt
      },
      path: [],
      timeline: [],
      fights: [Object.assign({ type: "sandbox" }, c.summary())],
      finalDeck: c.deckSpec.map(cardName),
      survey: meta.survey ? clone(meta.survey) : null
    };
  }

  function settingsPart(s, extra) {
    return Object.assign({
      rules: clone(s.config || {}),
      overrides: clone(s.overrides || {}),
      god: clone(s.god || {})
    }, extra);
  }

  function isRecord(o) {
    return !!o && typeof o === "object" && o.format === FORMAT && o.version === 1
      && typeof o.id === "string" && o.id.length > 0 && MODES.includes(o.mode);
  }

  /* 导入：接受单份记录、记录数组，或者「全部下载」得到的合集。只留认得的记录。 */
  function normalizeImport(json) {
    if (Array.isArray(json)) return json.filter(isRecord);
    if (json && json.format === BUNDLE && Array.isArray(json.records)) return json.records.filter(isRecord);
    return isRecord(json) ? [json] : [];
  }

  function bundle(records) {
    return { format: BUNDLE, version: 1, exportedAt: new Date().toISOString(), records };
  }

  function stamp(iso) {
    const d = iso ? new Date(iso) : new Date();
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function fileName(rec) {
    const seed = String(rec.seed).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "seed";
    return `record-${rec.mode}-${seed}-${stamp(rec.endedAt || rec.startedAt)}.json`;
  }

  function bundleName(count) { return `records-${count}-${stamp()}.json`; }

  /* 导入的记录是别人发来的文件，里面什么都可能有：汇总时只认数组、数字和字符串，
     用来计数的表都不带原型（键名叫 __proto__ 也只是普通的键）。 */
  const arr = x => (Array.isArray(x) ? x : []);
  const num = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const table = () => Object.create(null);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function eventKey(t) {
    const d = t.data || {};
    const ev = D.EVENTS.find(e => e.id === d.event);
    const opt = ev && ev.options[d.choice];
    return ev && opt ? `${ev.name}：${opt.label}` : String(t.text);
  }

  /* 汇总：局数和胜负、走到第几层、每场战斗的平均回合和掉血、选路、卡牌奖励的选取率、奇遇怎么选、
     出牌次数、输在谁手上，以及问卷。 */
  function aggregate(records) {
    const out = {
      total: records.length, runs: 0, sandbox: 0,
      results: { run: { win: 0, lose: 0, abandoned: 0, unfinished: 0 }, sandbox: { win: 0, lose: 0, unfinished: 0 } },
      runEnds: [], fights: 0, fightTurns: 0, fightHpLost: 0,
      nodeChoices: table(), cardOffers: table(), rewardSkips: 0, rewardPicks: 0, eventChoices: table(),
      cardPlays: table(), lostTo: table(), survey: table(), surveyed: 0
    };
    const add = (map, k, n) => { const key = String(k); map[key] = (map[key] || 0) + (n == null ? 1 : num(n)); };
    const offer = k => out.cardOffers[String(k)] || (out.cardOffers[String(k)] = { offered: 0, picked: 0 });
    for (const r of records) {
      if (r.mode === "run") out.runs++; else out.sandbox++;
      const res = out.results[r.mode === "run" ? "run" : "sandbox"];
      res[own(res, r.result) ? r.result : "unfinished"]++;
      const s = r.summary || {};
      if (r.mode === "run" && typeof s.floor === "number") out.runEnds.push({ floor: num(s.floor), floors: num(s.floors), result: r.result });
      if (r.mode === "run") for (const t of arr(r.path)) add(out.nodeChoices, own(D.NODE_TYPES, t) ? D.NODE_TYPES[t] : t);
      for (const t of arr(r.timeline)) {
        if (!t || !t.data) continue;
        if (t.kind === "cards" && Array.isArray(t.data.offered)) {
          t.data.offered.forEach(k => { offer(k).offered++; });
          if (t.data.picked) { offer(t.data.picked).picked++; out.rewardPicks++; } else out.rewardSkips++;
        } else if (t.kind === "event") add(out.eventChoices, eventKey(t));
      }
      for (const f of arr(r.fights)) {
        if (!f) continue;
        out.fights++;
        out.fightTurns += num(f.turns);
        out.fightHpLost += num(f.hpLost);
        if (f.played && typeof f.played === "object") for (const k of Object.keys(f.played)) add(out.cardPlays, k, f.played[k]);
        if (f.result === "lose") for (const e of arr(f.enemies)) add(out.lostTo, e);
      }
      const ans = r.survey && r.survey.answers;
      if (!ans || typeof ans !== "object") continue;
      out.surveyed++;
      for (const q of D.SURVEY) {
        const v = ans[q.id];
        if (v == null || typeof v === "object" || String(v).trim() === "") continue;
        if (q.type === "scale" && !(Number(v) >= 1 && Number(v) <= 5)) continue;
        const slot = out.survey[q.id] || (out.survey[q.id] = { type: q.type, n: 0, sum: 0, counts: table(), texts: [] });
        slot.n++;
        if (q.type === "scale") { slot.sum += Number(v); add(slot.counts, Math.round(Number(v))); }
        else if (q.type === "text" || q.type === "short") slot.texts.push({ text: String(v), who: String(ans.tester || ""), when: r.endedAt || r.startedAt || "", id: r.id });
        else add(slot.counts, v);
      }
    }
    return out;
  }

  /* 同一份记录（id 相同）出现好几次时只留一份：有问卷的优先，都有问卷就留后填的，否则留结束得晚的。 */
  const when = r => String(r.endedAt || r.startedAt || "");
  function better(a, b) {
    if (!!a.survey !== !!b.survey) return a.survey ? a : b;
    if (a.survey && b.survey) return String(b.survey.at || "") > String(a.survey.at || "") ? b : a;
    return when(b) > when(a) ? b : a;
  }
  function dedupe(records) {
    const map = new Map();
    for (const r of records) map.set(r.id, map.has(r.id) ? better(map.get(r.id), r) : r);
    return Array.from(map.values());
  }
  /* 新的在前。 */
  function sort(records) { return records.slice().sort((a, b) => when(b).localeCompare(when(a))); }

  /* 问卷答案连同题目一起存，打开 JSON 就能看懂。 */
  function makeSurvey(answers) {
    const questions = {};
    for (const q of D.SURVEY) if (answers[q.id] != null) questions[q.id] = q.q;
    return { at: new Date().toISOString(), answers: clone(answers), questions };
  }

  QW.record = { FORMAT, BUNDLE, fromRun, fromSandbox, isRecord, normalizeImport, bundle, fileName, bundleName, aggregate, dedupe, sort, makeSurvey };
})(typeof window !== "undefined" ? window : globalThis);
