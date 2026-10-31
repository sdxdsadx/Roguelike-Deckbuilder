/* 对局记录和问卷汇总的测试：node --test prototype/test/record.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

for (const f of ["rng", "data", "engine", "run", "record"]) require(path.join(__dirname, `../js/${f}.js`));
const { Combat, run: R, data: D, record: REC, rng } = globalThis.QW;

const win = c => { for (const t of c.allTargets()) c.annihilate(t); return c; };
const fightHere = (run, settings) => new Combat(R.combatOptions(run, settings || {})).start();

/* 乱打一场：能出的牌随便出，打不完就直接清场。 */
function bash(c, r, turns) {
  for (let t = 0; t < (turns || 60) && !c.result; t++) {
    while (c.pending) c.placeLarva(c.freeIntactSlots()[0].i);
    for (const card of c.hand.slice()) {
      if (c.result) break;
      const ls = c.validLanes(card.uid);
      if (ls.length) c.play(card.uid, r.pick(ls));
    }
    while (c.pending) c.placeLarva(c.freeIntactSlots()[0].i);
    if (!c.result) c.endTurn();
  }
  if (!c.result) win(c);
  return c;
}

/* 用程序跑完一整局（锁血），返回这局的状态。 */
function botRun(seed) {
  const r = rng.create("rec-bot" + seed);
  const run = R.createRun({ seed: "rec" + seed });
  run.lockHp = true;
  for (let guard = 0; !(run.result && run.screen.kind === "end") && guard < 400; guard++) {
    const step = R.currentStep(run);
    if (step) {
      if (step.kind === "cards") R.resolveStep(run, r.next() < 0.25 ? { skip: true } : { index: r.int(0, step.options.length - 1) });
      else if (step.kind === "wax") R.resolveStep(run, { index: r.int(0, 4) });
      else if (step.kind === "upgrade") R.resolveStep(run, { index: run.deck.findIndex(R.canUpgrade) });
      else R.resolveStep(run, { index: r.int(0, run.deck.length - 1) });
      continue;
    }
    const sc = run.screen;
    if (sc.kind === "map") { R.go(run, r.pick(R.available(run))); continue; }
    if (sc.kind === "combat") { R.finishCombat(run, bash(fightHere(run, { god: { lockHp: true } }), r)); continue; }
    if (sc.kind === "event" && sc.choice == null) { R.chooseEvent(run, r.int(0, D.EVENTS.find(e => e.id === sc.event).options.length - 1)); continue; }
    if (sc.kind === "rest" && !sc.done) { R.restHeal(run); continue; }
    if (sc.kind === "treasure" && !sc.opened) { R.openTreasure(run); continue; }
    R.leave(run);
  }
  return run;
}

test("一场战斗的摘要：敌人、结果、回合、每张牌打了几次、完整日志", () => {
  const c = new Combat({ seed: "sum1", encounter: { kind: "lanes", lanes: [null, "slime", null, "frog", null] } }).start();
  bash(c, rng.create("sum1"), 40);
  const s = c.summary();
  assert.deepEqual(s.enemies, ["蠕行淤泥", "软泥蛙"]);
  assert.ok(["win", "lose"].includes(s.result));
  assert.equal(s.turns, c.turn);
  assert.equal(Object.values(s.played).reduce((a, b) => a + b, 0), s.cardsPlayed);
  assert.ok(s.log.length > 5 && s.log.every(l => typeof l === "string"));
  assert.ok(s.log[0].startsWith("—— 战斗开始"));
  assert.equal(s.deck.length, D.STARTER_DECK.length);
  assert.doesNotThrow(() => JSON.stringify(s));
  assert.deepEqual(new Combat({ seed: "x", encounter: { kind: "mirror" } }).start().encounterNames(), ["镜中人"]);
  assert.deepEqual(new Combat({ seed: "x", encounter: { kind: "phantom" } }).start().encounterNames(), ["血色魅影"]);
});

test("完整一局的记录：每进一个节点记一条，每场战斗一份摘要，卡牌奖励记下给了什么、拿了什么", () => {
  const run = botRun(1);
  assert.equal(run.result, "win");
  const rec = REC.fromRun(run, { config: D.CONFIG, god: { lockHp: true }, overrides: { enemies: {}, cards: {} } });
  assert.ok(REC.isRecord(rec));
  assert.equal(rec.mode, "run");
  assert.equal(rec.result, "win");
  assert.ok(rec.endedAt, "结束的局要有结束时间");
  assert.equal(rec.settings.god.lockHp, true);
  assert.equal(rec.settings.run.floors, 12);
  const enters = rec.timeline.filter(t => t.kind === "enter");
  assert.equal(enters.length, run.stats.path.length);
  assert.deepEqual(enters.map(t => t.data.type), run.stats.path);
  assert.equal(rec.fights.length, run.stats.battles + run.stats.elites + run.stats.bosses);
  assert.ok(rec.fights.every(f => f.result === "win" && f.log.length && f.enemies.length));
  assert.equal(rec.fights[rec.fights.length - 1].type, "boss");
  const picks = rec.timeline.filter(t => t.kind === "cards");
  assert.ok(picks.length > 0);
  for (const p of picks) {
    assert.ok(Array.isArray(p.data.offered) && p.data.offered.length >= 3);
    assert.ok(p.data.picked === null || p.data.offered.includes(p.data.picked));
  }
  assert.equal(rec.finalDeck.length, run.deck.length);
  assert.equal(rec.summary.floor, 12);
  // 记录是纯 JSON，存进去再读出来不变
  assert.deepEqual(JSON.parse(JSON.stringify(rec)), rec);
});

test("没打完的局记成放弃；打输的局记成失败", () => {
  const run = R.createRun({ seed: "quit" });
  R.go(run, R.available(run)[0]);
  run.record.abandoned = true;
  assert.equal(REC.fromRun(run, {}).result, "abandoned");

  const lost = R.createRun({ seed: "lost" });
  R.go(lost, R.available(lost)[0]);
  const c = fightHere(lost);
  c.player.hp = 1;
  c.result = "lose";
  R.finishCombat(lost, c);
  const rec = REC.fromRun(lost, {});
  assert.equal(rec.result, "lose");
  assert.equal(rec.fights.length, 1);
  assert.equal(rec.fights[0].result, "lose");
});

test("加记录之前存下的进度（没有 record）也能接着打", () => {
  const run = R.createRun({ seed: "old" });
  delete run.record;
  R.go(run, R.available(run)[0]);
  assert.doesNotThrow(() => R.finishCombat(run, win(fightHere(run))));
  assert.equal(run.screen.kind, "reward");
});

test("战斗沙盒的记录", () => {
  const c = bash(new Combat({ seed: "sb", encounter: { kind: "lanes", lanes: ["tar", null, null, null, "redeye"] } }).start(), rng.create("sb"));
  const rec = REC.fromSandbox(c, { id: "sandbox-sb-1", startedAt: "2026-10-31T01:00:00.000Z", endedAt: "2026-10-31T01:05:00.000Z", encName: "自定义" },
    { config: D.CONFIG, god: {}, overrides: {}, relics: { watch: true } });
  assert.ok(REC.isRecord(rec));
  assert.equal(rec.mode, "sandbox");
  assert.deepEqual(rec.summary.enemies, ["排气管焦油", "红视-2000"]);
  assert.deepEqual(rec.settings.relics, ["时侠腕表"]);
  assert.equal(rec.fights.length, 1);
  assert.equal(rec.fights[0].type, "sandbox");
  assert.match(REC.fileName(rec), /^record-sandbox-sb-\d{8}-\d{4}\.json$/);
});

test("导入：单份记录、记录数组、合集文件都认；不认识的东西不收", () => {
  const a = REC.fromRun(botRun(2), {});
  const b = Object.assign({}, a, { id: a.id + "-b" });
  assert.equal(REC.normalizeImport(a).length, 1);
  assert.equal(REC.normalizeImport([a, b, { hello: 1 }]).length, 2);
  assert.equal(REC.normalizeImport(REC.bundle([a, b])).length, 2);
  assert.equal(REC.normalizeImport({ format: "something-else" }).length, 0);
  assert.equal(REC.normalizeImport(null).length, 0);
  assert.equal(REC.normalizeImport("text").length, 0);
  assert.equal(REC.normalizeImport(Object.assign({}, a, { version: 2 })).length, 0);
});

test("同一份记录导入两次只算一次，有问卷的那份优先", () => {
  const a = REC.fromRun(botRun(3), {});
  const withSurvey = Object.assign({}, a, { survey: REC.makeSurvey({ fun: 4 }) });
  const out = REC.dedupe([a, withSurvey, a]);
  assert.equal(out.length, 1);
  assert.equal(out[0].survey.answers.fun, 4);
  assert.equal(out[0].survey.questions.fun, "好玩吗？");
});

test("汇总：胜负、停在哪一层、选取率、问卷平均分和文字", () => {
  const w = REC.fromRun(botRun(4), {});
  const lose = Object.assign({}, REC.fromRun(botRun(5), {}), { id: "lose-1", result: "lose", summary: Object.assign({}, w.summary, { floor: 7 }) });
  const quit = Object.assign({}, lose, { id: "quit-1", result: "abandoned", summary: Object.assign({}, w.summary, { floor: 3 }) });
  w.survey = REC.makeSurvey({ tester: "小王", fun: 5, difficulty: 2, pace: "刚好", bestCard: "打击", rules: "回声的站位没看懂" });
  lose.survey = REC.makeSurvey({ tester: "小李", fun: 3, pace: "太慢", bestCard: "打击" });
  const a = REC.aggregate([w, lose, quit]);
  assert.equal(a.total, 3);
  assert.deepEqual(a.results.run, { win: 1, lose: 1, abandoned: 1, unfinished: 0 });
  assert.deepEqual(a.runEnds.map(e => e.floor), [12, 7, 3]);
  assert.equal(a.surveyed, 2);
  assert.equal(a.survey.fun.n, 2);
  assert.equal(a.survey.fun.sum / a.survey.fun.n, 4);
  assert.equal(a.survey.fun.counts["5"], 1);
  assert.equal(a.survey.pace.counts["刚好"], 1);
  assert.equal(a.survey.bestCard.counts["打击"], 2);
  assert.equal(a.survey.rules.texts[0].text, "回声的站位没看懂");
  assert.equal(a.survey.rules.texts[0].who, "小王");
  assert.ok(!a.survey.difficulty || a.survey.difficulty.n === 1);
  // 选取率：每张牌被拿走的次数不会超过出现的次数
  const offers = Object.values(a.cardOffers);
  assert.ok(offers.length > 0);
  assert.ok(offers.every(o => o.picked <= o.offered));
  assert.equal(offers.reduce((s, o) => s + o.picked, 0), a.rewardPicks);
  assert.ok(a.fights > 0 && a.fightTurns > 0);
  assert.ok(Object.keys(a.nodeChoices).includes("战斗"));
});

test("汇总不会被奇怪的导入文件弄坏", () => {
  // 用 JSON.parse 造：和真的导入文件一样，"__proto__" 会变成普通的键
  const evil = JSON.parse(JSON.stringify({
    format: REC.FORMAT, version: 1, id: "evil", mode: "run", result: "__proto__", seed: "1",
    summary: { floor: "x" }, path: "not-an-array",
    timeline: [null, { kind: "cards", data: { offered: ["__proto__", "constructor"], picked: "__proto__" } }],
    fights: [null, { turns: "abc", hpLost: {}, played: { PROTO: 5, toString: "9" }, result: "lose", enemies: ["__proto__"] }],
    survey: { answers: { fun: "999", pace: { a: 1 }, other: "__proto__" } }
  }).replace('"PROTO"', '"__proto__"'));
  assert.ok(Object.prototype.hasOwnProperty.call(evil.fights[1].played, "__proto__"));
  assert.ok(REC.isRecord(evil));
  const a = REC.aggregate([evil]);
  assert.equal(a.results.run.unfinished, 1);
  assert.equal(a.cardOffers["__proto__"].picked, 1);
  assert.equal(a.cardPlays["__proto__"], 5);
  assert.equal(a.cardPlays.toString, 9);
  assert.equal(a.fightTurns, 0);
  assert.ok(!a.survey.fun, "超出 1–5 的分数不算");
  assert.equal(({}).offered, undefined, "没有污染 Object.prototype");
  assert.equal(({}).picked, undefined);
});
