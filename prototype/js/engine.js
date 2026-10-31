/* 战斗引擎：只管规则和数字，不碰页面。规则说明见 design/rules.md。 */
(function (root) {
  "use strict";
  const QW = root.QW || (root.QW = {});
  const D = QW.data;
  const LANES = 5;
  const alive = e => !e.dead && !e.fled;
  const ok = { ok: true };
  const no = reason => ({ ok: false, reason });

  class Combat {
    constructor(opts = {}) {
      const cfg = Object.assign({}, D.CONFIG, opts.config || {});
      this.cfg = cfg;
      this.seed = opts.seed == null ? 1 : opts.seed;
      this.rng = QW.rng.create(this.seed);
      this.god = Object.assign({ lockHp: false, infiniteEnergy: false }, opts.god || {});
      this.relics = Object.assign({}, opts.relics || {});
      this.waxSlot = opts.waxSlot == null ? 2 : opts.waxSlot;
      const ov = opts.overrides || {};
      this.ov = { enemies: ov.enemies || {}, cards: ov.cards || {} };
      this.deckSpec = (opts.deck || D.STARTER_DECK).map(x => typeof x === "string" ? { id: x, up: false } : x);
      this.encounter = opts.encounter || D.PRESETS[0].enc;

      this.logs = [];
      this.turn = 0;
      this.phase = "setup";
      this.result = null;
      this.uid = 1;
      this.player = { hp: Math.min(cfg.startHp, cfg.playerHp), maxHp: cfg.playerHp, energy: 0, maxEnergy: cfg.energy, shield: 0 };
      this.slots = Array.from({ length: LANES }, (_, i) => ({
        i, hp: cfg.slotHp, maxHp: cfg.slotHp, destroyed: false, kind: "normal", baseKind: "normal",
        armor: 0, alibi: false, played: null, occ: null
      }));
      this.drawPile = [];
      this.hand = [];
      this.discardPile = [];
      this.exhaustPile = [];
      this.revealed = [];
      this.enemies = [];
      this.boss = null;
      this.mirror = null;
      this.flags = { attackPlayed: false, illusionPlayed: false, lastPlayed: null };
      this.factions = new Set();
      this.watchCount = 0;
      this.freeNext = false;
      // 完整一局里，老旧的根付失效、逐梦者之戒剩多少护甲，都会带到下一场
      this.netsukeUsed = !!opts.netsukeUsed;
      this.ring = this.relics.ring ? (opts.ringArmor != null ? opts.ringArmor : D.RELICS.ring.armor) : 0;
      this.pending = null;
      this.larvaQueue = [];
      this.removedForever = [];
      this.stats = { cardsPlayed: 0, damageDealt: 0, hpLost: 0, slotsLost: 0 };
    }

    /* ---------- 记录 ---------- */
    log(text, kind) { this.logs.push({ turn: this.turn, text, kind: kind || "info" }); }

    /* ---------- 卡牌 ---------- */
    makeCard(id, up) { return { uid: this.uid++, id, up: !!up, costMod: 0 }; }
    def(c) { return D.CARDS[c.id]; }
    params(c) {
      const d = this.def(c);
      const over = this.ov.cards[c.id] || {};
      const out = {};
      for (const k of Object.keys(d.params || {})) out[k] = (over[k] || d.params[k])[c.up ? 1 : 0];
      return out;
    }
    cardName(c) { return this.def(c).name + (c.up ? "+" : ""); }
    cardText(c) { return this.def(c).text(this.params(c), c.up); }
    targetType(c) { const t = this.def(c).target; return Array.isArray(t) ? t[c.up ? 1 : 0] : t; }
    isInnate(c) { const n = this.def(c).innate; return Array.isArray(n) ? n[c.up ? 1 : 0] : !!n; }
    baseCost(c) {
      const d = this.def(c);
      if (!d.cost) return null;
      const pair = (this.ov.cards[c.id] || {}).cost || d.cost;
      return pair[c.up ? 1 : 0];
    }
    cost(c) {
      const b = this.baseCost(c);
      if (b == null) return null;
      if (this.freeNext) return 0;
      if (c.id === "clairvoyance" && this.flags.illusionPlayed) return 0;
      return Math.max(0, b - (c.costMod || 0));
    }

    /* ---------- 开始 ---------- */
    start() {
      this.log(`战斗开始，种子 ${this.seed}`, "phase");
      const cards = this.rng.shuffle(this.deckSpec.map(x => this.makeCard(x.id, x.up)));
      const innate = cards.filter(c => this.isInnate(c));
      this.drawPile = cards.filter(c => !this.isInnate(c)).concat(innate);
      if (this.relics.beeswax) {
        const s = this.slots[this.waxSlot];
        s.kind = s.baseKind = "wax";
        this.log(`芳香蜂蜡：第 ${s.i + 1} 槽是蜂蜡卡槽`, "relic");
      }
      const enc = this.encounter;
      if (enc.kind === "phantom") this.spawnBoss();
      else if (enc.kind === "mirror") this.spawnMirror();
      else this.spawnLanes(enc.lanes);
      if (this.relics.yukiOnna) {
        this.log("《雪女》：所有敌人寒冷 +1", "relic");
        for (const t of this.allTargets()) this.addCold(t, 1);
      }
      this.startTurn(true);
      return this;
    }

    spawn(id, lane, atStart) {
      const base = D.ENEMIES[id];
      const over = this.ov.enemies[id] || {};
      const hp = over.hp != null ? over.hp : base.hp;
      const e = {
        uid: this.uid++, id, name: base.name, tier: base.tier,
        atk: over.atk != null ? over.atk : base.atk, hp, maxHp: hp, lane,
        str: atStart ? (this.cfg.enemyStrength || 0) : 0, tempStr: 0, cold: 0, cycle: 0,
        pState: "scream", asleep: false, fled: false, dead: false, intent: null
      };
      this.enemies.push(e);
      return e;
    }

    spawnLanes(lanes) {
      const echoes = [];
      lanes.forEach((id, lane) => {
        if (!id) return;
        if (id === "echo") echoes.push(lane); else this.spawn(id, lane, true);
      });
      for (const wanted of echoes) {
        const cand = [0, 1, 2, 3, 4].filter(l => !this.enemyAt(l));
        if (!cand.length) { this.spawn("echo", wanted, true); continue; }
        const roll = this.rng.d20();
        const idx = roll % cand.length;
        this.spawn("echo", cand[idx], true);
        this.log(`回声掷 D20 = ${roll}，空着的列有 ${cand.length} 个，${roll} mod ${cand.length} = ${idx}，站到第 ${cand[idx] + 1} 列`, "dice");
      }
    }

    spawnBoss() {
      const base = D.ENEMIES.phantom;
      const over = this.ov.enemies.phantom || {};
      const slotHp = over.slotHp != null ? over.slotHp : base.slotHp;
      const hp = over.hp != null ? over.hp : base.hp;
      const deck = [];
      for (let k = 0; k < 6; k++) deck.push("dust");
      for (let k = 0; k < 5; k++) deck.push("block");
      this.boss = {
        name: base.name, atk: over.atk != null ? over.atk : base.atk, str: this.cfg.enemyStrength || 0,
        body: { hp, maxHp: hp, cold: 0 }, dead: false,
        slots: Array.from({ length: LANES }, (_, i) => ({ i, hp: slotHp, maxHp: slotHp, armor: 0, cold: 0, destroyed: false, intent: null })),
        draw: this.rng.shuffle(deck), discard: []
      };
    }

    spawnMirror() {
      const base = D.ENEMIES.mirror;
      const over = this.ov.enemies.mirror || {};
      const mhp = over.mirrorHp != null ? over.mirrorHp : base.mirrorHp;
      this.mirror = {
        name: base.name, atk: over.atk != null ? over.atk : base.atk, str: this.cfg.enemyStrength || 0, pos: null,
        mirrors: Array.from({ length: LANES }, (_, i) => ({ i, hp: mhp, maxHp: mhp, cold: 0, broken: false }))
      };
    }

    /* ---------- 回合 ---------- */
    startTurn(first) {
      this.turn++;
      this.phase = "player";
      this.log(`第 ${this.turn} 回合`, "phase");
      for (const s of this.slots) if (!s.destroyed && s.kind === "ice") this.meltIce(s);
      for (const s of this.slots) s.armor = 0;
      this.player.shield = 0;
      this.player.energy = this.player.maxEnergy;
      if (!first) this.tickCold();
      this.flags = { attackPlayed: false, illusionPlayed: false, lastPlayed: null };
      this.revealed = [];
      this.startPowers();
      if (this.checkEnd()) return;
      this.planIntents();
      this.drawCards(this.cfg.draw);
      this.checkEnd();
    }

    endTurn() {
      if (this.phase !== "player") return no("现在不是你的回合");
      if (this.pending) return no("先把颤蚓幼虫放进卡槽");
      this.log("回合结束", "phase");
      this.endOfTurnEffects();
      if (this.checkEnd()) return ok;
      const slips = this.hand.filter(c => c.id === "slip").length;
      for (let k = 0; k < slips; k++) this.shiftArmorRight();
      for (const c of this.hand) {
        if (c.id !== "goldHammer") continue;
        const before = this.cost(c);
        c.costMod++;
        this.log(`黄金锤留在手里，费用 ${before} → ${this.cost(c)}`);
      }
      const keep = [];
      for (const c of this.hand) (this.def(c).retain ? keep : this.discardPile).push(c);
      this.hand = keep;
      for (const s of this.slots) {
        if (s.played) {
          (this.def(s.played).exhaust ? this.exhaustPile : this.discardPile).push(s.played);
          s.played = null;
        }
        if (s.occ && s.occ.kind === "doom") { this.discardPile.push(s.occ.card); s.occ = null; }
        if (s.occ && s.occ.kind === "sludge") { s.occ = null; this.log(`第 ${s.i + 1} 槽的淤泥清走了`); }
      }
      this.revealed = [];
      this.phase = "enemy";
      this.enemyPhase();
      if (this.result) return ok;
      this.startTurn(false);
      return ok;
    }

    tickCold() {
      for (const e of this.enemies) if (alive(e) && e.cold > 0) e.cold--;
      if (this.boss) {
        if (this.boss.body.cold > 0) this.boss.body.cold--;
        for (const s of this.boss.slots) if (s.cold > 0) s.cold--;
      }
      if (this.mirror) for (const m of this.mirror.mirrors) if (m.cold > 0) m.cold--;
    }

    meltIce(s) {
      this.log(`第 ${s.i + 1} 槽的冰化了，变回被打爆的状态`);
      this.clearOccupant(s, false);
      s.destroyed = true;
      s.kind = s.baseKind;
      s.hp = 0;
      s.maxHp = this.cfg.slotHp;
    }

    startPowers() {
      for (const s of this.slots) {
        if (!s.occ || s.occ.kind !== "card") continue;
        const c = s.occ.card;
        if (c.id === "ignite") {
          if (!this.drawPile.length) this.reshuffle();
          const top = this.drawPile.pop();
          if (top) {
            this.exhaustPile.push(top);
            this.log(`点燃！：消耗了牌库顶的「${this.cardName(top)}」`, "power");
          }
          const p = this.params(c);
          for (const t of this.allTargets()) this.hit(t, p.dmg, "点燃！");
        } else if (c.id === "otherGate") {
          this.summonPawn(null);
        }
      }
    }

    endOfTurnEffects() {
      for (const s of this.slots) {
        if (s.occ && s.occ.kind === "card" && s.occ.card.id === "chaosForm") this.chaosCopy(s);
      }
      for (const s of this.slots) {
        if (!s.occ || s.occ.kind !== "card" || s.occ.card.id !== "shadowForm") continue;
        const c = s.occ.card;
        const p = this.params(c);
        s.armor += p.block;
        s.occ.turnsLeft--;
        this.log(`暗影塑形：第 ${s.i + 1} 槽护甲 +${p.block}（现在 ${s.armor}，还剩 ${s.occ.turnsLeft} 回合）`);
        if (s.occ.turnsLeft <= 0) {
          this.discardPile.push(c);
          s.occ = null;
          this.log("暗影塑形结束，进了弃牌堆");
        }
      }
      for (const s of this.slots) {
        if (!s.occ || s.occ.kind !== "pawn" || s.destroyed) continue;
        const t = this.targetAt(s.i);
        if (t) this.hit(t, s.occ.atk, `第 ${s.i + 1} 槽的影卒`);
      }
    }

    chaosCopy(s) {
      const last = this.flags.lastPlayed;
      if (!last) { this.log("混沌之型：这回合没有打出过牌"); return; }
      const d = this.def(last);
      const name = this.cardName(last);
      if (d.persist) { this.log(`混沌之型：「${name}」是持续型的牌，不复制`); return; }
      const tt = this.targetType(last);
      if (tt === "destroyed") { this.log(`混沌之型：「${name}」只能放进被打爆的卡槽，复制不了`); return; }
      if (tt === "opposite" && !this.targetAt(s.i)) { this.log(`混沌之型：第 ${s.i + 1} 槽对面没有敌人，「${name}」落空`); return; }
      this.log(`混沌之型：在第 ${s.i + 1} 槽免费再结算一次「${name}」`, "power");
      this.resolve(last, s.i, true);
    }

    shiftArmorRight() {
      const before = this.slots.map(s => s.armor);
      this.slots.forEach((s, i) => { s.armor = before[(i + LANES - 1) % LANES]; });
      this.log(`打滑：护甲向右移 1 格（${before.join(" / ")} → ${this.slots.map(s => s.armor).join(" / ")}）`, "status");
    }

    /* ---------- 抽牌 ---------- */
    reshuffle() {
      if (!this.discardPile.length) return false;
      const cards = this.rng.shuffle(this.discardPile);
      this.discardPile = [];
      this.drawPile = cards.concat(this.drawPile);
      this.log(`弃牌堆洗回抽牌堆（${cards.length} 张）`, "deck");
      return true;
    }

    drawCards(n) {
      let drawn = 0;
      for (let k = 0; k < n; k++) {
        if (this.hand.length >= this.cfg.handLimit) { this.log(`手牌满了（${this.cfg.handLimit} 张），不再抽牌`); break; }
        if (!this.drawPile.length && !this.reshuffle()) break;
        const c = this.drawPile.pop();
        this.revealed = this.revealed.filter(u => u !== c.uid);
        drawn++;
        if (c.id === "larva") { this.larvaQueue.push(c); this.log("抽到颤蚓幼虫：选一个空卡槽把它放进去", "status"); }
        else if (c.id === "doom") this.placeDoom(c);
        else this.hand.push(c);
      }
      this.nextLarva();
      return drawn;
    }

    freeIntactSlots() { return this.slots.filter(s => !s.destroyed && !s.occ && !s.played); }

    nextLarva() {
      if (this.pending) return;
      while (this.larvaQueue.length) {
        if (this.freeIntactSlots().length) { this.pending = { type: "larva", card: this.larvaQueue[0] }; return; }
        this.discardPile.push(this.larvaQueue.shift());
        this.log("没有空卡槽，颤蚓幼虫进了弃牌堆");
      }
    }

    placeLarva(lane) {
      if (!this.pending || this.pending.type !== "larva") return no("现在不用放颤蚓幼虫");
      const s = this.slots[lane];
      if (s.destroyed || s.occ || s.played) return no("只能放进空着的完好卡槽");
      s.occ = { kind: "larva", card: this.pending.card };
      this.larvaQueue.shift();
      this.pending = null;
      this.log(`颤蚓幼虫占住了第 ${lane + 1} 槽`, "status");
      this.nextLarva();
      return ok;
    }

    placeDoom(c) {
      let s = this.mirror && this.mirror.pos != null ? this.slots[this.mirror.pos] : null;
      if (!s || s.destroyed || s.occ || s.played) {
        const free = this.freeIntactSlots();
        s = free.length ? this.rng.pick(free) : null;
      }
      if (!s) { this.discardPile.push(c); this.log("抽到厄运，但没有空卡槽，它进了弃牌堆", "status"); return; }
      s.occ = { kind: "doom", card: c };
      this.log(`抽到厄运：它占住了第 ${s.i + 1} 槽`, "status");
    }

    reveal(n) {
      if (this.drawPile.length < n) this.reshuffle();
      const top = this.drawPile.slice(-n).reverse();
      this.revealed = top.map(c => c.uid);
      this.log(top.length
        ? `灵视展示：${top.map(c => `「${this.cardName(c)}」`).join("")}，本回合可以直接打出`
        : "灵视：牌库是空的", "power");
    }

    /* ---------- 出牌 ---------- */
    locate(uid) {
      const i = this.hand.findIndex(c => c.uid === uid);
      if (i >= 0) return { where: "hand", card: this.hand[i], index: i };
      if (this.revealed.includes(uid)) {
        const j = this.drawPile.findIndex(c => c.uid === uid);
        if (j >= 0) return { where: "revealed", card: this.drawPile[j], index: j };
      }
      return null;
    }

    isLocked(c) {
      if (!this.enemies.some(e => alive(e) && e.id === "redeye")) return false;
      const last = this.hand[this.hand.length - 1];
      return !!last && last.uid === c.uid;
    }

    slotReason(s) {
      if (s.destroyed) return s.played ? "这个卡槽本回合已经放过牌" : "这个卡槽被打爆了，这张牌放不进去";
      if (s.played) return "这个卡槽本回合已经放过牌";
      if (s.occ) return `这个卡槽被${this.occName(s.occ)}占着`;
      return "";
    }

    /* 普通的牌能不能放进被打爆的卡槽，看 cfg.brokenSlotCards（待确认，见 data.js）。 */
    brokenSlotAllows(c) {
      const rule = this.cfg.brokenSlotCards;
      if (rule === "all") return true;
      if (rule === "noDefense") { const t = this.def(c).type; return t === "攻击" || t === "技能"; }
      return false;
    }

    laneCheck(c, lane) {
      const s = this.slots[lane];
      const brokenFree = s.destroyed && !s.played && !s.occ;
      const intactFree = (!s.destroyed && !s.played && !s.occ) || (brokenFree && this.brokenSlotAllows(c));
      const tt = this.targetType(c);
      if (tt === "slot") return intactFree ? ok : no(this.slotReason(s));
      if (tt === "opposite") {
        if (!intactFree) return no(this.slotReason(s));
        const t = this.targetAt(lane);
        if (!t) return no("正对面没有敌人");
        if (c.id === "polymorph" && (t.kind !== "enemy" || t.ref.tier === "精英" || t.ref.tier === "BOSS")) return no("只能变形普通敌人");
        return ok;
      }
      if (tt === "destroyed") return brokenFree ? ok : no(s.destroyed ? "这个卡槽本回合已经放过牌" : "只能放进被打爆的卡槽");
      if (tt === "flashFreeze") {
        if (brokenFree) return ok;
        if (!intactFree) return no(this.slotReason(s));
        return this.targetAt(lane) ? ok : no("正对面没有敌人");
      }
      if (tt === "any") return intactFree || brokenFree ? ok : no(this.slotReason(s));
      return no("这张牌放不进卡槽");
    }

    canPlay(uid, lane) {
      if (this.phase !== "player") return no("现在不是你的回合");
      if (this.pending) return no("先把颤蚓幼虫放进卡槽");
      const loc = this.locate(uid);
      if (!loc) return no("找不到这张牌");
      const c = loc.card;
      if (this.def(c).unplayable) return no("这张牌无法打出");
      if (loc.where === "hand" && this.isLocked(c)) return no("红视-2000 封住了手牌最右边的牌");
      if (!this.god.infiniteEnergy && this.cost(c) > this.player.energy) return no("费用不够");
      if (lane == null) return ok;
      return this.laneCheck(c, lane);
    }

    validLanes(uid) { return [0, 1, 2, 3, 4].filter(l => this.canPlay(uid, l).ok); }

    play(uid, lane) {
      const check = this.canPlay(uid, lane);
      if (!check.ok) return check;
      const loc = this.locate(uid);
      const c = loc.card;
      const d = this.def(c);
      const cost = this.cost(c);
      const usedFree = this.freeNext;
      if (!this.god.infiniteEnergy) this.player.energy -= cost;
      this.freeNext = false;
      if (loc.where === "hand") this.hand.splice(loc.index, 1);
      else { this.drawPile.splice(loc.index, 1); this.revealed = this.revealed.filter(u => u !== uid); }
      const s = this.slots[lane];
      if (d.persist) s.occ = { kind: "card", card: c, turnsLeft: d.persist };
      else s.played = c;
      this.stats.cardsPlayed++;
      this.log(`打出「${this.cardName(c)}」（${cost} 费${usedFree ? "，时侠腕表免费" : ""}）→ 第 ${lane + 1} 槽`, "play");
      if (d.type === "攻击") this.flags.attackPlayed = true;
      if (d.faction === "幻术") this.flags.illusionPlayed = true;
      this.flags.lastPlayed = c;
      this.resolve(c, lane, false);
      if (d.faction) this.factions.add(d.faction);
      this.checkPoetry();
      if (this.relics.watch) {
        this.watchCount++;
        if (this.watchCount >= 3) {
          this.watchCount = 0;
          this.freeNext = true;
          this.log("时侠腕表：下一张牌 0 费", "relic");
        }
      }
      this.checkEnd();
      return ok;
    }

    resolve(c, lane, isCopy) {
      const p = this.params(c);
      const s = this.slots[lane];
      const t = this.targetAt(lane);
      const name = `「${this.cardName(c)}」${isCopy ? "（复制）" : ""}`;
      switch (c.id) {
        case "strike": case "fireball": case "blaze":
          if (t) this.hit(t, p.dmg, name);
          break;
        case "shadowStrike":
          if (t) {
            const double = this.undamaged(t);
            if (double) this.log(`${this.tName(t)} 没受过伤，伤害翻倍`);
            this.hit(t, double ? p.dmg * 2 : p.dmg, name);
          }
          break;
        case "parry":
          s.armor += p.block;
          this.log(`第 ${lane + 1} 槽护甲 +${p.block}（现在 ${s.armor}）`);
          break;
        case "frostTouch":
          if (t) this.addCold(t, p.cold);
          if (p.draw) this.drawCards(p.draw);
          break;
        case "iceSpike":
          for (const x of this.allTargets()) {
            const dealt = this.hit(x, p.dmg, name);
            if (dealt > 0 && this.targetAlive(x)) this.addCold(x, p.cold);
          }
          break;
        case "firestorm":
          for (const x of this.allTargets()) this.hit(x, p.dmg, name);
          break;
        case "crossFire": {
          const list = c.up ? this.allTargets() : this.uniqueTargets([lane - 1, lane, lane + 1]);
          for (const x of list) this.hit(x, p.dmg, name);
          break;
        }
        case "iceWall":
          this.player.shield += p.block;
          this.log(`公共护盾 +${p.block}（现在 ${this.player.shield}）`);
          break;
        case "flashFreeze":
          if (s.destroyed) { s.armor += p.block; this.log(`被打爆的第 ${lane + 1} 槽放上 ${p.block} 点护甲`); }
          else if (t) this.addCold(t, p.cold);
          break;
        case "alibi":
          s.alibi = true;
          this.log(`第 ${lane + 1} 槽会无视下一次伤害`);
          break;
        case "clairvoyance":
          this.reveal(p.reveal);
          break;
        case "elixir":
          this.loseHp(p.lose, "诡药");
          s.destroyed = false;
          s.kind = "shadow";
          s.maxHp = D.SHADOW_SLOT_HP;
          s.hp = s.maxHp;
          this.log(`第 ${lane + 1} 槽变成暗影卡槽（${s.hp} 血，被打爆不扣血）`);
          break;
        case "snowBurial": {
          const list = c.up ? this.allTargets() : (t ? [t] : []);
          let hitAny = false;
          for (const x of list) {
            if (!this.targetAlive(x) || this.coldOf(x) <= this.hpOf(x)) continue;
            hitAny = true;
            this.log(`雪葬：${this.tName(x)} 寒冷 ${this.coldOf(x)} 高于生命 ${this.hpOf(x)}，被消灭`);
            this.annihilate(x);
          }
          if (!hitAny) this.log("雪葬：没有寒冷层数高于生命的目标");
          break;
        }
        case "coldField": {
          let n = 0;
          for (const x of this.slots) {
            if (!x.destroyed) continue;
            x.destroyed = false;
            x.kind = "ice";
            x.maxHp = this.cfg.slotHp;
            x.hp = x.maxHp;
            n++;
          }
          this.log(n ? `冷场：${n} 个被打爆的卡槽变成冰制卡槽` : "冷场：没有被打爆的卡槽");
          break;
        }
        case "visitor":
          this.summonPawn(isCopy ? null : lane);
          if (p.pawns > 1) this.summonPawn(null);
          break;
        case "frostbite": {
          for (const x of this.allTargets()) {
            this.hit(x, p.dmg, name);
            if (this.targetAlive(x)) this.addCold(x, p.cold);
          }
          this.drawCards(p.draw);
          break;
        }
        case "polymorph":
          if (t && t.kind === "enemy") this.polymorph(t.ref);
          break;
        case "goldHammer":
          if (s.destroyed) { this.repair(s); this.log(`黄金锤修好了第 ${lane + 1} 槽（${s.hp} 血），打爆时扣的血不返还`); }
          break;
        case "ignite": case "chaosForm": case "otherGate": case "poetry":
          this.log(`${name}占住了第 ${lane + 1} 槽`, "power");
          break;
        default:
          break;
      }
    }

    checkPoetry() {
      const poets = this.slots.filter(s => s.occ && s.occ.kind === "card" && s.occ.card.id === "poetry");
      if (!poets.length || !D.FACTIONS.every(f => this.factions.has(f))) return;
      this.factions.clear();
      for (const s of poets) {
        const p = this.params(s.occ.card);
        this.player.energy += p.energy;
        this.log(`流觞诗会：四个派系都打出过了，获得 ${p.energy} 费、抽 ${p.draw} 张`, "power");
        this.drawCards(p.draw);
      }
    }

    summonPawn(lane) {
      let s = lane != null ? this.slots[lane] : null;
      if (!s || s.destroyed || s.occ) {
        const free = this.freeIntactSlots();
        s = free.length ? this.rng.pick(free) : null;
      }
      if (!s) { this.log("没有空卡槽，影卒召唤失败"); return; }
      s.occ = { kind: "pawn", hp: D.PAWN.hp, maxHp: D.PAWN.hp, atk: D.PAWN.atk };
      this.log(`第 ${s.i + 1} 槽召唤了影卒（${D.PAWN.atk}/${D.PAWN.hp}）`, "power");
    }

    polymorph(e) {
      const old = e.name;
      Object.assign(e, {
        id: "sheep", name: D.ENEMIES.sheep.name, tier: D.ENEMIES.sheep.tier,
        atk: D.ENEMIES.sheep.atk, hp: D.ENEMIES.sheep.hp, maxHp: D.ENEMIES.sheep.hp,
        str: 0, tempStr: 0, cold: 0, cycle: 0, asleep: false
      });
      e.intent = { kind: "attack", lane: e.lane };
      this.log(`${old} 变成了 1/1 的绵羊`);
    }

    /* ---------- 敌方目标 ---------- */
    enemyAt(lane) { return this.enemies.find(e => alive(e) && e.lane === lane) || null; }

    targetAt(lane) {
      if (lane < 0 || lane >= LANES) return null;
      if (this.boss) {
        if (this.boss.dead) return null;
        const s = this.boss.slots[lane];
        return s.destroyed ? { kind: "body", ref: this.boss.body, lane } : { kind: "bslot", ref: s, lane };
      }
      if (this.mirror) {
        const m = this.mirror.mirrors[lane];
        return m.broken ? null : { kind: "mirror", ref: m, lane };
      }
      const e = this.enemyAt(lane);
      return e ? { kind: "enemy", ref: e, lane } : null;
    }

    allTargets() {
      if (this.boss) {
        if (this.boss.dead) return [];
        const list = this.boss.slots.filter(s => !s.destroyed).map(s => ({ kind: "bslot", ref: s, lane: s.i }));
        if (this.boss.slots.some(s => s.destroyed)) list.push({ kind: "body", ref: this.boss.body, lane: null });
        return list;
      }
      if (this.mirror) return this.mirror.mirrors.filter(m => !m.broken).map(m => ({ kind: "mirror", ref: m, lane: m.i }));
      return this.enemies.filter(alive).sort((a, b) => a.lane - b.lane).map(e => ({ kind: "enemy", ref: e, lane: e.lane }));
    }

    uniqueTargets(lanes) {
      const out = [];
      for (const l of lanes) {
        const t = this.targetAt(l);
        if (t && !out.some(x => x.ref === t.ref)) out.push(t);
      }
      return out;
    }

    tName(t) {
      if (t.kind === "enemy") return t.ref.name;
      if (t.kind === "bslot") return `魅影卡槽 ${t.ref.i + 1}`;
      if (t.kind === "body") return "血色魅影本体";
      return `第 ${t.ref.i + 1} 面镜子`;
    }
    targetAlive(t) {
      if (t.kind === "enemy") return alive(t.ref);
      if (t.kind === "bslot") return !t.ref.destroyed && !this.boss.dead;
      if (t.kind === "body") return !this.boss.dead;
      return !t.ref.broken;
    }
    hpOf(t) { return t.ref.hp; }
    coldOf(t) { return t.ref.cold; }
    undamaged(t) { return t.ref.hp >= t.ref.maxHp; }

    addCold(t, n) {
      if (!t || !this.targetAlive(t) || n <= 0) return;
      t.ref.cold += n;
      this.log(`${this.tName(t)} 寒冷 +${n}（现在 ${t.ref.cold}）`, "status");
    }

    hit(t, amount, src) {
      if (!t || amount <= 0 || !this.targetAlive(t)) return 0;
      const ref = t.ref;
      const before = ref.hp;
      let dealt = amount;
      let note = "";
      if (t.kind === "bslot" && ref.armor > 0) {
        const a = Math.min(ref.armor, amount);
        ref.armor -= a;
        dealt = amount - a;
        note = `，护甲挡 ${a}`;
      }
      ref.hp -= dealt;
      this.stats.damageDealt += dealt;
      this.log(`${src} → ${this.tName(t)}：${amount} 伤害${note}（${before} → ${Math.max(0, ref.hp)}）`, "dmg");
      if (ref.hp <= 0) this.annihilate(t);
      else if (t.kind === "enemy" && dealt > 0) this.onEnemyDamaged(ref);
      return dealt;
    }

    annihilate(t) {
      const ref = t.ref;
      if (t.kind === "enemy") {
        ref.hp = 0; ref.dead = true;
        this.log(`${ref.name} 被击败`, "kill");
      } else if (t.kind === "bslot") {
        this.destroyBossSlot(ref);
      } else if (t.kind === "body") {
        this.killBoss();
      } else {
        this.breakMirror(ref);
      }
      this.checkEnd();
    }

    onEnemyDamaged(e) {
      if (e.id === "polymer") {
        e.tempStr++;
        this.log(`金属聚物受伤，力量 +1（这次行动 +${e.tempStr}）`, "status");
      }
      if (e.id === "parasite" && e.intent && e.intent.kind !== "scream") {
        e.intent = { kind: "scream" };
        this.log("刺耳寄生物挨了打，意图变为尖叫", "status");
      }
      if (e.id === "sloth" && e.asleep) {
        e.asleep = false;
        this.log("怠惰幼兽醒了", "status");
        this.slothMove(e);
        e.intent = this.slothIntent(e);
      }
    }

    slothMove(e) {
      if (!this.slots[e.lane].destroyed) return;
      const cand = [0, 1, 2, 3, 4].filter(l => !this.slots[l].destroyed && !this.enemyAt(l));
      if (!cand.length) { this.log("怠惰幼兽没找到正对完好卡槽的空列，留在原地"); return; }
      const best = Math.min(...cand.map(l => Math.abs(l - e.lane)));
      const lane = this.rng.pick(cand.filter(l => Math.abs(l - e.lane) === best));
      e.lane = lane;
      this.log(`怠惰幼兽移到第 ${lane + 1} 列`);
    }

    slothIntent(e) {
      if (this.slots.every(s => s.destroyed)) return { kind: "flee" };
      if (e.asleep) return { kind: "sleep" };
      return { kind: "attack", lane: e.lane };
    }

    destroyBossSlot(s) {
      s.destroyed = true;
      s.hp = 0;
      s.armor = 0;
      if (s.intent) { this.boss.discard.push(s.intent); s.intent = null; }
      const b = this.boss.body;
      const before = b.hp;
      b.hp -= s.maxHp;
      this.log(`魅影卡槽 ${s.i + 1} 被打爆，本体掉 ${s.maxHp} 血（${before} → ${Math.max(0, b.hp)}）`, "kill");
      if (b.hp <= 0) this.killBoss();
    }

    killBoss() {
      if (this.boss.dead) return;
      this.boss.dead = true;
      this.boss.body.hp = 0;
      this.log("血色魅影被击败", "kill");
    }

    breakMirror(m) {
      m.broken = true;
      m.hp = 0;
      const doom = this.makeCard("doom");
      this.drawPile.splice(this.rng.int(0, this.drawPile.length), 0, doom);
      this.log(`第 ${m.i + 1} 面镜子碎了，1 张厄运混进了你的抽牌堆`, "kill");
      if (this.mirror.pos === m.i) {
        this.mirror.pos = null;
        this.log("镜中人被打出了镜子，这回合不攻击");
      }
    }

    /* ---------- 敌人意图 ---------- */
    planIntents() {
      for (const e of this.enemies) if (alive(e)) e.intent = this.planEnemy(e);
      if (this.mirror) this.planMirror();
      if (this.boss && !this.boss.dead) this.planBoss();
    }

    planEnemy(e) {
      switch (e.id) {
        case "slime": return e.cycle % 3 === 2 ? { kind: "heal", amount: 1 } : { kind: "attack", lane: e.lane };
        case "frog": return e.cycle % 2 === 0 ? { kind: "spew" } : { kind: "attack", lane: e.lane };
        case "tar": return { kind: "attack", lane: e.lane, slip: true };
        case "parasite": return { kind: e.pState === "scream" ? "scream" : "idle" };
        case "redeye": return { kind: "watch" };
        case "sloth": return this.slothIntent(e);
        case "echo": return e.cycle % 2 === 0 ? this.echoAttackIntent() : { kind: "howl" };
        default: return { kind: "attack", lane: e.lane };
      }
    }

    echoAttackIntent() {
      let cand = this.slots.filter(s => !s.destroyed).map(s => s.i);
      if (!cand.length) cand = [0, 1, 2, 3, 4];
      const roll = this.rng.d20();
      const idx = roll % cand.length;
      const lane = cand[idx];
      this.log(`回声掷 D20 = ${roll}，完好的卡槽有 ${cand.length} 个，${roll} mod ${cand.length} = ${idx}，瞄准第 ${lane + 1} 槽`, "dice");
      return { kind: "attack", lane, roll, n: cand.length, idx };
    }

    planMirror() {
      const intact = this.mirror.mirrors.filter(m => !m.broken);
      if (!intact.length) { this.mirror.pos = null; return; }
      this.mirror.pos = this.rng.pick(intact).i;
      this.log(`镜中人出现在第 ${this.mirror.pos + 1} 面镜子里`, "dice");
    }

    planBoss() {
      const b = this.boss;
      for (const s of b.slots) if (s.intent) { b.discard.push(s.intent); s.intent = null; }
      for (const s of b.slots) if (!s.destroyed) s.intent = this.bossDraw();
      const names = { attack: "攻击", block: "格挡3", dust: "尘埃" };
      this.log(`血色魅影的意图：${b.slots.map(s => s.destroyed ? "—" : names[s.intent]).join(" / ")}`, "boss");
    }

    bossDraw() {
      const b = this.boss;
      if (!b.draw.length) {
        b.draw = this.rng.shuffle(b.discard.concat(["attack", "attack", "dust", "dust"]));
        b.discard = [];
        this.log("血色魅影洗牌，又洗进了 2 张攻击、2 张尘埃", "boss");
      }
      return b.draw.pop();
    }

    atkOf(e) {
      const base = e.atk + e.str + e.tempStr;
      if (base <= 0) return 0;
      return e.cold > 0 ? Math.max(1, base - 1) : base;
    }

    atkDetail(atk, str, temp, cold) {
      let s = `基础 ${atk}`;
      if (str) s += ` + 力量 ${str}`;
      if (temp) s += ` + 临时力量 ${temp}`;
      if (cold > 0) s += " − 寒冷 1";
      return s;
    }

    intentOf(e) {
      const it = e.intent;
      if (!it) return null;
      switch (it.kind) {
        case "attack": {
          const v = this.atkOf(e);
          const dice = it.roll ? `D20 = ${it.roll}，${it.roll} mod ${it.n} = ${it.idx}` : "";
          return { type: "attack", value: v, lane: it.lane, text: `攻击 ${v}`, note: it.slip ? "还会塞打滑" : "", detail: dice };
        }
        case "watch":
          if (this.flags.attackPlayed) { const v = this.atkOf(e); return { type: "attack", value: v, lane: e.lane, text: `攻击 ${v}` }; }
          return { type: "idle", text: "待机", detail: "你这回合打出攻击牌，它就攻击" };
        case "heal": return { type: "buff", text: `自愈 ${it.amount}` };
        case "spew": return { type: "debuff", text: "喷淤泥" };
        case "scream": return { type: "summon", text: "尖叫" };
        case "sleep": return { type: "idle", text: "休眠" };
        case "flee": return { type: "idle", text: "逃跑" };
        case "howl": return { type: "idle", text: "嚎叫" };
        default: return { type: "idle", text: "无动作" };
      }
    }

    bossIntentOf(s) {
      if (s.destroyed || !s.intent) return null;
      if (s.intent === "attack") { const v = this.bossAtk(s); return { type: "attack", value: v, lane: s.i, text: `攻击 ${v}` }; }
      if (s.intent === "block") return { type: "buff", text: `格挡 ${D.ENEMIES.phantom.block}` };
      return { type: "idle", text: "尘埃" };
    }

    bossAtk(s) {
      const base = this.boss.atk + this.boss.str;
      if (base <= 0) return 0;
      return s.cold > 0 ? Math.max(1, base - 1) : base;
    }

    mirrorAtk() {
      const m = this.mirror;
      if (m.pos == null) return 0;
      const base = m.atk + m.str;
      return m.mirrors[m.pos].cold > 0 ? Math.max(1, base - 1) : base;
    }

    /* ---------- 敌人行动 ---------- */
    enemyPhase() {
      this.log("敌人行动", "phase");
      if (this.boss && !this.boss.dead) this.bossAct();
      if (this.result) return;
      if (this.mirror) this.mirrorAct();
      if (this.result) return;
      const order = this.enemies.filter(e => alive(e) && e.intent).sort((a, b) => a.lane - b.lane);
      for (const e of order) {
        if (!alive(e)) continue;
        this.enemyAct(e);
        if (this.result) return;
      }
      this.checkEnd();
    }

    enemyAct(e) {
      const it = e.intent || { kind: "idle" };
      switch (it.kind) {
        case "attack": {
          const dmg = this.atkOf(e);
          if (dmg > 0) {
            const broke = this.hitLane(it.lane, dmg, e.name, this.atkDetail(e.atk, e.str, e.tempStr, e.cold));
            if (e.id === "sloth" && broke) { e.asleep = true; this.log("怠惰幼兽打爆卡槽后睡着了", "status"); }
          }
          if (it.slip && !this.result) { this.discardPile.push(this.makeCard("slip")); this.log("排气管焦油往你的弃牌堆塞了 1 张打滑", "status"); }
          break;
        }
        case "watch":
          if (this.flags.attackPlayed) this.hitLane(e.lane, this.atkOf(e), e.name, this.atkDetail(e.atk, e.str, e.tempStr, e.cold));
          else this.log("红视-2000 盯着你，没有动作");
          break;
        case "heal": {
          const before = e.hp;
          e.hp = Math.min(e.maxHp, e.hp + it.amount);
          this.log(`${e.name} 自愈 ${it.amount}（${before} → ${e.hp}）`);
          break;
        }
        case "spew": {
          const free = this.slots.filter(s => !s.destroyed && !s.occ);
          if (free.length) {
            const s = this.rng.pick(free);
            s.occ = { kind: "sludge" };
            this.log(`软泥蛙往第 ${s.i + 1} 槽塞了一团淤泥，下回合那里不能放牌`, "status");
          } else this.log("软泥蛙的喷涌没找到空卡槽");
          break;
        }
        case "scream": {
          const lanes = this.boss || this.mirror ? [] : [0, 1, 2, 3, 4].filter(l => !this.enemyAt(l));
          if (lanes.length) {
            const lane = this.rng.pick(lanes);
            const ne = this.spawn(this.rng.pick(D.SUMMON_POOL), lane, false);
            this.log(`刺耳寄生物尖叫，${ne.name} 出现在第 ${lane + 1} 列`, "status");
          } else this.log("刺耳寄生物尖叫，但没有空位，召唤失败");
          break;
        }
        case "flee":
          e.fled = true;
          this.log(`${e.name} 逃跑了`, "kill");
          break;
        case "sleep": this.log(`${e.name} 在睡觉`); break;
        case "howl": this.log("回声嚎叫了一声（暂无效果）"); break;
        default: this.log(`${e.name} 没有动作`);
      }
      if (e.tempStr) { e.tempStr = 0; this.log("金属聚物的临时力量清空了"); }
      if (e.id === "parasite") e.pState = it.kind === "scream" ? "idle" : "scream";
      e.cycle++;
      if (e.id === "echo" && alive(e)) this.echoMove(e);
    }

    echoMove(e) {
      const dirs = this.rng.next() < 0.5 ? [-1, 1] : [1, -1];
      for (const d of dirs) {
        const l = e.lane + d;
        if (l >= 0 && l < LANES && !this.enemyAt(l)) {
          e.lane = l;
          this.log(`回声移到第 ${l + 1} 列`);
          return;
        }
      }
      this.log("回声左右都被挡住，留在原地");
    }

    bossAct() {
      const b = this.boss;
      for (const s of b.slots) s.armor = 0;
      for (const s of b.slots) {
        if (s.destroyed || !s.intent) continue;
        if (s.intent === "attack") {
          this.hitLane(s.i, this.bossAtk(s), `魅影卡槽 ${s.i + 1}`, this.atkDetail(b.atk, b.str, 0, s.cold));
        } else if (s.intent === "block") {
          s.armor += D.ENEMIES.phantom.block;
          this.log(`魅影卡槽 ${s.i + 1} 格挡 +${D.ENEMIES.phantom.block}`);
        } else {
          this.log(`魅影卡槽 ${s.i + 1}：尘埃，没有效果`);
        }
        if (this.result) return;
      }
    }

    mirrorAct() {
      const m = this.mirror;
      if (m.pos == null) { this.log("镜中人这回合没有出现"); return; }
      this.hitLane(m.pos, this.mirrorAtk(), "镜中人", this.atkDetail(m.atk, m.str, 0, m.mirrors[m.pos].cold));
    }

    /* ---------- 玩家挨打 ---------- */
    hitLane(lane, amount, src, detail) {
      const s = this.slots[lane];
      const head = `${src} 攻击第 ${lane + 1} 槽 ${amount}${detail ? `（${detail}）` : ""}`;
      if (amount <= 0) { this.log(`${head}：没有伤害`, "hurt"); return false; }
      if (s.alibi) {
        s.alibi = false;
        this.log(`${head}：不在场证明抵消了这次伤害`, "hurt");
        return false;
      }
      let d = amount;
      const parts = [];
      if (s.armor > 0) { const a = Math.min(s.armor, d); s.armor -= a; d -= a; parts.push(`卡槽护甲挡 ${a}`); }
      if (d > 0 && this.player.shield > 0) { const a = Math.min(this.player.shield, d); this.player.shield -= a; d -= a; parts.push(`公共护盾挡 ${a}`); }
      if (s.destroyed) {
        if (d > 0) parts.push(`卡槽已被打爆，${d} 点直接打到你身上`);
        this.log(`${head}：${parts.join("，") || "没有伤害"}`, "hurt");
        if (d > 0) this.loseHp(d, `第 ${lane + 1} 槽已被打爆`);
        return false;
      }
      if (d > 0 && this.ring > 0) { const a = Math.min(this.ring, d); this.ring -= a; d -= a; parts.push(`逐梦者之戒挡 ${a}（剩 ${this.ring}）`); }
      if (d > 0 && s.occ && s.occ.kind === "pawn") {
        const pawn = s.occ;
        const before = pawn.hp;
        pawn.hp -= d;
        parts.push(`影卒替卡槽挡下（${before} → ${Math.max(0, pawn.hp)}）`);
        d = 0;
        if (pawn.hp <= 0) { s.occ = null; parts.push("影卒死了"); }
      }
      let broke = false;
      if (d > 0) {
        const before = s.hp;
        s.hp -= d;
        parts.push(`卡槽 ${before} → ${Math.max(0, s.hp)}`);
        if (s.hp <= 0) broke = true;
      }
      this.log(`${head}：${parts.join("，") || "没有伤害"}`, "hurt");
      if (broke) this.destroySlot(s);
      return broke;
    }

    destroySlot(s) {
      const kind = s.kind;
      s.destroyed = true;
      s.hp = 0;
      s.armor = 0;
      s.alibi = false;
      this.stats.slotsLost++;
      this.clearOccupant(s, true);
      if (kind === "shadow" || kind === "ice") {
        this.log(`${kind === "shadow" ? "暗影" : "冰制"}卡槽 ${s.i + 1} 被打爆，不扣血`, "slot");
        s.kind = s.baseKind;
        s.maxHp = this.cfg.slotHp;
      } else if (kind === "wax") {
        this.log(`蜂蜡卡槽 ${s.i + 1} 被打爆，不扣血，还给你回 2 血`, "slot");
        this.heal(2);
      } else {
        this.log(`第 ${s.i + 1} 槽被打爆`, "slot");
        this.loseHp(s.maxHp, `第 ${s.i + 1} 槽被打爆`);
      }
      if (this.relics.netsuke && !this.netsukeUsed && !this.result) {
        this.netsukeUsed = true;
        this.repair(s);
        this.log(`老旧的根付：立刻修好了第 ${s.i + 1} 槽，奇物失效`, "relic");
      }
    }

    clearOccupant(s, smashed) {
      const o = s.occ;
      if (!o) return;
      s.occ = null;
      if (o.kind === "card") { this.discardPile.push(o.card); this.log(`「${this.cardName(o.card)}」失效，进了弃牌堆`); }
      else if (o.kind === "larva") {
        if (smashed) { this.removedForever.push(o.card); this.log("颤蚓幼虫跟着卡槽一起没了，从卡组里永久删掉", "status"); }
        else this.discardPile.push(o.card);
      }
      else if (o.kind === "doom") this.discardPile.push(o.card);
      else if (o.kind === "pawn") this.log("影卒消失了");
    }

    repair(s) {
      s.destroyed = false;
      s.kind = s.baseKind;
      s.maxHp = this.cfg.slotHp;
      s.hp = s.maxHp;
    }

    loseHp(n, why) {
      if (n <= 0 || this.result) return;
      if (this.god.lockHp) { this.log(`锁血：本来要掉 ${n} 血（${why}）`, "god"); return; }
      const before = this.player.hp;
      this.player.hp = Math.max(0, before - n);
      this.stats.hpLost += before - this.player.hp;
      this.log(`你掉了 ${n} 血（${why}）：${before} → ${this.player.hp}`, "hp");
      this.checkEnd();
    }

    heal(n) {
      const before = this.player.hp;
      this.player.hp = Math.min(this.player.maxHp, before + n);
      if (this.player.hp !== before) this.log(`你回了 ${this.player.hp - before} 血（${before} → ${this.player.hp}）`, "hp");
    }

    occName(o) {
      if (o.kind === "card") return `「${this.cardName(o.card)}」`;
      return { larva: "颤蚓幼虫", doom: "厄运", sludge: "淤泥", pawn: "影卒" }[o.kind] || "东西";
    }

    /* ---------- 结束判定 ---------- */
    checkEnd() {
      if (this.result) return true;
      if (this.player.hp <= 0) {
        this.result = "lose";
        this.phase = "over";
        this.log("你倒下了", "end");
        return true;
      }
      let won;
      if (this.boss) won = this.boss.dead;
      else if (this.mirror) won = this.mirror.mirrors.every(m => m.broken);
      else won = this.enemies.length > 0 && this.enemies.every(e => !alive(e));
      if (won) {
        this.result = "win";
        this.phase = "over";
        this.log("战斗胜利", "end");
        return true;
      }
      return false;
    }

    /* ---------- 调试 ---------- */
    debugAddCard(id, up) {
      const c = this.makeCard(id, up);
      if (id === "larva") { this.larvaQueue.push(c); this.nextLarva(); }
      else if (id === "doom") this.placeDoom(c);
      else this.hand.push(c);
      this.log(`调试：「${this.cardName(c)}」加入手牌`, "god");
    }
    debugHeal() { this.player.hp = this.player.maxHp; this.log("调试：回满血", "god"); }
    debugRepairAll() {
      for (const s of this.slots) if (s.destroyed) this.repair(s);
      this.log("调试：修好所有卡槽", "god");
    }
    debugEnergy(n) { this.player.energy = n; this.log(`调试：费用设为 ${n}`, "god"); }
  }

  QW.Combat = Combat;
})(typeof window !== "undefined" ? window : globalThis);
