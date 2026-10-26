# dsh-happy

给 DSH 对话区加一层**整屏动效背景**。

星空、代码雨、电路、华山论剑、小猫、小女生、飞机大战、赛车、飘雪、肥皂泡——十种场景，把整块画布当背景，正文列用一层按列宽计算的纱罩住，所以字始终清楚。每个回合随机换一个，回合内不变。

官网与实拍效果：<https://happy.yimeng.life/>

---

## 安装

**从 npm（推荐）**

插件页 → **添加插件** → 输入包名 `dsh-happy` → 安装源选 **npm 官方** → 安装 → **立即启用**。

> 国内镜像（`registry.npmmirror.com`）同步有延迟，刚发布时请用官方源。

**从源码（开发用）**

```powershell
git clone https://github.com/yimeng-life/dsh-happy.git
```

插件页 → 添加插件 → 填这个目录的绝对路径 → 安装 → 立即启用。

**卸载**：插件页 → 卸载。效果随插件 context 一起回收，页面恢复原样。

---

## 用法

| 快捷键 | 作用 |
| --- | --- |
| `Alt+T` | 换到下一个背景，并**固定**住（10 个循环，选择会记住） |
| `Alt+R` | 回到**随机**，并立刻换一个（清掉固定值） |
| `Alt+D` | 浅色 / 深色主题互换（走宿主 `theme.setTheme`，与「设置 → 外观」同步） |

**它只在"你干活"的时候出现**：任何工具在跑、或回合进行中，背景才播放；空闲、切会话、窗口隐藏时立刻停掉 `requestAnimationFrame` 并淡出，两侧恢复普通白纸。

**每个回合随机一个主题**：你发一条消息、这一轮做完 = 一个回合。回合内背景不变（中间停顿多久都不换），下一个回合重新随机，且不会和上一个重复。

固定值存在 `localStorage` 的 `dsh.happy.theme`。

---

## 十种背景

| 主题 | 内容 |
| --- | --- |
| 星空跃迁 | 星点从中心向外飞出，拖出长条纹 |
| 代码雨 | 竖列字符下落，带拖尾 |
| 电路脉冲 | 直角走线 + 沿线跑的光点 |
| 华山论剑 | 三层远山视差 + 冷月 + 云岚 + 偶尔一道剑气 + 落叶（没有人物、没有招式名，只有山水与光） |
| 小猫散步 | 矢量剪影小猫走路、尾巴摆动、留下爪印 |
| 小女生 | 连衣裙剪影 + 马尾 + 牵着气球，一路小跑掉小心心 |
| 飞机大战 | 我方战机从下方飞入、左右巡航连续开火，敌机成批压下来，击中炸成火星 |
| 赛车 | 横向速度线 + 小车剪影 |
| 飘雪 | 雪花慢落 + 摇摆 |
| 肥皂泡 | 径向渐变薄膜 + 高光，缓缓升起 |

---

## 可读性怎么保证

这是这类"背景插件"最容易做砸的地方，所以单独说：

- `.dsh-stage__veil` 是一条**按 `--dsh-chat-content-width` 计算**的横向纱：正文列内 84% 遮盖，列外 110px 内快速放开，两侧完全透明。所以动效在文字底下是"看得见但退到后面"，不是盖一层灰。
- 浅色主题用 **`multiply`（正片叠底）+ 墨色**（靛蓝 / 紫 / 青），像印在白纸上；深色主题用 **`lighter`（加色）+ 亮色**，才有发光感。见 `stagePalette()`。
- 背景层是 `z-index:-1`，永远在正文之下，`pointer-events:none`，不挡任何交互。

---

## 水印

右上角有一枚淡淡的 `dsh-happy` 字标：颜色走 `--dsw-alias-label-tertiary`，整体 50% 不透明，只在背景播放时淡入（比背景晚 160ms），空闲时随背景一起消失。位置落在正文列右侧的留白里，因为背景层在 `z-index:-1`，它不会盖住任何字，也不挡交互。

它是 `.dsh-stage::after` 的 `content`，**没有额外 DOM、没有每帧开销**，十种主题共用；想换位置、大小或文字，只改 `client.js` 里那一条 `.dsh-stage::after` 规则即可。

---

## 加一种新背景

在 `client.js` 里写一个 `themeXxx(g)`，返回 `{ resize(), step(dt) }`，再往 `STAGE_THEMES` 数组加一行 `{ id, name, create }`。`g` 提供 `{ ctx, w, h, pal }`。

只有一个 canvas，所有主题共用；`pal` 是当前明暗主题对应的调色板，别硬编码颜色，否则切明暗会不协调。

---

## 调参

视觉参数集中在 `client.js` 顶部：

| 位置 | 含义 |
| --- | --- |
| `TUNE.holdIdleMs` | 工具停下后多久淡出（默认 420ms，防抖） |
| `TUNE.switchQuietMs` | 切会话后的静默期（默认 600ms） |
| `stagePalette()` | 浅色 / 深色两套墨色 + 混合模式 |
| `THEMES` 里各主题的常量 | 数量、速度、尺寸 |
| `.dsh-stage__veil` 的 `.84` | 文字列遮盖强度，调高更护眼、调低更炫 |

改完 `client.js` 后刷新页面即可（`Ctrl+R`）。

---

## 已知限制

1. **依赖宿主的 DOM 语义属性**：`[data-conversation-content]` / `[data-tool][data-state]` / `[data-chat-running]` / `[data-streaming]`。DSH 大版本升级后如果这些改名，插件会安静地什么都不做（不报错、不挡交互）。
2. **没有"背景层"插槽**：DSH 目前没有这个扩展点，所以背景层是挂在对话画布元素内部的（`z-index:-1`）。这是刻意偏离「只能注册进 slot」的地方，随插件停用一起消失。
3. **切会话会静默 600ms**：避免把上一轮残留的工具行当成"正在工作"，闪几秒特效。
4. **减少动态效果**：系统开启后只画一帧静止画面，不跑 `requestAnimationFrame`。
5. **性能**：只有一张 canvas；每帧只做绘制，无 `filter` / `backdrop-filter`；空闲时 rAF 归零。
6. **不做设置项**：没有「设置」里的面板，调参靠改常量。

---

## 项目结构

```text
dsh-happy/
├─ package.json        dsh.bundle.patch + dsh.client
├─ cordis.patch.yml    往插件树插入一行
├─ index.js            Host 半区（空，只需一行可加载）
├─ client.js           Client 半区：状态机 + 10 个背景主题
├─ locale/{zh,en}.json 插件页标题与描述
├─ icon.svg
├─ preview.html        离线预览，直接加载 client.js，不需要 DSH
├─ reserved/dsh-haowan/ 占位包：只占名，不含代码
├─ tools/rename.mjs    发布前改名脚本
├─ LICENSE
└─ README.md
```

技术标识（改动需同步，否则装不上）：包名 `dsh-happy`、patch 行 id `happy`、Client 工厂 id `dsh-happy`。

---

## 开发

```powershell
node --check client.js        # 语法
npm pack --dry-run            # 看会发出去哪些文件
```

只发布插件本体；`reserved/`、`tools/`、`preview.html` 不进 npm 包。

---

## 许可

[MIT](LICENSE)
