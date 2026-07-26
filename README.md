# 喵bot (Nyan-bot) 🐱

<div align="center">

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Minecraft](https://img.shields.io/badge/Minecraft-1.21.x-62B47A?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCA0MCI+PHBhdGggZmlsbD0iIzk5Q0MyQiIgZD0iTTAgMGw0MCAwaDAsdjQwaC00MHoiLz48dGV4dCB4PSI1IiB5PSIzMCIgZmlsbD0iI2ZmZiIgZm9udC1zaXplPSIyMCIgZm9udC13ZWlnaHQ9ImJvbGQiPk1DPC90ZXh0Pjwvc3ZnPg==)](https://www.minecraft.net)
[![DeepSeek](https://img.shields.io/badge/API-DeepSeek-4F6B8E)](https://platform.deepseek.com/)

Minecraft 服务器里的猫娘 AI 小助手。基于 Mineflayer + DeepSeek API

**[English](README.md) | 中文**

</div>

## 功能一览 ✨

| 功能 | 说明 |
|------|------|
| 🤖 **AI 聊天** | 用 `!` 或 `cmd::` 跟 AI 对话（基于 DeepSeek API） |
| 🎮 **动作控制** | `cmd::action` —— 转向、攻击、移动、丢弃、吃饭…… |
| 📦 **翻箱子** | `cmd::action find` —— 自动寻路开箱找物品 |
| 🗡️ **PVP 模式** | `cmd::action attack pvp` —— 自动选武器+护甲+追击 |
| 💕 **好感模式** | `cmd::love` —— 开启调情撒娇模式 |
| 🔐 **私信模式** | `cmd::mode whisper` —— AI 私信回复，不刷屏 |
| 📜 **脚本系统** | `cmd::script` —— 编写和执行自动化脚本 |
| 🎵 **音乐播放** | AI 自动调用 / ZigZag Music 插件 |
| 🚀 **地标传送** | `cmd::action warp` —— 服务器地标传送 |
| 📝 **角色设定** | `[中括号内文字]` —— 用消息覆盖 AI 的临时人设 |

## 前置要求 📋

- Node.js ≥ 18（推荐 20+）
- 一个 **Minecraft Java 版服务器**（Paper / Vanilla 均可）
- 一个 **DeepSeek API Key**（或其他兼容 OpenAI 格式的 LLM API）
  - 申请地址：https://platform.deepseek.com/
- （可选）**ZigZag Music 插件** —— 用于音乐播放功能

## 快速开始 🚀

```bash
# 1. 克隆项目
git clone https://github.com/yourname/nyanbot.git
cd nyanbot

# 2. 安装依赖
npm install

# 3. 配置
# 复制示例配置文件，按需修改
cp mc-server/lib/config.example.js mc-server/lib/config.js
# 设置 API Key（两种方式任选其一）
export DEEPSEEK_API_KEY="sk-your-key-here"
# 或写入 .env 文件
echo 'DEEPSEEK_API_KEY="sk-your-key-here"' > .env

# 4. 启动！（守护进程会自动重启）
bash mc-server/run.sh
```

## 配置说明 ⚙️

### 服务器连接（`mc-server/lib/config.js`）

```js
const HOST = '你的服务器地址';     // 服务器 IP 或域名
const PORT = 25565;                // 服务器端口
const USERNAME = 'bot_username';   // Bot 在游戏内的 ID
const PASSWORD = 'your_password';  // AuthMe 登录密码
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEEPSEEK_API_KEY` | DeepSeek/LLM API 密钥 | —（必填） |
| `LLM_MODEL` | AI 模型名 | `deepseek-chat` |

> DeepSeek API Key 优先级：`环境变量 > .env 文件 > config.js 中的 API_KEY 字段`

### 提示词（`shared/prompts/`）

- `main.txt` — AI 猫娘人设
- `love.txt` — 好感模式提示词
- `admin.txt` — 管理命令模式提示词

## 命令参考 📖

### 普通聊天
```
!你好                    → AI 回复
!传送到小明              → AI 识别并调用 /tpa
!放首稻香                → AI 识别并播放音乐
cmd::reset               → 清除当前对话上下文
cmd::love                → 切换好感模式
cmd::mode whisper        → 切换私信回复模式
cmd::mode public         → 切换公屏回复模式
```

### 动作指令（`cmd::action`）
```
cmd::action turn player           → 转向最近的玩家
cmd::action turn block <x> <y> <z> → 转向指定坐标
cmd::action attack                → 攻击一次
cmd::action attack auto <秒数>    → 自动攻击
cmd::action attack pvp            → PVP 模式
cmd::action move                  → 走向你
cmd::action move forward 10       → 向前移动 10 格
cmd::action drop                  → 丢弃手上物品
cmd::action drop all              → 丢掉所有物品
cmd::action use eat               → 吃东西
cmd::action tpa                   → 请求传送到你
cmd::action tpahere               → 让你传送到 bot
cmd::action warp <地标名>          → 地标传送
cmd::action find item <ID> range <距离>  → 翻箱子找物品
```

### 管理命令（`>>`，仅主人可用）
```
>>help             → 命令帮助
>>players          → 在线玩家
>>inventory        → 查看背包
>>say <消息>       → 让 bot 说话
>>whitelist add/remove <名字>  → 脚本白名单管理
>>script           → 脚本
```

### 脚本系统
```
cmd::script               → 查看帮助
cmd::script list          → 列出已保存脚本
cmd::script <名字>        → 执行脚本
cmd::script stop          → 停止当前脚本
```

## 项目结构 📁

```
nyanbot/
├── mc-server/            ← 主程序
│   ├── index.js            入口文件
│   ├── admin-cmds.js       管理命令模块
│   ├── run.sh              守护脚本（崩溃后 3 分钟重启）
│   └── lib/
│       ├── config.js        配置（服务器、API、定时器）
│       ├── chat-out.js      消息输出封装
│       ├── commands.js      指令处理（cmd::action 等）
│       ├── events.js        事件监听（spawn/chat/message）
│       ├── utils.js         工具函数（武器/护甲/防刷）
│       └── script.js        脚本执行器
├── shared/                 ← 公用模块
│   ├── catgirl-llm.js      DeepSeek API 封装
│   ├── rate-limiter.js      冷却控制
│   ├── message-queue.js     输出限速
│   ├── question-queue.js    任务队列
│   ├── reset_ai_context.sh  定时清理脚本
│   └── prompts/             提示词文件
│       ├── main.txt
│       ├── love.txt
│       └── admin.txt
├── package.json
└── README.md
```

## 注意事项 ⚠️

1. **AuthMe 自动登录**：Bot 会自动检测登录提示并输入密码，密码在 config.js 中配置
2. **寻路行为**：默认禁止破坏方块和搭路，仅在地面行走
3. **防刷屏**：每人 5 秒冷却，滥用会临时拉黑 60 秒
4. **Spawn 超时**：60 秒未生成实体自动退出，由守护脚本重启

## 技术栈 🛠️

- [Mineflayer](https://github.com/PrismarineJS/mineflayer) — Minecraft 机器人框架
- [Mineflayer-Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) — 寻路
- [DeepSeek API](https://platform.deepseek.com/) — AI 对话
- Node.js 22

## 许可证 📄

MIT — 只要保留版权声明。
