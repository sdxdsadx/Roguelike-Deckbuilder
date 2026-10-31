/* 规则测试：node --test prototype/test/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "../js/rng.js"));
require(path.join(__dirname, "../js/data.js"));
require(path.join(__dirname, "../js/engine.js"));
const { Combat } = globalThis.QW;

const lanes = (...ids) => ({ kind: "lanes", lanes: [0, 1, 2, 3, 4].map(i => ids[i] || null) });

function fight(encounter, opts = {}) {
  const c = new Combat(Object.assign({ seed: 42, encounter }, opts)).start();
  c.hand = [];
  return c;
}
function give(c, id, up) {
  const card = c.makeCard(id, up);
  c.hand.push(card);
  return card;
}
function playOk(c, card, lane) {
  const r = c.play(card.uid, lane);
  assert.ok(r.ok, r.reason);
}

test("卡槽被打爆：玩家掉卡槽血量上限 6，多出来的伤害作废", () => {
  const c = fight(lanes(null, null, "sloth"));
  c.slots[2].hp = 2;
  const hp = c.player.hp;
  c.endTurn();
  assert.equal(c.slots[2].destroyed, true);
  assert.equal(hp - c.player.hp, 6);
});

test("打向已被打爆的卡槽：伤害直接打到玩家身上", () => {
  const c = fight(lanes("tar"));
  c.destroySlot(c.slots[0]);
  const hp = c.player.hp;
  c.endTurn();
  assert.equal(hp - c.player.hp, 2);
});

test("护甲只保护所在卡槽，下个玩家回合开始时清零", () => {
  const c = fight(lanes("tar", "tar"));
  playOk(c, give(c, "parry"), 0);
  c.endTurn();
  assert.equal(c.slots[0].hp, 5, "第 1 槽：护甲挡 1，掉 1");
  assert.equal(c.slots[1].hp, 4, "第 2 槽没有护甲，掉 2");
  assert.equal(c.slots[0].armor, 0);
});

test("冰墙术的公共护盾保护任何一列，包括被打爆的那列", () => {
  const c = fight(lanes("tar"));
  c.destroySlot(c.slots[0]);
  const hp = c.player.hp;
  playOk(c, give(c, "iceWall"), 3);
  c.endTurn();
  assert.equal(c.player.hp, hp);
});

test("单体牌只打正对面；正对面没有敌人时放不进去", () => {
  const c = fight(lanes(null, "slime"));
  const s = give(c, "strike");
  assert.equal(c.canPlay(s.uid, 0).ok, false);
  playOk(c, s, 1);
  assert.equal(c.enemyAt(1).hp, 4);
});

test("一个卡槽一回合只能放 1 张牌", () => {
  const c = fight(lanes("slime"));
  playOk(c, give(c, "parry"), 2);
  const second = give(c, "parry");
  const r = c.play(second.uid, 2);
  assert.equal(r.ok, false);
  assert.match(r.reason, /已经放过牌/);
});

test("寒冷不管几层都只让攻击 -1，最低到 1；每个玩家回合开始 -1 层", () => {
  const c = fight(lanes("tar", "slime"));
  c.addCold(c.targetAt(0), 3);
  c.addCold(c.targetAt(1), 1);
  assert.equal(c.atkOf(c.enemyAt(0)), 1);
  assert.equal(c.atkOf(c.enemyAt(1)), 1);
  c.endTurn();
  assert.equal(c.slots[0].hp, 5);
  assert.equal(c.enemyAt(0).cold, 2);
});

test("打滑留在手里：护甲向右移 1 格，最右边移到最左边", () => {
  const c = fight(lanes("tar"));
  give(c, "slip");
  c.slots[4].armor = 2;
  c.endTurn();
  assert.equal(c.slots[0].hp, 6, "第 5 槽的护甲移到第 1 槽，挡住了焦油的 2 点");
});

test("血色魅影：卡槽被打爆时本体掉 16；那一列再挨打就打本体", () => {
  const c = fight({ kind: "phantom" }, { god: { infiniteEnergy: true } });
  c.boss.slots[2].hp = 3;
  playOk(c, give(c, "firestorm"), 0);
  assert.equal(c.boss.slots[2].destroyed, true);
  assert.equal(c.boss.slots[0].hp, 12);
  assert.equal(c.boss.body.hp, 80 - 16);
  playOk(c, give(c, "strike"), 2);
  assert.equal(c.boss.body.hp, 80 - 16 - 2);
});

test("血色魅影洗牌后多出 2 张攻击、2 张尘埃", () => {
  const c = fight({ kind: "phantom" }, { god: { lockHp: true } });
  for (let k = 0; k < 4; k++) c.endTurn();
  assert.ok(c.logs.some(l => l.text.includes("又洗进了 2 张攻击")));
  const b = c.boss;
  const total = b.draw.length + b.discard.length + b.slots.filter(s => s.intent).length;
  assert.equal(total, 15);
});

test("镜中人：打碎镜子往抽牌堆塞厄运；全部打碎才胜利", () => {
  const c = fight({ kind: "mirror" });
  c.mirror.mirrors.forEach(m => { m.hp = 2; });
  playOk(c, give(c, "strike"), 0);
  assert.equal(c.mirror.mirrors[0].broken, true);
  assert.ok(c.drawPile.some(x => x.id === "doom"));
  assert.equal(c.result, null);
  for (const m of c.mirror.mirrors.slice(1)) c.annihilate({ kind: "mirror", ref: m });
  assert.equal(c.result, "win");
});

test("回声：攻击目标 = 完好卡槽里的第（D20 mod 个数）个", () => {
  const c = fight(lanes("echo"));
  const e = c.enemies.find(x => x.id === "echo");
  const it = e.intent;
  const cand = c.slots.filter(s => !s.destroyed).map(s => s.i);
  assert.equal(it.idx, it.roll % cand.length);
  assert.equal(it.lane, cand[it.idx]);
});

test("怠惰幼兽：打爆卡槽后休眠，挨打苏醒并移到正对完好卡槽的空列", () => {
  const c = fight(lanes(null, null, "sloth"), { god: { lockHp: true } });
  c.slots[2].hp = 1;
  c.endTurn();
  const e = c.enemies[0];
  assert.equal(e.asleep, true);
  assert.equal(e.intent.kind, "sleep");
  c.hand = [];
  playOk(c, give(c, "firestorm"), 0);
  assert.equal(e.asleep, false);
  assert.ok([1, 3].includes(e.lane));
  assert.equal(e.intent.kind, "attack");
});

test("金属聚物：每挨一次打 +1 力量，行动完清空", () => {
  const c = fight(lanes("polymer"));
  playOk(c, give(c, "strike"), 0);
  playOk(c, give(c, "firestorm"), 1);
  const e = c.enemyAt(0);
  assert.equal(e.tempStr, 2);
  assert.equal(c.atkOf(e), 3);
  c.endTurn();
  assert.equal(c.slots[0].hp, 3);
  assert.equal(e.tempStr, 0);
});

test("红视-2000：封住最右边的牌；只在你打出攻击牌的回合攻击", () => {
  const c = fight(lanes(null, "redeye"));
  const strike = give(c, "strike");
  const parry = give(c, "parry");
  assert.equal(c.canPlay(parry.uid, 2).ok, false, "最右边的招架被封住");
  assert.equal(c.canPlay(strike.uid, 1).ok, true);
  give(c, "parry");
  playOk(c, parry, 3);
  c.endTurn();
  assert.equal(c.slots[1].hp, 6, "没打攻击牌，它不动");
  c.hand = [];
  const s2 = give(c, "strike");
  give(c, "parry");
  playOk(c, s2, 1);
  c.endTurn();
  assert.equal(c.slots[1].hp, 4, "打了攻击牌，它攻击 2");
});

test("同一个种子、同样的操作，结果完全一样", () => {
  function script(seed) {
    const c = new Combat({ seed, encounter: lanes("slime", "frog", "tar", "echo", "parasite"), god: { lockHp: true } }).start();
    for (let t = 0; t < 4 && !c.result; t++) {
      for (const card of c.hand.slice()) {
        const l = c.validLanes(card.uid)[0];
        if (l != null) c.play(card.uid, l);
      }
      c.endTurn();
    }
    return JSON.stringify(c.logs);
  }
  assert.equal(script(7), script(7));
  assert.notEqual(script(7), script(8));
});

test("颤蚓幼虫：所在卡槽被打爆时，从卡组里永久删掉", () => {
  const c = fight(lanes(null, null, "tar"));
  c.debugAddCard("larva");
  assert.equal(c.pending.type, "larva");
  assert.equal(c.endTurn().ok, false, "没放好幼虫不能结束回合");
  assert.ok(c.placeLarva(2).ok);
  c.slots[2].hp = 1;
  c.endTurn();
  assert.equal(c.slots[2].destroyed, true);
  assert.equal(c.removedForever.length, 1);
});

test("黄金锤：留在手里每回合 -1 费；修好卡槽但不返还扣掉的血", () => {
  const c = fight(lanes("slime"));
  const h = give(c, "goldHammer");
  c.endTurn();
  assert.ok(c.hand.includes(h), "保留在手里");
  assert.equal(c.cost(h), 3);
  c.destroySlot(c.slots[4]);
  const hp = c.player.hp;
  playOk(c, h, 4);
  assert.equal(c.slots[4].destroyed, false);
  assert.equal(c.slots[4].hp, 6);
  assert.equal(c.player.hp, hp);
});

test("混沌之型：回合结束时在自己那一格再结算一次最后打出的牌", () => {
  const c = fight(lanes("slime", null, "polymer"));
  playOk(c, give(c, "chaosForm"), 0);
  playOk(c, give(c, "strike"), 2);
  c.endTurn();
  assert.equal(c.enemyAt(0).hp, 4, "复制的打击打中第 1 列的淤泥");
});

test("暗影塑形：占住卡槽 3 回合，每个回合结束 +1 护甲", () => {
  const c = fight(lanes("slime"), { god: { lockHp: true } });
  playOk(c, give(c, "shadowForm"), 3);
  for (let k = 0; k < 2; k++) { c.endTurn(); assert.ok(c.slots[3].occ, `第 ${k + 1} 回合后还占着`); }
  c.endTurn();
  assert.equal(c.slots[3].occ, null);
  assert.ok(c.discardPile.some(x => x.id === "shadowForm") || c.drawPile.some(x => x.id === "shadowForm") || c.hand.some(x => x.id === "shadowForm"));
});

test("即冻术：放进完好卡槽给寒冷，放进被打爆的卡槽放护甲", () => {
  const c = fight(lanes("tar", "tar"));
  c.destroySlot(c.slots[1]);
  playOk(c, give(c, "flashFreeze", true), 0);
  assert.equal(c.enemyAt(0).cold, 2);
  playOk(c, give(c, "flashFreeze", true), 1);
  assert.equal(c.slots[1].armor, 4);
  const hp = c.player.hp;
  c.endTurn();
  assert.equal(c.player.hp, hp, "被打爆那列的 4 点护甲挡住了焦油");
});

test("不在场证明：这个卡槽无视下一次伤害", () => {
  const c = fight(lanes("sloth"));
  playOk(c, give(c, "alibi"), 0);
  c.endTurn();
  assert.equal(c.slots[0].hp, 6);
  assert.equal(c.slots[0].alibi, false);
});

test("老旧的根付：照常扣血，卡槽立刻修好，之后失效", () => {
  const c = fight(lanes("sloth"), { relics: { netsuke: true } });
  c.slots[0].hp = 1;
  const hp = c.player.hp;
  c.endTurn();
  assert.equal(hp - c.player.hp, 6);
  assert.equal(c.slots[0].destroyed, false);
  assert.equal(c.netsukeUsed, true);
});

test("随机乱打 300 场：不报错，状态不出现负数", () => {
  const { CARDS, PRESETS, randomEncounter } = globalThis.QW.data;
  const playable = Object.keys(CARDS);
  for (let n = 0; n < 300; n++) {
    const rng = globalThis.QW.rng.create("fuzz" + n);
    const deck = Array.from({ length: 14 }, () => ({ id: rng.pick(playable), up: rng.next() < 0.4 }));
    const enc = n % 3 === 0 ? rng.pick(PRESETS).enc : randomEncounter("fuzz" + n);
    const relics = { netsuke: rng.next() < 0.3, watch: rng.next() < 0.3, beeswax: rng.next() < 0.3, ring: rng.next() < 0.3, yukiOnna: rng.next() < 0.3 };
    const c = new Combat({ seed: n, deck, encounter: enc, relics, waxSlot: n % 5 }).start();
    for (let t = 0; t < 30 && !c.result; t++) {
      let guard = 0;
      while (c.pending && guard++ < 5) c.placeLarva(c.freeIntactSlots()[0].i);
      for (const card of c.hand.slice().concat(c.drawPile.filter(x => c.revealed.includes(x.uid)))) {
        if (c.result || c.pending) break;
        const ls = c.validLanes(card.uid);
        if (ls.length) c.play(card.uid, rng.pick(ls));
      }
      while (c.pending && guard++ < 10) c.placeLarva(c.freeIntactSlots()[0].i);
      if (!c.result) c.endTurn();
      assert.ok(c.player.hp >= 0 && c.player.hp <= c.player.maxHp, `血量越界：${c.player.hp}`);
      for (const s of c.slots) assert.ok(s.hp >= 0 && s.armor >= 0, `卡槽状态越界：${JSON.stringify(s)}`);
      assert.ok(c.player.shield >= 0);
    }
  }
});
