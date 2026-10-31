# 卡牌肉鸽原型

以“卡槽”为核心的卡牌肉鸽（Roguelike Deckbuilder）。游戏名由原作者来定，目前还没有起。

仓库里有策划数据、按问卷整理的完整规则，以及一个能在浏览器里试玩的战斗沙盒。

## 文件

| 路径 | 内容 |
| --- | --- |
| `design/game-design.xlsx` | 策划原表：敌怪、事件、卡牌、奇物 |
| `design/game-design.md` | 原表的 Markdown 版，可以直接在 GitHub 上阅读（脚本生成，不要手改） |
| `design/rules.md` | 完整规则，按机制问卷的答复整理 |
| `prototype/index.html` | 战斗沙盒，浏览器直接打开就能玩 |
| `prototype/js/data.js` | 沙盒用的卡牌、敌人、奇物数值 |
| `prototype/js/engine.js` | 战斗规则（不含界面） |
| `prototype/test/engine.test.js` | 规则测试 |
| `tools/xlsx_to_md.py` | 把 xlsx 导出成 Markdown 的脚本 |
| `docs/mechanics-questionnaire.html` | 机制确认问卷（网页） |

改完策划表后，重新生成 Markdown：

```bash
python3 tools/xlsx_to_md.py design/game-design.xlsx design/game-design.md
```

## 战斗沙盒

用浏览器打开 `prototype/index.html`，电脑和手机都能玩。

- 设置页可以选敌人组合、改卡组、开关奇物、改数值（玩家血量、卡槽血量、费用、抽牌数，以及每个敌人和每张牌的数字）。
- 出牌：点一张牌，再点一个亮起来的卡槽；也可以直接把牌拖过去。
- 调试：锁血、无限费用、往手牌里加任意牌、查看抽牌堆顺序；右侧日志会写清每一步伤害是怎么算的。
- 同一个随机种子、同样的操作，结果完全一样，方便复现问题。

改了规则代码之后，跑一下规则测试：

```bash
node --test prototype/test/engine.test.js
```

## 核心规则

- 玩家血量 30，5 个卡槽各 6 血。卡槽被打爆，玩家掉 6 血；敌人再打这一列，伤害直接打到玩家身上。
- 每回合 3 费、抽 5 张，剩余费用不保留到下回合。
- 每张牌都要放进一个卡槽才算打出，单体牌打的是这个卡槽正对面的敌人。
- 敌方有 5 列，正对 5 个卡槽，敌人打正对面的卡槽。
- 地图节点：战斗、挑战、奇遇、阳台、宝箱、商店、Boss。

完整规则见 `design/rules.md`，是按机制问卷 `docs/mechanics-questionnaire.html` 的答复整理的。
