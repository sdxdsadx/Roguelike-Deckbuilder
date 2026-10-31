# 秦雾 · 卡牌肉鸽（暂名）

以“卡槽”为核心的卡牌肉鸽（Roguelike Deckbuilder）。仓库目前存放策划数据，之后会在这里加上能在浏览器里试玩的测试网页。

## 文件

| 路径 | 内容 |
| --- | --- |
| `design/game-design.xlsx` | 策划原表：敌怪、事件、卡牌、奇物 |
| `design/game-design.md` | 原表的 Markdown 版，可以直接在 GitHub 上阅读（脚本生成，不要手改） |
| `tools/xlsx_to_md.py` | 把 xlsx 导出成 Markdown 的脚本 |

改完策划表后，重新生成 Markdown：

```bash
python3 tools/xlsx_to_md.py design/game-design.xlsx design/game-design.md
```

## 核心规则（策划口述）

- 玩家血量 30。
- 每个卡槽 6 点血量；卡槽被打爆后，对玩家造成等同于卡槽血量的伤害。
- 每回合 3 点费用，剩余费用不保留到下回合。
- 地图节点：战斗、挑战、奇遇、阳台、宝箱、商店、Boss。

表里还没写清楚的机制整理成了一份网页问卷，答复后把结论补到这里。
