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
    enemyStrength: 0,  // 敌人开局力量（事件「无助的男孩」会让它变成 1）
    // 被打爆的卡槽能放哪些牌（待确认）：
    //   special   只能放即冻术、诡药、冷场、黄金锤
    //   noDefense 攻击牌和技能牌也能放，防御牌和能力牌不行
    //   all       什么牌都能放
    // 只能放 special 时，正对被打爆卡槽的敌人只有全体伤害打得到，初始卡组可能卡死，所以先用 noDefense。
    brokenSlotCards: "noDefense"
  };

  const BROKEN_SLOT_RULES = {
    special: "只能放即冻术、诡药、冷场、黄金锤",
    noDefense: "攻击牌和技能牌也能放，防御牌和能力牌不行",
    all: "什么牌都能放"
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

  /* 随机普通战斗：2–3 个弱怪，或 1 个强怪带 1 个弱怪。easy 时只出 2 个弱怪（一局里的第一场）。 */
  function randomEncounter(seed, easy) {
    const rng = QW.rng.create(seed + ":encounter");
    const ids = easy
      ? [rng.pick(WEAK), rng.pick(WEAK)]
      : rng.next() < 0.5
        ? Array.from({ length: rng.int(2, 3) }, () => rng.pick(WEAK))
        : [rng.pick(STRONG), rng.pick(WEAK)];
    const lanes = [null, null, null, null, null];
    const spots = rng.shuffle([0, 1, 2, 3, 4]);
    ids.forEach((id, k) => { lanes[spots[k]] = id; });
    return { kind: "lanes", lanes };
  }

  /* ---------- 完整一局 ---------- */
  const NODE_TYPES = {
    battle: "战斗", elite: "挑战", event: "奇遇", rest: "阳台", treasure: "宝箱", shop: "商店", boss: "Boss"
  };

  // 地图：一共 12 层，第 1 层固定打小怪，第 11 层阳台，第 12 层 Boss，中间固定一层奖励（宝箱）；
  // 其余每层 3 个选项任选一个。没定的数都放在这里，开局页可以改（待确认）
  const RUN = {
    floors: 12,                                                  // 一共几层（含 Boss）
    rewardFloor: 6,                                              // 固定出奖励（宝箱）的那一层
    weights: { event: 25, elite: 12, rest: 10, shop: 8 },        // 随机层除了 1 个战斗，另外 2 个选项的比例
    startGold: 3, goldBattle: 1, goldElite: 5, goldBoss: 0,      // 问卷 B6-05
    restHeal: 9,                                                 // 阳台回血量，问卷里还没定
    rarePct: 8, eliteRarePct: 20,                                // 卡牌奖励里出现梦想卡的概率（%）
    shopCards: 5, shopRelics: 3, cardPrice: 2                    // 卡牌 2 金币一张（问卷 B6-06）
  };

  // 奇物池：宝箱、挑战奖励、商店都从这里出；逐梦者之戒和《雪女》另有来源
  const RELIC_POOL = ["netsuke", "hollowHeart", "watch", "encyclopedia", "hammerRelic", "beeswax"];

  /* 奇遇：文字照抄策划表。fx 是结果：hp 增减血量，remove 让你挑牌删掉，gain 随机得牌，
     curse 得诅咒，relic 得奇物，strength 下一场敌人加力量，newMap 换一个停车场。 */
  const EVENTS = [
    {
      id: "misstep", name: "意外踩空",
      text: "你穿行在沾满灰尘的车辆中间，紧绷的神经提防着随处可能出现的敌人。突然，你脚下一空……\n在下坠的过程中，你看见下方是无尽的黑暗，黑暗中似乎有一团红色的正在蠕动的生物。",
      options: [
        { label: "抓住命运的提线", effect: "删去1张牌，随机获得2张牌",
          outcomes: [{ fx: [{ remove: 1 }, { gain: 2 }], note: "香橼中学对于人的束缚把你拽回去了，可以是想起来还有啥没交然后停止下坠缓缓上升" }] },
        { label: "坠入黑暗", effect: "失去1点生命",
          outcomes: [{ fx: [{ hp: -1 }], note: "黑暗排斥你，但是依旧受伤了" }] },
        { label: "坠入红色不明物质", effect: "获得1张诅咒",
          outcomes: [{ fx: [{ curse: 1 }], note: "被弹上去了，但是沾了点幼虫" }] }
      ]
    },
    {
      id: "elevator", name: "显眼的电梯",
      text: "你在一个死胡同的墙壁上看见了一扇银色的金属电梯门，旁边的按钮闪着微光。但你清楚，凡派尔商务大厦根本就没有电梯。",
      options: [
        { label: "进入电梯", effect: "失去2点生命/无事发生/删去2张牌，随机获得2张牌，前往一个新的停车场",
          outcomes: [
            { fx: [{ hp: -2 }], note: "失去生命是因为剧烈的上下晃动摔的" },
            { fx: [] },
            { fx: [{ remove: 2 }, { gain: 2 }, { newMap: true }] }
          ] },
        { label: "无视", effect: "无事发生", outcomes: [{ fx: [] }] }
      ]
    },
    {
      id: "boy", name: "无助的男孩",
      text: "你看到一个站在废弃车辆旁边的男孩。他在注意到你以后，带着哭腔向你说道：“我找不到爸爸妈妈了，你可以带我出去吗？”",
      options: [
        { label: "带上他", effect: "获得1个奇物，在你的下一场战斗开始时，所有敌人获得1点力量。",
          outcomes: [{ fx: [{ relic: "netsuke" }, { strength: 1 }] }] },
        { label: "拒绝", effect: "无事发生", outcomes: [{ fx: [] }] }
      ]
    },
    {
      id: "lookBack", name: "不要回头",
      text: "你在小心避让停车场顶部管道渗出的淤泥时，你感觉被人拍了拍肩膀。",
      options: [
        { label: "回头", effect: "50%获得1张诅咒，50%获得1个奇物",
          outcomes: [
            { fx: [{ curse: 1 }], note: "背后没有人，你似乎听到了一阵咯咯的笑声" },
            { fx: [{ relic: "random" }], note: "背后没有人，你看到地上有一个包裹，打开来里面是一个奇物。" }
          ] },
        { label: "无视", effect: "无事发生", outcomes: [{ fx: [] }] }
      ]
    }
  ];

  QW.data = {
    CONFIG, BROKEN_SLOT_RULES, SHADOW_SLOT_HP, PAWN, FACTIONS, CARDS, ENEMIES, RELICS,
    STARTER_DECK, SUMMON_POOL, WEAK, STRONG, PRESETS, randomEncounter,
    NODE_TYPES, RUN, RELIC_POOL, EVENTS
  };
})(typeof window !== "undefined" ? window : globalThis);
