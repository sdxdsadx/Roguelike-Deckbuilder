/* 完整一局：地图、奖励、奇遇、商店、阳台、宝箱。只管状态和规则，不碰页面。
   一局的状态是一个纯 JSON 对象，可以直接存进 localStorage；随机数都由「种子 + 计数」推出来，
   同一个种子、同样的选择，整局完全一样。 */
(function (root) {
  "use strict";
  const QW = root.QW || (root.QW = {});
  const D = QW.data;
  const OPTIONS = 3;
  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ok = { ok: true };
  const no = reason => ({ ok: false, reason });
  const cardName = c => D.CARDS[c.id].name + (c.up ? "+" : "");

  function rngFor(run, tag) { return QW.rng.create(`${run.seed}:${tag}:${run.rngCount++}`); }

  /* 对局记录：每一步都记进 run.record.timeline，每场战斗的摘要记进 run.record.fights。 */
  const now = () => new Date().toISOString();
  function track(run, kind, text, data) {
    if (!run.record) return;
    const entry = { at: now(), floor: run.floor, kind, text };
    if (data) entry.data = data;
    run.record.timeline.push(entry);
  }

  /* ---------- 地图 ----------
     一共 floors 层：第 1 层固定打小怪，倒数第 2 层固定阳台，最后一层 Boss，rewardFloor 那一层固定是宝箱。
     其余各层的选项数 2 个、3 个交替（cfg.optionPattern 为 "three" 时都是 3 个），可以任选一个往上走。
     「假随机」：先按比例算好整张地图上奇遇、挑战、阳台、商店各出几个，再分到各层，
     所以每局各类节点的总数是固定的，不会一局没有商店。
     每个随机层固定有 1 个战斗选项，其余的从这些名额里拿，同一层不重复；
     第 2、3 层不出挑战，阳台层前一层不出阳台。
     不扎堆（cfg.noStreak，默认开）：一类节点有 3 个以上的，不会连着出现 3 层；只有 1–2 个的（默认是商店），
     不会出现在相邻两层。数量多到躲不开的那一类不限制（默认的奇遇有 7 个，随机层只有 8 层）。 */
  function layout(cfg) {
    const total = clamp(Math.round(cfg.floors), 5, 20);
    const reward = clamp(Math.round(cfg.rewardFloor), 2, total - 2);
    return { total, reward };
  }

  function fixedType(f, total, reward) {
    if (f === 1) return "battle";
    if (f === total) return "boss";
    if (f === total - 1) return "rest";
    if (f === reward) return "treasure";
    return null;
  }

  /* 按比例分配 n 个名额（最大余数法），保证总数正好是 n。 */
  function quota(weights, n) {
    const keys = Object.keys(weights).filter(k => weights[k] > 0);
    const sum = keys.reduce((a, k) => a + weights[k], 0);
    if (!sum || !n) return {};
    const raw = keys.map(k => ({ k, v: weights[k] / sum * n }));
    const out = {};
    let used = 0;
    for (const r of raw) { out[r.k] = Math.floor(r.v); used += out[r.k]; }
    raw.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
    for (let i = 0; used < n; i = (i + 1) % raw.length) { out[raw[i].k]++; used++; }
    return out;
  }

  /* 把名额分到各层：限制最多的层先分（第 2、3 层），每层挑一组类型，同一层不重复；
     分到后面发现剩下的分不完，就退回去换一组。checks 是额外的限制（不扎堆），从严到松排好。
     放不下时依次放宽：先一步步放宽不扎堆，再去掉层数限制，最后允许同层重复。 */
  function combos(arr, k, repeat) {
    const out = [];
    const walk = (start, pick) => {
      if (pick.length === k) { out.push(pick.slice()); return; }
      for (let i = start; i < arr.length; i++) { pick.push(arr[i]); walk(repeat ? i : i + 1, pick); pick.pop(); }
    };
    walk(0, []);
    return out;
  }

  /* slotsOf(f)：第 f 层除了战斗还有几个选项。 */
  function assignBag(rng, counts, floors, slotsOf, allowed, checks) {
    const types = Object.keys(counts).filter(k => counts[k] > 0);
    const need = types.reduce((a, t) => a + counts[t], 0);
    const per = need ? slotsOf : () => 0;  // 比例全是 0：每层只有战斗
    const tries = (checks || []).map(c => [allowed, true, c]).concat([[allowed, true, null], [() => true, true, null], [() => true, false, null]]);
    for (const [ok, distinct, extra] of tries) {
      const left = Object.assign({}, counts);
      const order = floors.slice().sort((a, b) => types.filter(t => ok(a, t)).length - types.filter(t => ok(b, t)).length || a - b);
      const result = {};
      let steps = 0;
      const feasible = i => {
        const rest = order.slice(i);
        return types.every(t => left[t] <= (distinct ? rest.filter(f => ok(f, t)).length : rest.reduce((a, f) => a + per(f), 0)));
      };
      const dfs = i => {
        if (i === order.length) return types.every(t => left[t] === 0);
        if (++steps > 50000) return false;
        const f = order[i];
        for (const pick of rng.shuffle(combos(types.filter(t => left[t] > 0 && ok(f, t)), per(f), !distinct))) {
          if (!distinct && pick.some(t => pick.filter(x => x === t).length > left[t])) continue;
          if (extra && !extra(result, f, pick)) continue;
          pick.forEach(t => { left[t]--; });
          result[f] = pick;
          if (feasible(i + 1) && dfs(i + 1)) return true;
          delete result[f];
          pick.forEach(t => { left[t]++; });
        }
        return false;
      };
      if (dfs(0)) return result;
    }
    const result = {};
    floors.forEach(f => { result[f] = []; });
    return result;
  }

  /* 不扎堆：每一类最多连着几层。只有 1–2 个的不挨着（1 层），其余最多连着 2 层；
     怎么摆都躲不开的那一类不限制。「躲不躲得开」从下往上一层层算：已经定下来的层（固定层、换地图时下面走过的层）
     上有这一类就必须算进连着的层数里，能放这一类的随机层可放可不放，看最多能放几个够不够数。 */
  function spreadLimits(counts, total, isFree, fixedHas) {
    const limits = {};
    for (const t of Object.keys(counts)) {
      if (!(counts[t] > 0)) continue;
      const r = counts[t] <= 2 ? 1 : 2;
      let best = [0].concat(Array(r).fill(-Infinity));  // best[k]：现在连着 k 层有这一类时，最多放了几个
      for (let g = 1; g <= total; g++) {
        const next = Array(r + 1).fill(-Infinity);
        const forced = fixedHas(g, t);
        const free = isFree(g, t);
        for (let k = 0; k <= r; k++) {
          if (best[k] === -Infinity) continue;
          // 定下来的层改不了：已经连着超过上限也只能认，只是紧挨着它的随机层不能再放
          if (forced) { const k2 = Math.min(k + 1, r); next[k2] = Math.max(next[k2], best[k]); continue; }
          next[0] = Math.max(next[0], best[k]);
          if (free && k < r) next[k + 1] = Math.max(next[k + 1], best[k] + 1);
        }
        best = next;
      }
      if (Math.max(...best) >= counts[t]) limits[t] = r;
    }
    return limits;
  }

  /* 每个随机层有几个选项：2、3 交替时，从第一个随机层开始按 2、3、2、3 排；
     按整张图的随机层顺序算，换地图以后也接得上。没写 optionPattern 的旧存档都是 3 个。 */
  function optionCounts(cfg, total, reward) {
    const out = {};
    let k = 0;
    for (let f = 1; f <= total; f++) {
      if (fixedType(f, total, reward)) continue;
      out[f] = cfg.optionPattern === "alternate" ? (k % 2 === 0 ? 2 : 3) : OPTIONS;
      k++;
    }
    return out;
  }

  /* below：换地图时下面已经走过的那几层，不扎堆要连着它们一起看。 */
  function generateMap(seed, cfg, tag, fromFloor, below) {
    const rng = QW.rng.create(`${seed}:map:${tag}`);
    const { total, reward } = layout(cfg);
    const from = fromFloor || 1;
    const randomFloors = [];
    for (let f = from; f <= total; f++) if (!fixedType(f, total, reward)) randomFloors.push(f);
    const opts = optionCounts(cfg, total, reward);
    const slotsOf = f => opts[f] - 1;
    const counts = quota(cfg.weights, randomFloors.reduce((a, f) => a + slotsOf(f), 0));
    const allowed = (f, t) => !(f <= 3 && t === "elite") && !(f === total - 2 && t === "rest");
    const checks = [];
    if (cfg.noStreak !== false && randomFloors.length) {
      const prior = {};
      for (const r of below || []) prior[r.floor] = r.options.map(o => o.type);
      const fixedAt = g => {
        if (prior[g]) return prior[g];
        const fx = g >= from && g <= total ? fixedType(g, total, reward) : null;
        return fx ? [fx] : [];
      };
      const limits = spreadLimits(counts, total, (g, t) => randomFloors.includes(g) && allowed(g, t), (g, t) => fixedAt(g).includes(t));
      const typesAt = (result, g) => result[g] || fixedAt(g);
      const make = lim => (result, f, pick) => pick.every(t => {
        if (!lim[t]) return true;
        let n = 1;
        for (let g = f - 1; typesAt(result, g).includes(t); g--) n++;
        for (let g = f + 1; typesAt(result, g).includes(t); g++) n++;
        return n <= lim[t];
      });
      // 每一类单独都摆得开，合在一起却可能摆不开：那就从数量最多的那一类开始，一类一类放开
      const byCount = Object.keys(limits).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
      for (let i = 0; i < byCount.length; i++) {
        const lim = {};
        byCount.slice(i).forEach(t => { lim[t] = limits[t]; });
        checks.push(make(lim));
      }
    }
    const slots = assignBag(rng, counts, randomFloors, slotsOf, allowed, checks);
    const rows = [];
    for (let f = from; f <= total; f++) {
      const fixed = fixedType(f, total, reward);
      const types = fixed ? [fixed] : rng.shuffle(["battle"].concat(slots[f]));
      rows.push({ floor: f, options: types.map((type, i) => ({ id: type === "boss" ? "boss" : `f${f}-${i}-${tag}`, floor: f, type })) });
    }
    return { total, reward, from, rows };
  }

  function getNode(run, id) {
    for (const row of run.map.rows) for (const o of row.options) if (o.id === id) return o;
    return null;
  }

  /* ---------- 开局 ---------- */
  function createRun(opts) {
    const cfg = Object.assign(clone(D.RUN), clone(opts.run || {}));
    cfg.weights = Object.assign(clone(D.RUN.weights), clone((opts.run || {}).weights || {}));
    delete cfg.weights.battle;
    const lay = layout(cfg);
    cfg.floors = lay.total;
    cfg.rewardFloor = lay.reward;
    const conf = Object.assign({}, D.CONFIG, opts.config || {});
    const run = {
      v: 2, seed: String(opts.seed), cfg, rngCount: 0,
      hp: Math.min(conf.startHp, conf.playerHp), maxHp: conf.playerHp, gold: cfg.startGold,
      deck: clone(D.STARTER_DECK), relics: { brokenPage: true }, relicFrom: { brokenPage: "开局自带" }, waxSlot: null, netsukeUsed: false, ring: 0,
      removals: 0, firstReward: true, nextStrength: 0, usedEvents: [], fights: 0,
      mapGen: 0, map: null, pos: null, floor: 0, visited: [], areaSlotLost: false,
      lockHp: false, freeTravel: false,
      screen: { kind: "map" }, queue: [], result: null, survey: null,
      record: { id: opts.id || `run-${opts.seed}-${Date.now().toString(36)}`, startedAt: opts.startedAt || now(), timeline: [], fights: [] },
      stats: { battles: 0, elites: 0, bosses: 0, hpLost: 0, turns: 0, goldEarned: 0, goldSpent: 0, cardsAdded: 0, cardsRemoved: 0, relics: [], path: [] }
    };
    run.map = generateMap(run.seed, cfg, "0", 1);
    return run;
  }

  /* ---------- 走地图 ---------- */
  function available(run) {
    if (run.result || run.screen.kind !== "map") return [];
    const rows = run.map.rows;
    if (run.freeTravel) return [].concat(...rows.filter(r => r.floor > run.floor).map(r => r.options.map(o => o.id)));
    const next = rows.find(r => r.floor === run.floor + 1);
    return next ? next.options.map(o => o.id) : [];
  }

  function go(run, id) {
    if (!available(run).includes(id)) return no("去不了那里");
    enterNode(run, id);
    return ok;
  }

  function enterNode(run, id) {
    const node = getNode(run, id);
    run.pos = id;
    run.floor = node.floor;
    run.visited.push(id);
    run.stats.path.push(node.type);
    track(run, "enter", `第 ${node.floor} 层：${D.NODE_TYPES[node.type]}`, { node: id, type: node.type });
    let type = node.type;
    if (type === "event") {
      const ev = pickEvent(run);
      if (ev) { run.screen = { kind: "event", node: id, event: ev, choice: null, lines: [], notes: [] }; return run.screen; }
      type = "battle";
    }
    if (type === "battle" || type === "elite" || type === "boss") {
      run.screen = { kind: "combat", node: id, type, enc: encounterFor(run, type), seed: `${run.seed}:fight:${run.fights++}` };
    } else if (type === "shop") {
      run.screen = { kind: "shop", node: id, shop: makeShop(run), notes: [] };
    } else if (type === "rest") {
      run.screen = { kind: "rest", node: id, done: null, notes: [] };
    } else {
      run.screen = { kind: "treasure", node: id, opened: false, lines: [], notes: [] };
    }
    return run.screen;
  }

  function encounterFor(run, type) {
    if (type === "elite") return { kind: "mirror" };
    if (type === "boss") return { kind: "phantom" };
    return D.randomEncounter(`${run.seed}:enc:${run.rngCount++}`, run.stats.battles === 0);
  }

  /* ---------- 战斗 ---------- */
  function combatOptions(run, settings) {
    const sc = run.screen;
    const s = settings || {};
    const config = Object.assign({}, D.CONFIG, s.config || {}, {
      playerHp: run.maxHp, startHp: run.hp,
      enemyStrength: ((s.config && s.config.enemyStrength) || 0) + run.nextStrength
    });
    return {
      seed: sc.seed, encounter: clone(sc.enc), deck: clone(run.deck),
      relics: {
        netsuke: !!run.relics.netsuke, watch: !!run.relics.watch, beeswax: run.waxSlot != null,
        ring: !!run.relics.ring && run.ring > 0, yukiOnna: !!run.relics.yukiOnna
      },
      waxSlot: run.waxSlot == null ? 2 : run.waxSlot, ringArmor: run.ring, netsukeUsed: run.netsukeUsed,
      config, god: clone(s.god || {}), overrides: clone(s.overrides || {})
    };
  }

  function finishCombat(run, c) {
    const sc = run.screen;
    if (sc.kind !== "combat" || !c.result) return no("战斗还没结束");
    run.hp = c.player.hp;
    run.ring = c.ring;
    run.netsukeUsed = c.netsukeUsed;
    for (const card of c.removedForever) {
      const i = run.deck.findIndex(x => x.id === card.id);
      if (i >= 0) run.deck.splice(i, 1);
    }
    if (c.stats.slotsLost > 0) run.areaSlotLost = true;
    run.stats.hpLost += c.stats.hpLost;
    run.stats.turns += c.turn;
    run.nextStrength = 0;
    const sum = c.summary();
    if (run.record) run.record.fights.push(Object.assign({ floor: run.floor, type: sc.type, endedAt: now() }, sum));
    const what = sc.type === "boss" ? "Boss 战" : D.NODE_TYPES[sc.type];
    track(run, "fight", `${what}${c.result === "win" ? "胜利" : "失败"}（${sum.enemies.join("、")}）：${c.turn} 回合，掉了 ${c.stats.hpLost} 血`);
    if (c.result !== "win") {
      run.result = "lose";
      run.queue = [];
      run.screen = { kind: "end" };
      return ok;
    }
    const got = [];
    if (sc.type === "battle") {
      run.stats.battles++;
      addGold(run, run.cfg.goldBattle, got);
      run.queue.push(cardStep(run, run.cfg.rarePct, "选一张牌加入卡组", false));
    } else if (sc.type === "elite") {
      run.stats.elites++;
      addGold(run, run.cfg.goldElite, got);
      run.queue.push(cardStep(run, run.cfg.eliteRarePct, "选一张牌加入卡组", false));
      const relic = randomRelic(run);
      if (relic) gainRelic(run, relic, got, `第 ${run.floor} 层挑战奖励`);
    } else {
      run.stats.bosses++;
      addGold(run, run.cfg.goldBoss, got);
      run.queue.push(cardStep(run, 100, "选一张梦想卡加入卡组", true));
      run.queue.push({ kind: "areaEnd" });
    }
    run.screen = { kind: "reward", type: sc.type, got, notes: [] };
    autoSteps(run);
    return ok;
  }

  /* ---------- 奖励 ---------- */
  function addGold(run, n, lines) {
    if (!(n > 0)) return;
    run.gold += n;
    run.stats.goldEarned += n;
    if (lines) lines.push(`金币 +${n}`);
  }

  /* 一组牌（卡牌奖励、商店、奇遇随机得牌）：每组最多 1 张梦想卡，带不带看 rarePct（%）；
     dreamOnly 时全是梦想卡（Boss 奖励）。同一组不重复。 */
  function rollCards(rng, n, rarePct, dreamOnly) {
    const common = Object.keys(D.CARDS).filter(id => D.CARDS[id].rarity === "扩充");
    const rare = Object.keys(D.CARDS).filter(id => D.CARDS[id].rarity === "梦想");
    const take = (pool, k, out) => {
      const avail = pool.filter(id => !out.includes(id));
      for (let i = 0; i < k && avail.length; i++) out.push(avail.splice(rng.int(0, avail.length - 1), 1)[0]);
      return out;
    };
    let out = [];
    if (dreamOnly) take(rare, n, out);
    else {
      if (n > 0 && rng.int(1, 100) <= rarePct) take(rare, 1, out);
      take(common, n - out.length, out);
      take(rare, n - out.length, out);  // 扩充牌不够时才用梦想卡补
      out = rng.shuffle(out);
    }
    return out.map(id => ({ id, up: false }));
  }

  function cardStep(run, rarePct, title, dreamOnly) {
    let n = 3;
    let t = title;
    if (run.relics.brokenPage && run.firstReward) {
      n = 4;
      t += "（残破书页：多 1 个选项）";
    }
    run.firstReward = false;
    return { kind: "cards", title: t, options: rollCards(rngFor(run, "cards"), n, rarePct, dreamOnly) };
  }

  function randomRelic(run) {
    const pool = D.RELIC_POOL.filter(id => !run.relics[id]);
    return pool.length ? rngFor(run, "relic").pick(pool) : null;
  }

  /* from：从哪儿拿到的，奇物一览里显示。 */
  function gainRelic(run, id, lines, from) {
    if (!id || run.relics[id]) return;
    run.relics[id] = true;
    (run.relicFrom = run.relicFrom || {})[id] = from || (run.floor ? `第 ${run.floor} 层` : "开局");
    run.stats.relics.push(id);
    track(run, "relic", `获得奇物「${D.RELICS[id].name}」`, { relic: id });
    if (lines) lines.push(`奇物「${D.RELICS[id].name}」`);
    if (id === "hollowHeart") run.queue.push({ kind: "remove", count: 1, title: "空虚之心：选一张牌移除" });
    else if (id === "encyclopedia") for (let k = 1; k <= 3; k++) run.queue.push(cardStep(run, run.cfg.rarePct, `百科全书：第 ${k} 组卡牌奖励`, false));
    else if (id === "hammerRelic") { addCard(run, { id: "goldHammer", up: false }); if (lines) lines.push("黄金锤加入了卡组"); }
    else if (id === "beeswax") run.queue.push({ kind: "wax", title: "芳香蜂蜡：选一个卡槽，以后都是蜂蜡卡槽" });
    else if (id === "ring") run.ring = D.RELICS.ring.armor;
  }

  function addCard(run, card) {
    if (card.id !== "larva") run.stats.cardsAdded++;
    if (card.id === "frostbite") {
      const i = run.deck.findIndex(x => x.id === "frostTouch");
      if (i >= 0) { run.deck[i] = { id: "frostbite", up: !!(card.up || run.deck[i].up) }; return "replaced"; }
    }
    run.deck.push({ id: card.id, up: !!card.up });
    return "added";
  }

  function changeHp(run, delta, lines) {
    if (delta < 0 && run.lockHp) { lines.push(`锁血：本来要失去 ${-delta} 点生命`); return; }
    const before = run.hp;
    run.hp = clamp(run.hp + delta, 0, run.maxHp);
    if (delta < 0) {
      run.stats.hpLost += before - run.hp;
      lines.push(`失去 ${before - run.hp} 点生命（${before} → ${run.hp}）`);
    } else {
      lines.push(`回复 ${run.hp - before} 点生命（${before} → ${run.hp}）`);
    }
    if (run.hp <= 0) { run.result = "lose"; run.queue = []; }
  }

  function say(run, text) { (run.screen.notes = run.screen.notes || []).push(text); }
  function note(run, text) { say(run, text); track(run, "note", text); }

  /* ---------- 待处理的事（选牌、删牌、升级、选卡槽） ---------- */
  function autoSteps(run) {
    while (run.queue.length) {
      const s = run.queue[0];
      if (s.kind === "gain") {
        run.queue.shift();
        const cards = rollCards(rngFor(run, "gain"), s.count, run.cfg.rarePct, false);
        cards.forEach(c => addCard(run, c));
        note(run, `随机获得了${cards.map(c => `「${cardName(c)}」`).join("")}`);
      } else if (s.kind === "newMap") {
        run.queue.shift();
        regenerate(run);
      } else if (s.kind === "areaEnd") {
        run.queue.shift();
        areaEnd(run);
      } else if ((s.kind === "remove" || s.kind === "upgrade") && !run.deck.some(c => s.kind === "remove" || canUpgrade(c))) {
        run.queue.shift();
        note(run, s.kind === "remove" ? "卡组是空的，没有牌可删" : "没有能升级的牌");
      } else break;
    }
  }

  function currentStep(run) { autoSteps(run); return run.queue[0] || null; }

  function canUpgrade(c) { return !c.up && !!D.CARDS[c.id].cost; }

  function resolveStep(run, payload) {
    const s = currentStep(run);
    if (!s) return no("没有要处理的事");
    const p = payload || {};
    if (s.kind === "cards") {
      /* 卡牌奖励单独记一条：给了哪几张、拿了哪张，汇总时算每张牌的选取率。 */
      const offered = s.options.map(cardName);
      if (p.skip) {
        run.queue.shift();
        say(run, "跳过了这组卡牌奖励");
        track(run, "cards", `卡牌奖励（${offered.join("、")}）：跳过`, { offered, picked: null });
      } else {
        const opt = s.options[p.index];
        if (!opt) return no("没有这个选项");
        const how = addCard(run, opt);
        run.queue.shift();
        say(run, how === "replaced" ? "寒霜之触替换了卡组里的冰霜之触" : `「${cardName(opt)}」加入了卡组`);
        track(run, "cards", `卡牌奖励（${offered.join("、")}）：拿了「${cardName(opt)}」`, { offered, picked: cardName(opt) });
      }
    } else if (s.kind === "remove") {
      const card = run.deck[p.index];
      if (!card) return no("没有这张牌");
      run.deck.splice(p.index, 1);
      run.stats.cardsRemoved++;
      note(run, `删去了「${cardName(card)}」`);
      s.count--;
      if (s.count <= 0) run.queue.shift();
    } else if (s.kind === "upgrade") {
      const card = run.deck[p.index];
      if (!card || !canUpgrade(card)) return no("这张牌不能升级");
      card.up = true;
      run.queue.shift();
      note(run, `「${D.CARDS[card.id].name}」升级成了「${cardName(card)}」`);
    } else if (s.kind === "wax") {
      if (!(p.index >= 0 && p.index < 5)) return no("没有这个卡槽");
      run.waxSlot = p.index;
      run.queue.shift();
      note(run, `第 ${p.index + 1} 槽变成了蜂蜡卡槽`);
    }
    autoSteps(run);
    return ok;
  }

  function cancelStep(run) {
    const s = currentStep(run);
    if (!s || !s.cancel) return no("这一步不能取消");
    run.queue.shift();
    if (run.screen.kind === "rest") run.screen.done = null;
    return ok;
  }

  function leave(run) {
    if (currentStep(run)) return no("还有没处理完的事");
    if (run.screen.kind === "event" && run.screen.choice == null && !run.result) return no("先做一个选择");
    run.screen = run.result ? { kind: "end" } : { kind: "map" };
    return ok;
  }

  /* ---------- 奇遇 ---------- */
  function pickEvent(run) {
    const avail = D.EVENTS.filter(e => !run.usedEvents.includes(e.id) && !(e.id === "boy" && run.relics.netsuke));
    if (!avail.length) return null;
    const ev = rngFor(run, "event").pick(avail);
    run.usedEvents.push(ev.id);
    return ev.id;
  }

  function chooseEvent(run, index) {
    const sc = run.screen;
    if (sc.kind !== "event" || sc.choice != null) return no("现在不能选");
    const ev = D.EVENTS.find(e => e.id === sc.event);
    const opt = ev.options[index];
    if (!opt) return no("没有这个选项");
    const rng = rngFor(run, "eventroll");
    const k = Math.floor(rng.next() * opt.outcomes.length);
    const outcome = opt.outcomes[k];
    sc.choice = index;
    sc.outcome = k;
    sc.note = outcome.note || "";
    const lines = [];
    for (const fx of outcome.fx) applyFx(run, fx, lines);
    if (!outcome.fx.length) lines.push("无事发生");
    sc.lines = lines;
    track(run, "event", `奇遇「${ev.name}」：选了「${opt.label}」`, { event: ev.id, choice: index, outcome: k, lines });
    autoSteps(run);
    return ok;
  }

  function eventSource(run) {
    const ev = run.screen.kind === "event" ? D.EVENTS.find(e => e.id === run.screen.event) : null;
    return ev ? `第 ${run.floor} 层奇遇「${ev.name}」` : `第 ${run.floor} 层`;
  }

  function applyFx(run, fx, lines) {
    if (fx.hp) changeHp(run, fx.hp, lines);
    if (run.result) return;
    if (fx.remove) {
      const n = Math.min(fx.remove, run.deck.length);
      if (n) run.queue.push({ kind: "remove", count: n, title: `选 ${n} 张牌删掉` });
    }
    if (fx.gain) run.queue.push({ kind: "gain", count: fx.gain });
    if (fx.curse) {
      for (let k = 0; k < fx.curse; k++) addCard(run, { id: "larva", up: false });
      lines.push(`获得 ${fx.curse} 张诅咒「颤蚓幼虫」`);
    }
    if (fx.relic) {
      const id = fx.relic === "random" ? randomRelic(run) : fx.relic;
      if (id && !run.relics[id]) gainRelic(run, id, lines, eventSource(run));
      else lines.push("没有能拿的奇物了");
    }
    if (fx.strength) {
      run.nextStrength += fx.strength;
      lines.push(`下一场战斗开始时，所有敌人获得 ${fx.strength} 点力量`);
    }
    if (fx.newMap) run.queue.push({ kind: "newMap" });
  }

  /* 「前往一个新的停车场」：重新生成这一区域剩下的地图，从新地图的起点继续。 */
  function regenerate(run) {
    const from = run.floor + 1;
    if (from >= run.cfg.floors - 1) { note(run, "已经快到顶了，电梯没有去别的停车场"); return; }
    run.mapGen++;
    const below = run.map.rows.filter(r => r.floor < from);
    const fresh = generateMap(run.seed, run.cfg, String(run.mapGen), from, below);
    run.map.rows = below.concat(fresh.rows);
    note(run, `电梯门开了，外面是另一个停车场：第 ${from} 层以上还没走到的层都重新随机了（宝箱、阳台、Boss 不变），回地图看看`);
  }

  /* ---------- 商店 ---------- */
  function makeShop(run) {
    const rng = rngFor(run, "shop");
    const cards = rollCards(rng, run.cfg.shopCards, run.cfg.rarePct, false).map(c => Object.assign(c, { price: run.cfg.cardPrice, sold: false }));
    const pool = D.RELIC_POOL.filter(id => !run.relics[id]);
    const relics = rng.shuffle(pool).slice(0, run.cfg.shopRelics).map(id => ({ id, price: D.RELICS[id].price, sold: false }));
    return { cards, relics, removeUsed: false };
  }

  function removalPrice(run) { return Math.pow(2, run.removals + 1); }

  function pay(run, price) {
    if (run.gold < price) return false;
    run.gold -= price;
    run.stats.goldSpent += price;
    return true;
  }

  function buyCard(run, i) {
    const it = run.screen.kind === "shop" && run.screen.shop.cards[i];
    if (!it || it.sold) return no("这张牌已经卖掉了");
    if (currentStep(run)) return no("先把手头的事处理完");
    if (!pay(run, it.price)) return no("金币不够");
    it.sold = true;
    const how = addCard(run, it);
    note(run, how === "replaced" ? "寒霜之触替换了卡组里的冰霜之触" : `买下了「${cardName(it)}」`);
    return ok;
  }

  function buyRelic(run, i) {
    const it = run.screen.kind === "shop" && run.screen.shop.relics[i];
    if (!it || it.sold) return no("这个奇物已经卖掉了");
    if (run.relics[it.id]) return no("你已经有这个奇物了");
    if (currentStep(run)) return no("先把手头的事处理完");
    if (!pay(run, it.price)) return no("金币不够");
    it.sold = true;
    const lines = [];
    gainRelic(run, it.id, lines, `第 ${run.floor} 层商店（${it.price} 金币）`);
    note(run, `买下了${lines.join("，")}`);
    autoSteps(run);
    return ok;
  }

  function buyRemoval(run) {
    const sh = run.screen.kind === "shop" && run.screen.shop;
    if (!sh) return no("这里不是商店");
    if (sh.removeUsed) return no("这个商店已经删过一次牌了");
    if (!run.deck.length) return no("卡组是空的");
    if (currentStep(run)) return no("先把手头的事处理完");
    const price = removalPrice(run);
    if (!pay(run, price)) return no("金币不够");
    run.removals++;
    sh.removeUsed = true;
    run.queue.push({ kind: "remove", count: 1, title: `花 ${price} 金币删一张牌：选要删的牌` });
    return ok;
  }

  /* ---------- 阳台、宝箱 ---------- */
  function restHeal(run) {
    const sc = run.screen;
    if (sc.kind !== "rest" || sc.done) return no("已经休息过了");
    const lines = [];
    changeHp(run, run.cfg.restHeal, lines);
    sc.done = "heal";
    lines.forEach(l => note(run, l));
    return ok;
  }

  function restUpgrade(run) {
    const sc = run.screen;
    if (sc.kind !== "rest" || sc.done) return no("已经休息过了");
    if (!run.deck.some(canUpgrade)) return no("没有能升级的牌");
    sc.done = "upgrade";
    run.queue.push({ kind: "upgrade", title: "选一张牌升级", cancel: true });
    return ok;
  }

  function openTreasure(run) {
    const sc = run.screen;
    if (sc.kind !== "treasure" || sc.opened) return no("宝箱已经打开了");
    sc.opened = true;
    const lines = [];
    const id = randomRelic(run);
    if (id) gainRelic(run, id, lines, `第 ${run.floor} 层宝箱`); // 拿到奇物已经记过一条
    else { addGold(run, 3, lines); track(run, "treasure", `宝箱：奇物拿光了，${lines.join("，")}`); }
    sc.lines = lines;
    autoSteps(run);
    return ok;
  }

  /* 打完 Boss：一整层都没有卡槽被打爆，就拿到逐梦者之戒。目前只有第一区域，所以这一局就赢了。 */
  function areaEnd(run) {
    if (!run.areaSlotLost) {
      const lines = [];
      gainRelic(run, "ring", lines, "打完 Boss 时，这一层没有卡槽被打爆");
      note(run, `这一层没有卡槽被打爆，获得了${lines.join("")}`);
    }
    run.result = "win";
  }

  /* ---------- 调试 ---------- */
  function debugGold(run, n) { run.gold += n; }
  function debugHeal(run) { run.hp = run.maxHp; }
  function debugBoss(run) {
    if (run.result || run.screen.kind !== "map") return no("先回到地图");
    enterNode(run, "boss");
    return ok;
  }

  QW.run = {
    OPTIONS, quota, generateMap, createRun, available, go, enterNode, getNode, combatOptions, finishCombat, makeShop, gainRelic,
    currentStep, resolveStep, cancelStep, leave, chooseEvent, buyCard, buyRelic, buyRemoval, removalPrice,
    restHeal, restUpgrade, openTreasure, canUpgrade, rollCards, debugGold, debugHeal, debugBoss
  };
})(typeof window !== "undefined" ? window : globalThis);
