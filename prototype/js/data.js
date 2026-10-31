/* 游戏数据：数值来自 design/game-design.xlsx，规则按 design/rules.md。
   params 里的每一项都是 [基础, 升级]；沙盒里的「数值」面板可以临时改它们。 */
(function (root) {
  "use strict";
  const QW = root.QW || (root.QW = {});

  const CONFIG = {
    playerHp: 30,      // 玩家血量上限
    startHp: 30,       // 开局血量
    slotHp: 6,         // 每个卡槽的血量
    energy: 3,         // 每回合费用
    draw: 5,           // 每回合抽牌
    handLimit: 10,     // 手牌上限（待确认）
    enemyStrength: 0   // 敌人开局力量（事件「无助的男孩」会让它变成 1）
  };

  const SHADOW_SLOT_HP = 4;
  const PAWN = { atk: 1, hp: 4 };
  const FACTIONS = ["火焰", "冰霜", "暗影", "幻术"];

  const CARDS = {
    strike: {
      name: "打击", cost: [1, 1], type: "攻击", faction: null, rarity: "初始", target: "opposite",
      params: { dmg: [2, 3] },
      text: p => `对正对面的敌人造成 ${p.dmg} 点伤害。`
    },
    parry: {
      name: "招架", cost: [1, 1], type: "防御", faction: null, rarity: "初始", target: "slot",
      params: { block: [1, 2] },
      text: p => `这个卡槽获得 ${p.block} 点护甲。`
    },
    frostTouch: {
      name: "冰霜之触", cost: [0, 0], type: "技能", faction: "冰霜", rarity: "初始", target: "opposite",
      params: { cold: [1, 1], draw: [0, 1] },
      text: p => `给正对面的敌人 ${p.cold} 层寒冷${p.draw ? `，抽 ${p.draw} 张牌` : ""}。`
    },
    blaze: {
      name: "炽烈轰击", cost: [3, 3], type: "攻击", faction: "火焰", rarity: "扩充", target: "opposite",
      params: { dmg: [9, 11] },
      text: p => `对正对面的敌人造成 ${p.dmg} 点伤害。`
    },
    iceSpike: {
      name: "冰刺", cost: [2, 2], type: "攻击", faction: "冰霜", rarity: "扩充", target: "slot",
      params: { dmg: [3, 4], cold: [1, 2] },
      text: p => `对所有敌人造成 ${p.dmg} 点伤害，受到伤害的敌人获得 ${p.cold} 层寒冷。`
    },
    shadowStrike: {
      name: "暗影打击", cost: [1, 0], type: "攻击", faction: "暗影", rarity: "扩充", target: "opposite",
      exhaust: true, innate: [false, true],
      params: { dmg: [3, 3] },
      text: (p, up) => `${up ? "固有。" : ""}对正对面的敌人造成 ${p.dmg} 点伤害，对方没受过伤时翻倍。消耗。`
    },
    firestorm: {
      name: "烈焰风暴", cost: [2, 2], type: "攻击", faction: "火焰", rarity: "扩充", target: "slot",
      params: { dmg: [4, 5] },
      text: p => `对所有敌人造成 ${p.dmg} 点伤害。`
    },
    fireball: {
      name: "火球术", cost: [1, 1], type: "攻击", faction: "火焰", rarity: "扩充", target: "opposite",
      params: { dmg: [3, 4] },
      text: p => `对正对面的敌人造成 ${p.dmg} 点伤害。`
    },
    crossFire: {
      name: "十字火焰", cost: [1, 1], type: "攻击", faction: "火焰", rarity: "扩充", target: ["opposite", "slot"],
      params: { dmg: [2, 2] },
      text: (p, up) => up
        ? `对所有敌人造成 ${p.dmg} 点伤害。`
        : `对正对面的敌人和它左右相邻的敌人各造成 ${p.dmg} 点伤害。`
    },
    iceWall: {
      name: "冰墙术", cost: [2, 2], type: "防御", faction: "冰霜", rarity: "扩充", target: "slot",
      params: { block: [4, 5] },
      text: p => `获得 ${p.block} 点公共护盾：任何卡槽挨打都先扣它。`
    },
    flashFreeze: {
      name: "即冻术", cost: [2, 1], type: "防御", faction: "冰霜", rarity: "扩充", target: "flashFreeze",
      params: { cold: [2, 2], block: [4, 4] },
      text: p => `放进完好的卡槽：给正对面的敌人 ${p.cold} 层寒冷。放进被打爆的卡槽：在上面放 ${p.block} 点护甲。`
    },
    alibi: {
      name: "不在场证明", cost: [2, 1], type: "防御", faction: "幻术", rarity: "扩充", target: "slot",
      exhaust: true,
      text: () => "这个卡槽无视下一次受到的伤害。消耗。"
    },
    shadowForm: {
      name: "暗影塑形", cost: [1, 1], type: "防御", faction: "暗影", rarity: "扩充", target: "slot",
      persist: 3,
      params: { block: [1, 2] },
      text: p => `占住这个卡槽 3 回合。每个回合结束时，这个卡槽获得 ${p.block} 点护甲。`
    },
    clairvoyance: {
      name: "灵视", cost: [2, 2], type: "技能", faction: "幻术", rarity: "扩充", target: "slot",
      params: { reveal: [1, 2] },
      text: p => `本回合打出过幻术牌时 0 费。展示牌库顶的 ${p.reveal} 张牌，本回合可以直接打出。`
    },
    elixir: {
      name: "诡药", cost: [1, 0], type: "技能", faction: "暗影", rarity: "扩充", target: "destroyed",
      params: { lose: [1, 1] },
      text: p => `放进被打爆的卡槽。失去 ${p.lose} 点生命，把它变成暗影卡槽（${SHADOW_SLOT_HP} 血，被打爆不扣血）。`
    },
    snowBurial: {
      name: "雪葬", cost: [0, 0], type: "技能", faction: "冰霜", rarity: "扩充", target: ["opposite", "slot"],
      text: (p, up) => up
        ? "消灭所有寒冷层数高于生命的敌人或魅影卡槽。"
        : "如果正对面目标的寒冷层数高于它的生命，消灭它。"
    },
    coldField: {
      name: "冷场", cost: [1, 0], type: "技能", faction: "冰霜", rarity: "扩充", target: "any",
      text: () => "把你所有被打爆的卡槽变成冰制卡槽（被打爆不扣血），下个回合开始时融化。"
    },
    visitor: {
      name: "异界来客", cost: [2, 2], type: "技能", faction: "暗影", rarity: "扩充", target: "slot",
      params: { pawns: [1, 2] },
      text: p => p.pawns > 1
        ? `在这个卡槽和另一个随机空卡槽各召唤 1 个 ${PAWN.atk}/${PAWN.hp} 的影卒。`
        : `在这个卡槽召唤 1 个 ${PAWN.atk}/${PAWN.hp} 的影卒。`
    },
    ignite: {
      name: "点燃！", cost: [1, 1], type: "能力", faction: "火焰", rarity: "扩充", target: "slot",
      persist: Infinity, innate: [false, true],
      params: { dmg: [1, 1] },
      text: (p, up) => `${up ? "固有。" : ""}占住这个卡槽。你的回合开始时，消耗牌库顶的 1 张牌，对所有敌人造成 ${p.dmg} 点伤害。`
    },
    chaosForm: {
      name: "混沌之型", cost: [2, 1], type: "能力", faction: "幻术", rarity: "扩充", target: "slot",
      persist: Infinity,
      text: () => "占住这个卡槽。每个回合结束时，在这里免费再结算一次你这回合打出的最后一张牌。"
    },
    frostbite: {
      name: "寒霜之触", cost: [0, 0], type: "攻击", faction: "冰霜", rarity: "梦想", target: "slot",
      params: { dmg: [2, 2], cold: [1, 2], draw: [1, 1] },
      text: p => `对所有敌人造成 ${p.dmg} 点伤害，给它们 ${p.cold} 层寒冷，抽 ${p.draw} 张牌。`
    },
    otherGate: {
      name: "彼界之门", cost: [3, 2], type: "能力", faction: "暗影", rarity: "梦想", target: "slot",
      persist: Infinity,
      text: () => `占住这个卡槽。你的回合开始时，在一个随机空卡槽召唤 1 个 ${PAWN.atk}/${PAWN.hp} 的影卒。`
    },
    poetry: {
      name: "流觞诗会", cost: [3, 2], type: "能力", faction: null, rarity: "梦想", target: "slot",
      persist: Infinity,
      params: { energy: [3, 3], draw: [3, 3] },
      text: p => `占住这个卡槽。本场战斗累计打出过火焰、冰霜、暗影、幻术牌各至少 1 张时，获得 ${p.energy} 费、抽 ${p.draw} 张，然后重新计数。`
    },
    polymorph: {
      name: "变形术", cost: [3, 2], type: "技能", faction: "幻术", rarity: "梦想", target: "opposite",
      exhaust: true,
      text: () => "把正对面的非精英、非 Boss 敌人变成 1/1 的绵羊。消耗。"
    },
    goldHammer: {
      name: "黄金锤", cost: [4, 3], type: "技能", faction: null, rarity: "事件", target: "destroyed",
      retain: true,
      text: () => "保留。留在手里时，每个回合结束费用 -1。放进被打爆的卡槽，把它修好。"
    },
    slip: {
      name: "打滑", cost: null, type: "状态", faction: null, rarity: "状态", unplayable: true,
      text: () => "无法打出。回合结束时还在手里，所有卡槽的护甲向右移 1 格，最右边移到最左边。战斗结束后移除。"
    },
    larva: {
      name: "颤蚓幼虫", cost: null, type: "诅咒", faction: null, rarity: "诅咒", unplayable: true,
      text: () => "抽到时，你选一个空卡槽把它放进去，一直占着。这个卡槽被打爆时，它从卡组里永久删掉。"
    },
    doom: {
      name: "厄运", cost: null, type: "诅咒", faction: null, rarity: "状态", unplayable: true,
      text: () => "无法打出。抽到时占住正对镜中人的卡槽，回合结束后进弃牌堆。战斗结束后移除。"
    }
  };

  const ENEMIES = {
    slime: {
      name: "蠕行淤泥", tier: "弱怪", atk: 1, hp: 6,
      rule: "意图循环：攻击 → 攻击 → 自愈 1。",
      flavor: "从停车场顶部管道中源源不断渗出的绿色淤泥，似乎有着自己的意志。"
    },
    frog: {
      name: "软泥蛙", tier: "弱怪", atk: 1, hp: 4,
      rule: "意图循环：喷涌 → 攻击。喷涌往随机一个空卡槽塞淤泥，那个卡槽下回合不能放牌。",
      flavor: "秦雾对于蛙类生物有着无端的恐惧。"
    },
    polymer: {
      name: "金属聚物", tier: "弱怪", atk: 1, hp: 10,
      rule: "每回合攻击。每挨一次打 +1 力量，它这次行动完就清空。"
    },
    tar: {
      name: "排气管焦油", tier: "弱怪", atk: 2, hp: 7,
      rule: "每回合攻击，攻击时往你的弃牌堆塞 1 张打滑。"
    },
    parasite: {
      name: "刺耳寄生物", tier: "弱怪", atk: 0, hp: 9,
      rule: "意图循环：尖叫 → 无动作；挨打后下一个意图变为尖叫。尖叫会从弱怪里召唤 1 个到空着的列。"
    },
    redeye: {
      name: "红视-2000", tier: "弱怪", atk: 2, hp: 5,
      rule: "你这回合打出过攻击牌，它就攻击，否则不动。它在场时，手牌最右边那张不能用。"
    },
    sloth: {
      name: "怠惰幼兽", tier: "强怪", atk: 6, hp: 12,
      rule: "每回合攻击。打爆一个卡槽后休眠，挨打时苏醒并移到最近的、正对完好卡槽的空列。你的卡槽全被打爆时，它逃跑。",
      flavor: "让你无法实现计划的本尊。"
    },
    echo: {
      name: "回声", tier: "强怪", atk: 3, hp: 8,
      rule: "意图循环：攻击 → 嚎叫（暂无效果）。开场和每次攻击前掷 D20，用模运算选站位和目标；每次行动后随机左右移 1 格。"
    },
    mirror: {
      name: "镜中人", tier: "精英", atk: 4, mirrorHp: 7,
      rule: "5 列各一面镜子，全部打碎才算胜利。它每回合随机出现在一面完好的镜子里，从那一列攻击；每打碎一面镜子，往你的抽牌堆塞 1 张厄运。"
    },
    phantom: {
      name: "血色魅影", tier: "BOSS", atk: 5, hp: 80, slotHp: 16, block: 3,
      rule: "5 个卡槽各放 1 张意图牌。卡槽被打爆时本体掉 16 血；那一列再挨打就直接打本体。牌组：尘埃 ×6、格挡3 ×5，每次洗牌后再洗进 2 张攻击、2 张尘埃。"
    },
    sheep: {
      name: "绵羊", tier: "变形", atk: 1, hp: 1,
      rule: "被变形术变出来的绵羊，每回合攻击 1。"
    }
  };

  const RELICS = {
    brokenPage: { name: "残破书页", rarity: "基础", combat: false, text: "第一次选牌可以额外增加 1 个选项。" },
    netsuke: { name: "老旧的根付", rarity: "扩充", price: 4, combat: true, text: "你失去一个卡槽后，立刻把它修好（照常扣血），然后这个奇物失效。" },
    hollowHeart: { name: "空虚之心", rarity: "扩充", price: 6, combat: false, text: "移除 1 张牌。" },
    watch: { name: "时侠腕表", rarity: "扩充", price: 6, combat: true, text: "每打出三张牌，下一张牌 0 费。" },
    encyclopedia: { name: "百科全书", rarity: "扩充", price: 4, combat: false, text: "获得 3 组卡牌奖励。" },
    hammerRelic: { name: "黄金锤", rarity: "扩充", price: 4, combat: false, text: "拾取时将一张黄金锤加入你的卡组。" },
    beeswax: { name: "芳香蜂蜡", rarity: "扩充", price: 4, combat: true, text: "一个卡槽变成蜂蜡卡槽：被打爆不扣血，还给你回 2 血。" },
    ring: { name: "逐梦者之戒", rarity: "事件", combat: true, armor: 25, text: "有 25 点护甲，你的卡槽要挨打时先由它抵挡，扣完失效。" },
    yukiOnna: { name: "《雪女》", rarity: "事件", combat: true, text: "战斗开始时，给所有敌人 1 层寒冷。" }
  };

  const STARTER_DECK = [
    { id: "strike", up: false }, { id: "strike", up: false }, { id: "strike", up: false },
    { id: "strike", up: false }, { id: "strike", up: false },
    { id: "parry", up: false }, { id: "parry", up: false }, { id: "parry", up: false }, { id: "parry", up: false },
    { id: "frostTouch", up: false }
  ];

  const SUMMON_POOL = ["slime", "frog", "polymer", "tar", "redeye"];
  const WEAK = ["slime", "frog", "polymer", "tar", "parasite", "redeye"];
  const STRONG = ["sloth", "echo"];

  const PRESETS = [
    { name: "弱怪三只", enc: { kind: "lanes", lanes: [null, "slime", "frog", "tar", null] } },
    { name: "强怪带弱怪", enc: { kind: "lanes", lanes: [null, "sloth", null, "redeye", null] } },
    { name: "聚物和寄生物", enc: { kind: "lanes", lanes: ["polymer", null, "parasite", null, null] } },
    { name: "回声和淤泥", enc: { kind: "lanes", lanes: [null, "echo", null, "slime", null] } },
    { name: "挑战：镜中人", enc: { kind: "mirror" } },
    { name: "Boss：血色魅影", enc: { kind: "phantom" } }
  ];

  /* 随机普通战斗：2–3 个弱怪，或 1 个强怪带 1 个弱怪。 */
  function randomEncounter(seed) {
    const rng = QW.rng.create(seed + ":encounter");
    const ids = rng.next() < 0.5
      ? Array.from({ length: rng.int(2, 3) }, () => rng.pick(WEAK))
      : [rng.pick(STRONG), rng.pick(WEAK)];
    const lanes = [null, null, null, null, null];
    const spots = rng.shuffle([0, 1, 2, 3, 4]);
    ids.forEach((id, k) => { lanes[spots[k]] = id; });
    return { kind: "lanes", lanes };
  }

  QW.data = {
    CONFIG, SHADOW_SLOT_HP, PAWN, FACTIONS, CARDS, ENEMIES, RELICS,
    STARTER_DECK, SUMMON_POOL, WEAK, STRONG, PRESETS, randomEncounter
  };
})(typeof window !== "undefined" ? window : globalThis);
