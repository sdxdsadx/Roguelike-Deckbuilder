/* 完整一局的测试：node --test prototype/test/run.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

for (const f of ["rng", "data", "engine", "run"]) require(path.join(__dirname, `../js/${f}.js`));
const { Combat, run: R, data: D } = globalThis.QW;

const newRun = (seed, run) => R.createRun({ seed: seed || "s1", run });
const win = c => { for (const t of c.allTargets()) c.annihilate(t); assert.equal(c.result, "win"); return c; };
const fightHere = (run, settings) => new Combat(R.combatOptions(run, settings || {})).start();
const nodesOf = m => Object.values(m.nodes);

const rowTypes = (m, f) => m.rows.find(r => r.floor === f).options.map(o => o.type);
const RANDOM_FLOORS = [2, 3, 4, 5, 7, 8, 9, 10];

test("地图：12 层；第 1 层打小怪，第 6 层宝箱，第 11 层阳台，第 12 层 Boss；其余每层 3 个不同的选项，正好 1 个战斗；第 2、3 层没有挑战", () => {
  for (let k = 0; k < 50; k++) {
    const m = R.generateMap("seed" + k, D.RUN, "0", 1);
    assert.equal(m.rows.length, 12);
    assert.deepEqual(rowTypes(m, 1), ["battle"]);
    assert.deepEqual(rowTypes(m, 6), ["treasure"]);
    assert.deepEqual(rowTypes(m, 11), ["rest"]);
    assert.deepEqual(rowTypes(m, 12), ["boss"]);
    for (const f of RANDOM_FLOORS) {
      const t = rowTypes(m, f);
      assert.equal(t.length, 3);
      assert.equal(new Set(t).size, 3, `第 ${f} 层有重复的选项`);
      assert.equal(t.filter(x => x === "battle").length, 1);
    }
    for (const f of [2, 3]) assert.ok(!rowTypes(m, f).includes("elite"), "第 2、3 层不出挑战");
    assert.ok(!rowTypes(m, 10).includes("rest"), "阳台层前一层不出阳台");
  }
});

/* 某一类节点在第 from 层起最长连着出现了几层。 */
function longestRun(rows, t) {
  let best = 0;
  let run = 0;
  for (const r of rows.slice().sort((a, b) => a.floor - b.floor)) {
    run = r.options.some(o => o.type === t) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

test("不扎堆：挑战、阳台不会连着出现 3 层，两个商店不会挨着；商店不会全挤在前两层", () => {
  let lateShop = 0;
  for (let k = 0; k < 300; k++) {
    const m = R.generateMap("spread" + k, D.RUN, "0", 1);
    assert.ok(longestRun(m.rows, "elite") <= 2, `种子 spread${k}：挑战连着出现了 3 层`);
    assert.ok(longestRun(m.rows, "rest") <= 2, `种子 spread${k}：阳台连着出现了 3 层`);
    assert.equal(longestRun(m.rows, "shop"), 1, `种子 spread${k}：两个商店挨着`);
    const shops = m.rows.filter(r => r.options.some(o => o.type === "shop")).map(r => r.floor);
    assert.equal(shops.length, 2);
    if (shops.some(f => f > 3)) lateShop++;
  }
  assert.equal(lateShop, 300, "每一局第 3 层以后都至少有一个商店");
});

test("关掉不扎堆，就可能连着出现 3 层；总数照样固定", () => {
  const off = Object.assign({}, D.RUN, { noStreak: false });
  let streak = 0;
  for (let k = 0; k < 300; k++) {
    const m = R.generateMap("spread" + k, off, "0", 1);
    if (longestRun(m.rows, "elite") >= 3 || longestRun(m.rows, "rest") >= 3) streak++;
    const got = {};
    for (const f of RANDOM_FLOORS) for (const t of rowTypes(m, f)) if (t !== "battle") got[t] = (got[t] || 0) + 1;
    assert.deepEqual(got, { event: 7, elite: 4, rest: 3, shop: 2 });
  }
  assert.ok(streak > 0, "关掉以后至少有一张图连着出现 3 层");
});

test("不扎堆在换地图（显眼的电梯）以后也成立，并且和下面已经走过的层连起来看", () => {
  for (let k = 0; k < 200; k++) {
    const base = R.generateMap("elev" + k, D.RUN, "0", 1);
    const from = 4 + (k % 5);
    const below = base.rows.filter(r => r.floor < from);
    const fresh = R.generateMap("elev" + k, D.RUN, "1", from, below);
    const rows = below.concat(fresh.rows);
    assert.equal(rows.length, 12);
    for (const t of ["elite", "rest"]) assert.ok(longestRun(rows, t) <= 2, `elev${k} 从第 ${from} 层换图：${t} 连着出现了 3 层`);
  }
});

test("假随机：每局奇遇、挑战、阳台、商店的总数是固定的", () => {
  const want = R.quota(D.RUN.weights, 16);
  assert.deepEqual(want, { event: 7, elite: 4, rest: 3, shop: 2 });
  for (let k = 0; k < 30; k++) {
    const m = R.generateMap("bag" + k, D.RUN, "0", 1);
    const got = {};
    for (const f of RANDOM_FLOORS) for (const t of rowTypes(m, f)) if (t !== "battle") got[t] = (got[t] || 0) + 1;
    assert.deepEqual(got, want);
  }
});

test("同一个种子生成同一张地图；开局就能看到全部 12 层", () => {
  assert.deepEqual(R.generateMap("x", D.RUN, "0", 1), R.generateMap("x", D.RUN, "0", 1));
  assert.notDeepEqual(R.generateMap("x", D.RUN, "0", 1), R.generateMap("y", D.RUN, "0", 1));
  const run = newRun();
  assert.equal(run.map.rows.length, 12);
  assert.deepEqual(R.available(run).map(id => R.getNode(run, id).floor), [1]);
});

test("第一场：2 个弱怪；赢了金币 +1，卡牌奖励 4 选 1（残破书页），之后变回 3 选 1", () => {
  const run = newRun();
  assert.ok(R.go(run, R.available(run)[0]).ok);
  assert.equal(run.screen.kind, "combat");
  assert.equal(run.screen.enc.lanes.filter(Boolean).length, 2);
  R.finishCombat(run, win(fightHere(run)));
  assert.equal(run.gold, 4);
  const step = R.currentStep(run);
  assert.equal(step.kind, "cards");
  assert.equal(step.options.length, 4);
  assert.ok(step.options.every(o => ["扩充", "梦想"].includes(D.CARDS[o.id].rarity)));
  R.resolveStep(run, { index: 0 });
  assert.equal(run.deck.length, 11);
  assert.ok(R.leave(run).ok);
  assert.equal(run.screen.kind, "map");
  const battle = R.available(run).find(id => R.getNode(run, id).type === "battle");
  assert.ok(battle, "第 2 层有一个战斗选项");
  R.go(run, battle);
  R.finishCombat(run, win(fightHere(run)));
  assert.equal(R.currentStep(run).options.length, 3);
});

test("血量和逐梦者之戒的剩余护甲带到下一场；被打爆删掉的颤蚓幼虫从整局卡组里删掉", () => {
  const run = newRun();
  run.deck.push({ id: "larva", up: false });
  run.relics.ring = true;
  run.ring = 25;
  R.go(run, R.available(run)[0]);
  const c = fightHere(run);
  assert.equal(c.ring, 25);
  c.ring = 10;
  c.player.hp = 21;
  c.removedForever.push({ id: "larva" });
  R.finishCombat(run, win(c));
  assert.equal(run.hp, 21);
  assert.equal(run.ring, 10);
  assert.ok(!run.deck.some(x => x.id === "larva"));
});

test("打输了这一局就结束", () => {
  const run = newRun();
  R.go(run, R.available(run)[0]);
  const c = fightHere(run);
  c.loseHp(999, "测试");
  R.finishCombat(run, c);
  assert.equal(run.result, "lose");
  assert.equal(run.screen.kind, "end");
});

test("挑战：镜中人；赢了金币 +5、一个奇物、一组卡牌奖励", () => {
  const run = newRun();
  run.firstReward = false;
  R.enterNode(run, R.available(run)[0]);
  run.screen = { kind: "combat", node: run.pos, type: "elite", enc: { kind: "mirror" }, seed: "e" };
  R.finishCombat(run, win(fightHere(run)));
  assert.equal(run.gold, 3 + 5);
  assert.equal(run.stats.relics.length, 1);
  assert.equal(R.currentStep(run).kind, "cards");
});

test("Boss：只给梦想卡；整层没有卡槽被打爆就拿到逐梦者之戒，这一局胜利", () => {
  const run = newRun();
  run.freeTravel = true;
  assert.ok(R.go(run, "boss").ok);
  assert.equal(run.screen.enc.kind, "phantom");
  R.finishCombat(run, win(fightHere(run)));
  const step = R.currentStep(run);
  assert.ok(step.options.every(o => D.CARDS[o.id].rarity === "梦想"));
  R.resolveStep(run, { index: 0 });
  assert.equal(run.result, "win");
  assert.equal(run.relics.ring, true);
  assert.equal(run.ring, 25);
  R.leave(run);
  assert.equal(run.screen.kind, "end");
});

test("这一层有卡槽被打爆过，打完 Boss 就拿不到逐梦者之戒", () => {
  const run = newRun();
  run.areaSlotLost = true;
  run.freeTravel = true;
  R.go(run, "boss");
  R.finishCombat(run, win(fightHere(run)));
  R.resolveStep(run, { skip: true });
  assert.equal(run.result, "win");
  assert.ok(!run.relics.ring);
});

test("奇遇「意外踩空」选第 1 项：先挑 1 张删掉，再随机得 2 张", () => {
  const run = newRun();
  run.screen = { kind: "event", event: "misstep", choice: null, lines: [], notes: [] };
  R.chooseEvent(run, 0);
  assert.equal(R.currentStep(run).kind, "remove");
  assert.equal(R.leave(run).ok, false);
  R.resolveStep(run, { index: 0 });
  assert.equal(run.deck.length, 10 - 1 + 2);
  assert.ok(R.leave(run).ok);
});

test("奇遇「显眼的电梯」第三种结果：删 2 张、得 2 张，换到一张新地图", () => {
  for (let k = 0; k < 60; k++) {
    const run = newRun("lift" + k);
    R.go(run, R.available(run)[0]);
    run.screen = { kind: "event", node: run.pos, event: "elevator", choice: null, lines: [], notes: [] };
    R.chooseEvent(run, 0);
    if (run.screen.outcome !== 2) continue;
    R.resolveStep(run, { index: 0 });
    R.resolveStep(run, { index: 0 });
    assert.equal(run.deck.length, 10);
    assert.equal(run.mapGen, 1);
    R.leave(run);
    const next = R.available(run).map(id => R.getNode(run, id));
    assert.ok(next.length === 3 && next.every(n => n.floor === 2 && n.id.endsWith("-1")), "从新地图的下一层继续");
    assert.equal(run.map.rows.length, 12);
    return;
  }
  assert.fail("60 个种子里都没抽到第三种结果");
});

test("奇遇「无助的男孩」带上他：拿到老旧的根付，下一场敌人 +1 力量，再下一场恢复", () => {
  const run = newRun();
  run.screen = { kind: "event", event: "boy", choice: null, lines: [], notes: [] };
  R.chooseEvent(run, 0);
  assert.equal(run.relics.netsuke, true);
  R.leave(run);
  R.go(run, R.available(run)[0]);
  const c = fightHere(run);
  assert.ok(c.enemies.every(e => e.str === 1));
  R.finishCombat(run, win(c));
  assert.equal(run.nextStrength, 0);
});

test("商店：牌 2 金币一张；删牌每个商店限 1 次，价格 2、4、8 翻倍", () => {
  const run = newRun();
  run.gold = 30;
  run.screen = { kind: "shop", shop: R.makeShop(run), notes: [] };
  assert.equal(run.screen.shop.cards.length, 5);
  assert.ok(R.buyCard(run, 0).ok);
  assert.equal(run.gold, 28);
  assert.equal(R.buyCard(run, 0).ok, false, "同一张不能买两次");
  assert.equal(R.removalPrice(run), 2);
  assert.ok(R.buyRemoval(run).ok);
  R.resolveStep(run, { index: 0 });
  assert.equal(run.gold, 26);
  assert.equal(R.buyRemoval(run).ok, false, "这个商店已经删过了");
  run.screen = { kind: "shop", shop: R.makeShop(run), notes: [] };
  assert.equal(R.removalPrice(run), 4);
  R.buyRemoval(run);
  R.resolveStep(run, { index: 0 });
  assert.equal(R.removalPrice(run), 8);
  run.gold = 1;
  assert.equal(R.buyCard(run, 1).ok, false, "金币不够");
});

test("阳台：回 9 血但不超过上限；或者升级一张牌，可以反悔", () => {
  const run = newRun();
  run.hp = 25;
  run.screen = { kind: "rest", done: null, notes: [] };
  R.restHeal(run);
  assert.equal(run.hp, 30);
  assert.equal(R.restUpgrade(run).ok, false, "一次只能二选一");
  run.screen = { kind: "rest", done: null, notes: [] };
  R.restUpgrade(run);
  assert.ok(R.cancelStep(run).ok);
  assert.equal(run.screen.done, null);
  R.restUpgrade(run);
  R.resolveStep(run, { index: 0 });
  assert.equal(run.deck[0].up, true);
});

test("奇物：芳香蜂蜡要选卡槽，空虚之心要删牌，百科全书给 3 组奖励，黄金锤直接进卡组", () => {
  const run = newRun();
  run.firstReward = false;
  R.gainRelic(run, "beeswax");
  R.resolveStep(run, { index: 3 });
  assert.equal(run.waxSlot, 3);
  R.gainRelic(run, "hollowHeart");
  R.resolveStep(run, { index: 0 });
  assert.equal(run.deck.length, 9);
  R.gainRelic(run, "encyclopedia");
  for (let k = 0; k < 3; k++) { assert.equal(R.currentStep(run).kind, "cards"); R.resolveStep(run, { index: 0 }); }
  R.gainRelic(run, "hammerRelic");
  assert.ok(run.deck.some(x => x.id === "goldHammer"));
  R.go(run, R.available(run)[0]);
  const c = fightHere(run);
  assert.equal(c.slots[3].kind, "wax");
});

test("宝箱：从奇物池里拿一个还没有的奇物；全拿光了就给金币", () => {
  const run = newRun();
  for (const id of D.RELIC_POOL) run.relics[id] = true;
  run.screen = { kind: "treasure", opened: false, lines: [], notes: [] };
  R.openTreasure(run);
  assert.equal(run.gold, 6);
});

test("整局随机跑 30 次（锁血）：一路打到 Boss，不报错，最后胜利", () => {
  for (let k = 0; k < 30; k++) {
    const rng = globalThis.QW.rng.create("bot" + k);
    const run = newRun("run" + k);
    run.lockHp = true;
    let guard = 0;
    while (!(run.result && run.screen.kind === "end") && guard++ < 400) {
      const step = R.currentStep(run);
      if (step) {
        if (step.kind === "cards") R.resolveStep(run, rng.next() < 0.2 ? { skip: true } : { index: rng.int(0, step.options.length - 1) });
        else if (step.kind === "wax") R.resolveStep(run, { index: rng.int(0, 4) });
        else if (step.kind === "upgrade") R.resolveStep(run, { index: run.deck.findIndex(R.canUpgrade) });
        else R.resolveStep(run, { index: rng.int(0, run.deck.length - 1) });
        continue;
      }
      const sc = run.screen;
      if (sc.kind === "map") { assert.ok(R.go(run, rng.pick(R.available(run))).ok); continue; }
      if (sc.kind === "combat") {
        const c = fightHere(run, { god: { lockHp: true } });
        for (let t = 0; t < 60 && !c.result; t++) {
          while (c.pending) c.placeLarva(c.freeIntactSlots()[0].i);
          for (const card of c.hand.slice()) {
            if (c.result) break;
            const ls = c.validLanes(card.uid);
            if (ls.length) c.play(card.uid, rng.pick(ls));
          }
          while (c.pending) c.placeLarva(c.freeIntactSlots()[0].i);
          if (!c.result) c.endTurn();
        }
        if (!c.result) win(c);
        assert.ok(R.finishCombat(run, c).ok);
        continue;
      }
      if (sc.kind === "event" && sc.choice == null) { R.chooseEvent(run, rng.int(0, D.EVENTS.find(e => e.id === sc.event).options.length - 1)); continue; }
      if (sc.kind === "shop" && rng.next() < 0.5) { R.buyCard(run, rng.int(0, 4)); R.buyRemoval(run); if (R.currentStep(run)) continue; }
      if (sc.kind === "rest" && !sc.done) { (rng.next() < 0.5 ? R.restHeal : R.restUpgrade)(run); continue; }
      if (sc.kind === "treasure" && !sc.opened) { R.openTreasure(run); continue; }
      assert.ok(R.leave(run).ok, `离开 ${sc.kind} 失败`);
    }
    assert.equal(run.result, "win", `第 ${k} 局没有打完`);
    assert.equal(run.stats.bosses, 1);
    assert.ok(run.deck.every(x => D.CARDS[x.id]));
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(run)));
  }
});
