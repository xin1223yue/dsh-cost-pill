# dsh-cost-pill

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）Web 界面插件：**实时显示本次对话花了多少钱**。

两处显示，同一个计价引擎：

1. **输入框下方统计行** —— 在「2 轮 33 步 · 219 tok/s ｜ 1.4M tok · 缓存命中 98% ｜ ◔ 6%」这一行里加一格 `¥`。
2. **每条回复的脚注行** —— 在复制 / 点赞 / `用量 2.2M tok` 那一行加一个 `¥`，点开看这一轮的账单。

```
⏱ 2 轮 33 步 · 219 tok/s     1.4M tok · 缓存命中 98%     ¥2.15     ◔ 18%
                                                          ↑

[复制] ¥0.07 [👍][👎][分享]      [◫] 用量 2.2M tok       15:40
       ↑
```

点任意一个 `¥` 弹出账单（材质与官方「轮次用量」弹层一致，带背景虚化）：

```
本次对话花费                                    ¥2.15
─────────────────────────────────────────────────────
输入（未命中 + 缓存写入）            11.8万 · ¥0.35
缓存命中                            1174.8万 · ¥1.17
输出                                  6.9万 · ¥0.62
─────────────────────────────────────────────────────
已计价 1 轮 · 合计 1193.5万 tokens
当前时段高峰（09:00–12:00 / 14:00–18:00 为高峰，北京时间）· 输入 3 / 缓存 0.1 / 输出 9 元每百万 tokens
每条回复按它发生时刻的价格计价，高峰 / 空闲自动切换
```

## 特性

- **逐条回复计价**：每个 Turn 用它自己的 `turn/start` 时间戳 + provider 上报的真实桶（未命中输入 / 缓存命中 / 缓存写入 / 输出）算钱。
- **高峰 / 空闲自动切换**：09:00–12:00、14:00–18:00（北京时间）为高峰，其余为空闲；一条会话跨 12 点会自然分成两段价。
- **模型归属准确**：读 `routes[].model`，中途换模型不影响历史轮的价。
- **重开历史对话不重算**：已加载的轮次永远按它们各自时刻的价，不按"现在"。
- **只读、离线**：全部在浏览器里算，不新增 Host 服务、不做日志回放、不请求任何接口、不碰 API Key。
- **没有本地累加状态**：每次渲染从日志重算，所以刷新 / 切走再回来 / 重开同一条会话，数字完全一致（幂等）。
- **零构建**：仓库里带的是可直接加载的 `client.js`（ModuleLoader 格式），clone 下来就能用，不需要 `pnpm build`。

## 安装

插件运行时零依赖、无构建步骤，安装只是两件事：把包暴露到 profile 的 `node_modules`，并把包名登记进 profile 的 `dsh.profile.bundles`。

### 方式一：克隆 + 一键脚本（推荐，不需要联网装包）

```powershell
git clone https://github.com/xin1223yue/dsh-cost-pill.git
cd dsh-cost-pill
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

macOS / Linux：

```sh
git clone https://github.com/xin1223yue/dsh-cost-pill.git
cd dsh-cost-pill
sh ./install.sh
```

脚本做的事（`install.mjs`，跨平台）：

1. 在 `~/.dsh/profiles/web/node_modules/dsh-cost-pill` 建一个指向克隆目录的链接（Windows 用 junction）——所以改源码立刻生效；
2. 读 `~/.dsh/profiles/web/package.json`，把 `dsh-cost-pill` 写进 `dependencies` 和 `dsh.profile.bundles`（幂等，可选 `--dry-run` 先看）；
3. 提示重启。

参数：`--profile <名字>`（默认 `web`，也读 `$DSH_PROFILE`）、`--dry-run`。

### 方式二：走 dsh 的插件命令（需要联网）

```sh
dsh plugin --profile web add xin1223yue/dsh-cost-pill
```

这条只加依赖（它转发给 pnpm），**还要手工登记 bundle**：编辑 `~/.dsh/profiles/web/package.json`，把 `"dsh-cost-pill"` 加进 `dsh.profile.bundles` 数组，然后重启。少这一步插件不会加载。

### 卸载

```sh
# 删掉 bundle 登记与该依赖，然后重启
dsh plugin --profile web remove dsh-cost-pill
```

## 生效

客户端 bundle 的 revision 在 dsh 启动时烘进页面，所以装完要重启一次：

```powershell
powershell -ExecutionPolicy Bypass -File .\restart-dsh.ps1     # Windows，默认 3080 端口
```

或手动 `Ctrl+C` 后在原目录重新 `dsh web`。重启会换新的启动令牌，请用新控制台打印的 URL 打开页面（旧标签页会 401）。

## 精确度

| 数据 | 来源 | 精确度 |
| --- | --- | --- |
| 已加载的每一轮 | `turn-tail.tokenUsage` + `turn/start` 时间戳 | **精确** |
| 每轮用的模型 | `routes[].model` | **精确** |
| 高 / 低峰 | 该轮时间戳落在哪个时段 | **精确** |
| 脚注「本轮花费」 | 同上，单轮 | **精确**（该轮用量不全时直接不显示，不猜） |
| 窗口外 / 被压缩掉的历史 | 会话级 `tokenUsage` 投影减去已计价比部分 | 估算，**必带 `≈`**，用已计价轮次的均价 |
| 窗口里一轮都没有 | 当前模型 + 当前时刻价 | 估算，**必带 `≈`** |

也就是：**能找到时间的都精确；只有"根本没有逐轮记录"的部分才估算，并且一定标 `≈`。**

## 计价口径

单位：元 / 百万 tokens。

| 时段 | 模型 | 输入（未命中） | 缓存命中 | 输出 |
| --- | --- | --- | --- | --- |
| 高峰 09:00–12:00 / 14:00–18:00（北京时间） | deepseek-v4-flash | 3 | 0.1 | 9 |
| 高峰 | deepseek-v4-pro | 9 | 0.3 | 27 |
| 空闲 | deepseek-v4-flash | 1.5 | 0.05 | 4.5 |
| 空闲 | deepseek-v4-pro | 4.5 | 0.15 | 13.5 |
| 2026-08-17 之前的旧价 | flash / pro | 1 / 3 | 0.02 / 0.025 | 2 / 6 |

- `cacheWrite` 不单独计费，按未命中输入价计。
- 模型按 id 里的 `pro` / `reason` / `chat` 关键字分档，未知型号落到 flash 档。
- 改价：编辑 `client.js` 里的 `V4_PEAK` / `V4_OFFPEAK` / `V4_BASE` / `POLICY_SWITCH`。

## 时段与历史

| 场景 | 用的价 |
| --- | --- |
| 白天高峰聊的轮次，晚上重新打开 | 仍是白天高峰价（按 `turn/start`，永久不变） |
| 晚上继续发新消息 | 新轮次按晚上空闲价 |
| 同一会话横跨 12:00 / 18:00 | 前半段高峰价 + 后半段空闲价，自动分段 |
| 窗口外没加载出来的 token | 已计价轮次的真实均价（`≈`） |
| 窗口里一轮都没有 | 当前模型 + 当前时刻价（`≈`） |

## 实现要点

- 注册两个槽位，都由 dsh 的槽位契约声明，不读别的插件的 DOM：

  | 槽位 | id | order | 拿到的标准 kit |
  | --- | --- | --- | --- |
  | `conversation.composer.dock` | `cost` | 2 | `useChat` / `useProjection` |
  | `conversation.chat.assistant-actions` | `cost` | 60 | `useChat` + owner prop `messageId` |

- 单价与账目全是纯函数（`priceFor` / `priceBuckets` / `billOf` / `billForMessage`），没有副作用，便于测试。
- 浏览器 bundle 是手写的 ModuleLoader 握手格式：`window.__ModuleLoader__.load({ id, factory })`，`react` / `react-dom` 从平台模块表取，无 `dsh.client.external`。
- Host 半是空的（`export function apply() {}`）：插件不注册服务、不加工具，纯展示。

## 验证

```sh
node verify.mjs
```

离线跑：用假 `window.__ModuleLoader__` 加载 bundle、走两处 `ctx.slots.register`，再用一个极小渲染器（只用 `useState/useMemo/useRef/useEffect`）渲染组件，断言：

- 两个槽位的 id / order
- 弹层材质带 `backdrop-filter` 兜底值、`-webkit-` 前缀、原生描边变量
- 高峰 / 空闲 / 旧价三条价表分支
- 逐 Turn 计价、窗口外均价补齐、跨时段混合（白天高峰 + 夜间空闲）
- 按 `messageId` 取单轮账单；未知 id、缺 `tokenUsage`、缺 chat kit 时必须渲染空
- 空会话不渲染，`≈` 只出现在估算路径

## 目录

```
client.js       浏览器半（ModuleLoader bundle，唯一有逻辑的文件）
index.js        宿主半（空）
cordis.patch.yml  插入 Loader 行
package.json    清单（dsh.bundle / dsh.client 声明）
locale/         插件列表里的标题与描述（中 / 英）
icon.svg        插件图标
verify.mjs      离线验证（无依赖）
install.mjs     跨平台安装器
install.ps1 / install.cmd / install.sh   安装器入口
restart-dsh.ps1 / restart-dsh.cmd        Windows 重启 dsh web
sync.ps1        开发用：把克隆目录重新挂回 profile
```

## 已知限制

- **一轮内跨模型重试**：`routes` 只给模型名不给分桶，整轮按最后一个路由计价（正常不会发生）。
- **槽位改名**：dsh 若在后续版本重命名这两个槽位，`¥` 会静默消失，不报错；改 `apply()` 里的槽位名即可。
- **只认 DeepSeek 价表**：其他 provider 的模型会落到 flash 档，显示的金额仅供参照。

## English

A dsh (DeepSeek Harness) web plugin that shows what the current conversation costs, in CNY, in two places: the composer stats line under the input box, and the footer of every completed turn. Every reply is priced at its own `turn/start` timestamp with the official DeepSeek table, including the 2026-08-17 peak/off-peak policy, so reopening an old conversation never re-bills it at today's rate. Tokens that no per-turn record covers are estimated at the blended rate of the priced turns and always carry a `≈`.

Zero Host services, zero network calls, zero build step — the shipped `client.js` is a ready ModuleLoader bundle. Requires a dsh version that declares the `conversation.composer.dock` and `conversation.chat.assistant-actions` slots (verified against 0.2.1-rc.5).

```sh
git clone https://github.com/xin1223yue/dsh-cost-pill.git
cd dsh-cost-pill && sh ./install.sh
# restart dsh web, then hard-refresh the page
```

## License

MIT
