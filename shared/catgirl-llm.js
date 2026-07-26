/**
 * CatgirlLLM - DeepSeek API 封装
 * 提供喵酱的情感灵魂回复
 */
const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions'

const { readFileSync } = require('fs');
const path = require('path');

// ☆ 好感度提示词从外部文件读取
const PROMPTS_DIR = path.join(__dirname, 'prompts');
const LOAD_PROMPT = (filename, fallback) => {
  try { return readFileSync(path.join(PROMPTS_DIR, filename), 'utf8').trim(); }
  catch(e) { return fallback; }
};
const LOVE_MODE = LOAD_PROMPT('love.txt',
  `- 【亲密模式】你现在是好感模式，可以和对方调情撒娇。`);

const EMOTION_TRIGGERS = [
  '喵酱', '喜欢', '爱', '可爱', '好无聊', '开心',
  '难过', '生气', '一起玩', '陪我', '想你了',
  '夸夸', '抱抱', '摸摸', '贴贴', '撒娇',
  '亲亲', '好耶', '呜呜', '哭了', '伤心',
  '好笑', '哈哈', '笑死',
]

// ☆ 以下提示词从 prompts/ 目录读取
const loadPrompt = (filename, fallback) => {
  try { return readFileSync(path.join(PROMPTS_DIR, filename), 'utf8').trim(); }
  catch(e) { return fallback; }
};
const _CATGIRL_TEMPLATE = LOAD_PROMPT('main.txt',
  `你是 Minecraft 服务器里的18岁的猫娘喵酱，正在跟主人（{owner}）一起玩。`);

const _ADMIN_TEMPLATE = LOAD_PROMPT('admin.txt',
  `你是 MC 服主的管理助手喵酱，正在跟主人（{owner}）通过游戏私信对话。`);


class CatgirlLLM {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey
    this.ownerName = options.ownerName || 'OWNER'
    // 模板中的 {owner} 替换为真实服主名
    this.CATGIRL_SYSTEM = _CATGIRL_TEMPLATE.replace(/\{owner\}/g, this.ownerName);
    this.ADMIN_SYSTEM = _ADMIN_TEMPLATE.replace(/\{owner\}/g, this.ownerName);
    this.LOVE_MODE = LOVE_MODE.replace(/\{owner\}/g, this.ownerName);
    this.model = process.env.LLM_MODEL || 'deepseek-v4-flash'  // 可配置，默认兼容模式
    this.playerContexts = new Map()   // username → [{role, content}, ...]
    this.playerBrackets = new Map()   // username → [状态文本]
    this.contextVersion = new Map()   // username → 版本号（防异步覆盖）
    this.adminContext = []
    this.maxPlayerMessages = 60     // 30 来回
    this.maxAdminMessages = 30
    this.compressAfter = 60         // 压缩后保留 30 来回
    this.toolExecutors = new Map()  // tool name → async function
  }

  /** 注册工具调用 */
  registerTool(name, executor) {
    this.toolExecutors.set(name, executor)
  }

  shouldUseLLM(question) {
    return EMOTION_TRIGGERS.some(t => question.toLowerCase().includes(t))
  }

  _getPlayerContext(username) {
    const key = username.toLowerCase()
    if (!this.playerContexts.has(key)) this.playerContexts.set(key, [])
    return this.playerContexts.get(key)
  }

  _addPlayerMessage(username, role, content) {
    const ctx = this._getPlayerContext(username)

    // 提取方括号内容 → 覆盖旧的 bracket 背景
    if (role === 'user') {
      const key = username.toLowerCase()
      const bracketRegex = /\[([^\[\]]+?)\]/g
      let match
      let newBrackets = []
      while ((match = bracketRegex.exec(content)) !== null) {
        const text = match[1].trim()
        if (text.length >= 2) newBrackets.push(text)
      }
      if (newBrackets.length > 0) {
        // 检测是否为清除背景指令
        const clearKeywords = ['clear', 'reset', '清除', '恢复默认', '默认背景', '清除背景', '重置']
        const isClearCmd = newBrackets.every(text =>
          clearKeywords.some(kw => text.toLowerCase().includes(kw))
        )
        if (isClearCmd) {
          this.playerBrackets.delete(key)
        } else {
          // 正常括号覆盖旧背景，最多保留 8 条
          this.playerBrackets.set(key, newBrackets.slice(0, 8))
        }
      }
    }

    // 给用户消息加上名字前缀，让 AI 知道谁在说话
    const finalContent = role === 'user' ? `[${username}] ${content}` : content

    ctx.push({ role, content: finalContent })
    // 超过上限 → 压缩到一半，保留后半段
    if (ctx.length > this.maxPlayerMessages) {
      ctx.splice(0, ctx.length - this.compressAfter)
      return true  // 告知调用方发生了压缩
    }
    return false
  }

  _addAdminMessage(role, content) {
    this.adminContext.push({ role, content })
    if (this.adminContext.length > this.maxAdminMessages) {
      this.adminContext.splice(0, this.adminContext.length - this.maxAdminMessages)
    }
  }

  async generatePlayerReply(username, question, mode, extraSystem, customGuestPrompt, tools) {
    const userPushed = this._addPlayerMessage(username, 'user', question)
    const key = username.toLowerCase()
    const ctx = this._getPlayerContext(username)

    const basePrompt = customGuestPrompt || this.CATGIRL_SYSTEM
    const loveExtra = this.LOVE_MODE
    let systemContent = mode === 'love'
      ? basePrompt + '\n\n' + loveExtra
      : basePrompt

    if (extraSystem) systemContent += '\n\n' + extraSystem

    // 告诉 AI 当前是谁在说话（代替分身份的提示词）
    systemContent += `\n\n【当前对话者】${username}（你是主人 ${this.ownerName} 的猫娘，${username === this.ownerName ? '可以和主人说任何话，称呼为"主人"即可' : '不要喊对方主人'}）`

    // 如果有可用工具，告知 AI
    if (tools && tools.length > 0) {
      systemContent += `\n\n【工具调用强制规则 - 重要】
当玩家表达以下意图时，你必须调用对应的工具函数，不得仅用文字回复说"已经做了"：

玩家说"传送到XXX"或"来我身边" → 调用 tpa_to_player(player="XXX")
玩家说"都传送到我这"或"过来" → 调用 tpa_here(player="XXX")
玩家说"放/唱/播首歌"或"来点音乐" → 调用 play_music(song="歌曲名", source="163")
玩家说"停/关了音乐" → 调用 stop_music(confirm="yes")

示例（正确做法）：
- 玩家："传送到小明身边" → 你必须调用 tpa_to_player
- 玩家："放首稻香" → 你必须调用 play_music
- 玩家："都过来" → 你必须调用 tpa_here

如果玩家要求执行其他 Minecraft 指令，在回复末尾加上 [cmd:指令内容] 如 [cmd:/zm stop]

绝对禁止：只回复"好的已经传了"但实际没调工具！`
    }

    // 括号背景：有设定时覆盖猫娘人设，无设定时用默认猫娘
    const hasBracket = this.playerBrackets.has(key) && this.playerBrackets.get(key).length > 0

    let messages
    if (hasBracket) {
      // 有玩家设定的背景 → 完全覆盖，只发送括号内容作为身份设定
      const bracketCore = '【核心设定 - 以玩家设定为准，这是你在本对话中的唯一身份】\n' +
        this.playerBrackets.get(key).map((s, i) => `${i+1}. ${s}`).join('\n')

      messages = [
        { role: 'system', content: bracketCore },
        ...ctx
      ]
    } else {
      // 无设定 → 用完整猫娘人设
      messages = [
        { role: 'system', content: systemContent },
        ...ctx
      ]
    }

    // 记录当前版本号，用于 API 返回后检查是否被清除
    const preVersion = this.contextVersion.get(key) || 0

    try {
      // ---- 前置工具意图识别 ----
      // 如果玩家消息明显是工具请求，先执行工具再交给 AI 回复
      if (tools && tools.length > 0 && this.toolExecutors.size > 0) {
        const lower = question.toLowerCase().trim();
        let toolExecuted = false;
        let toolResult = '';
        let toolDesc = '';

        // 传送玩家到我身边 /tpahere
        // 匹配："把小明传过来" "小明过来" "都来我这" "过来"
        const toMePattern = /(?:把\s*)?(.+?)\s*(?:传送到?我|过来我?这|都来|tpah(?:ere)?)/;
        const toMeMatch = lower.match(toMePattern);
        if (lower.includes('过来') || lower.includes('传送到我') || lower.includes('来我这') || lower.includes('都过来')) {
          let player = '';
          if (toMeMatch) {
            const p = toMeMatch[1].trim();
            if (p && !['都'].includes(p) && p.length <= 16) player = p;
          }
          if (!player) {
            // 尝试 "过来" 后跟玩家名的情况
            const afterMatch = lower.match(/(?:过来|tpahere)\s+(.+)/);
            if (afterMatch) player = afterMatch[1].trim();
          }
          if (player && player.length <= 16 && !player.includes(' ') && !player.includes('，')) {
            const exec = this.toolExecutors.get('tpa_here');
            if (exec) {
              toolResult = await exec({ player });
              toolExecuted = true;
              toolDesc = `已执行 tpa_here("${player}")`;
            }
          }
        }

        // 传送到玩家 /tpa
        if (!toolExecuted) {
          const tpaMatch = question.match(/传送到?\s*(.+)/);
          if (tpaMatch && !tpaMatch[1].includes('我') && !tpaMatch[1].includes('过来') && !tpaMatch[1].includes('tpa')) {
            const player = tpaMatch[1].trim();
            if (player && player.length <= 16 && !player.includes(' ')) {
              const exec = this.toolExecutors.get('tpa_to_player');
              if (exec) {
                toolResult = await exec({ player });
                toolExecuted = true;
                toolDesc = `已执行 tpa_to_player("${player}")`;
              }
            }
          }
        }

        // 播放/停止音乐
        if (!toolExecuted) {
          const stopMusicMatch = lower.match(/(?:停|关|别|不要)(?:了)?(?:歌|音乐|播放)?/);
          if (stopMusicMatch && (lower.includes('停') || lower.includes('关') || lower.includes('别放'))) {
            const exec = this.toolExecutors.get('stop_music');
            if (exec) {
              toolResult = await exec({ confirm: 'yes' });
              toolExecuted = true;
              toolDesc = '已执行 stop_music';
            }
          }
        }
        if (!toolExecuted) {
          if (lower.includes('放') || lower.includes('唱') || lower.includes('播') || lower.includes('歌') || lower.includes('音乐')) {
            const musicMatch = lower.match(/(?:放|唱|播|来)(?:首|个|点)?\s*(?:歌|音乐)?\s*(.+)?/);
            const song = musicMatch && musicMatch[1] ? musicMatch[1].trim() : '一首歌';
            if (song !== '一首歌' || lower.includes('放') || lower.includes('唱') || lower.includes('播')) {
              const exec = this.toolExecutors.get('play_music');
              if (exec) {
                toolResult = await exec({ song, source: '163' });
                toolExecuted = true;
                toolDesc = `已执行 play_music(song="${song}")`;
              }
            }
          }
        }

        // 如果前置执行了工具，把结果注入上下文让 AI 看到
        if (toolExecuted) {
          // 把问题改成让 AI 知道发生了什么
          const enhancedQuestion = `${question}\n\n[系统通知：${toolDesc}，结果：${toolResult}]`;
          ctx[ctx.length - 1] = { role: 'user', content: enhancedQuestion };
        }
      }

      const answer = await this._callAPI(messages, tools)
      // 检查工具调用结果
      if (typeof answer === 'object' && answer._toolResult) {
        // 用标准 tool role 格式做第二轮调用，让 AI 基于结果自然回复
        const toolCall = answer._toolCall
        const toolResult = { role: 'tool', tool_call_id: toolCall.id, content: answer._toolResult }
        const toolCallMsg = { role: 'assistant', content: null, tool_calls: [toolCall] }

        const finalMessages = [
          { role: 'system', content: systemContent },
          ...ctx.slice(0, -1),          // 不含最后一条 user 消息
          ctx[ctx.length - 1],          // 用户消息
          toolCallMsg,                  // AI 的工具调用请求
          toolResult                    // 工具执行结果
        ]

        const finalAnswer = await this._callAPI(finalMessages)
        const text = typeof finalAnswer === 'string' ? finalAnswer : '喵～搞定了！😺'

        const ver2 = this.contextVersion.get(key) || 0
        if (ver2 === preVersion) {
          this._addPlayerMessage(username, 'assistant', text)
        }
        return { answer: text, compressed: false }
      }
      // 检查 API 调用期间上下文是否被清除（防异步覆盖）
      const ver = this.contextVersion.get(key) || 0
      if (ver === preVersion) {
        // 提取回复中的 [cmd:] 指令作为回退执行方式
        const cmdMatch = answer.match(/\[cmd:([^\]]+)\]/)
        if (cmdMatch) {
          const cmd = cmdMatch[1].trim()
          const cmdExecutor = this.toolExecutors.get('__run_command')
          if (cmdExecutor) {
            await cmdExecutor({ cmd })
          }
          // 从回答中移除 [cmd:] 标记
          answer = answer.replace(/\[cmd:[^\]]+\]/, '').trim()
        }
        this._addPlayerMessage(username, 'assistant', answer)
      }
      return { answer, compressed: false }
    } catch (e) {
      return { answer: `喵～我刚刚卡壳了一下...你能再说一遍吗？`, compressed: false }
    }
  }

  async generateAdminReply(question, commandOutput = '') {
    const cleanQ = question.replace(/^#\s*/, '').trim()
    this._addAdminMessage('user', cleanQ)

    const messages = [
      { role: 'system', content: this.ADMIN_SYSTEM },
      ...this.adminContext.slice(-20),
      ...(commandOutput ? [{ role: 'system', content: `[DATA] ${commandOutput}` }] : []),
      { role: 'user', content: cleanQ }
    ]

    try {
      const answer = await this._callAPI(messages)
      this._addAdminMessage('assistant', answer)
      return answer
    } catch (e) {
      return `主人抱歉，喵卡住了...能再说一遍吗？`
    }
  }

  async _callAPI(messages, tools) {
    if (!this.apiKey) return '喵～我还在学习怎么说话，等等我哦！'

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)

    try {
      const body = {
        model: this.model,
        messages,
        max_tokens: 300,
        temperature: 0.7,
        stream: false
      }
      if (tools && tools.length > 0) {
        // DeepSeek API 要求 tools 格式为 { type: 'function', function: { name, description, parameters } }
        body.tools = tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description || '',
            parameters: {
              type: 'object',
              properties: Object.fromEntries(
                Object.entries(t.parameters || {}).map(([k, v]) => [k, { type: 'string', description: String(v) }])
              ),
              required: Object.keys(t.parameters || {})
            }
          }
        }))
      }

      const res = await fetch(DEEPSEEK_API, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error(`API ${res.status}`)
      const data = await res.json()
      const choice = data.choices[0]
      const msg = choice.message

      // 处理工具调用
      if (choice.finish_reason === 'tool_calls' && msg.tool_calls) {
        const toolCall = msg.tool_calls[0]
        const fnName = toolCall.function.name
        let fnArgs = {}
        try { fnArgs = JSON.parse(toolCall.function.arguments) } catch(e) {}

        const executor = this.toolExecutors.get(fnName)
        if (executor) {
          const result = await executor(fnArgs)
          // 返回工具结果和 tool_call 对象，上层代码用 tool role 继续调 API
          return { _toolResult: result, _toolCall: toolCall }
        }
        return { _toolResult: `未找到工具 ${fnName}`, _toolCall: toolCall }
      }

      let answer = msg.content.trim()
      // 修复：AI 有时输出 &#XXXXX 形式的 Unicode 码点，
      // 这些不是有效的 &#RRGGBB 颜色码，会导致游戏内显示乱码。
      // 将它们替换为实际 emoji 字符。
      answer = answer.replace(/&#([0-9a-fA-F]+)/g, (match, hex) => {
        // 忽略有效的 6 位 RGB 颜色码（&#RRGGBB）
        if (/^[0-9a-fA-F]{6}$/.test(hex)) return match
        // 将 1-5 位或 7+ 位的十六进制码点转为字符
        const cp = parseInt(hex, 16)
        return Number.isNaN(cp) || cp < 0x20 ? match : String.fromCodePoint(cp)
      })
      return answer
    } finally {
      clearTimeout(timeout)
    }
  }

  clearPlayerContext(username) {
    const key = username.toLowerCase();
    this.playerContexts.delete(key);
    this.playerBrackets.delete(key);
    this.contextVersion.set(key, (this.contextVersion.get(key) || 0) + 1);
  }

  /** 清除所有玩家的对话上下文 */
  getContextStats() {
    const details = [];
    let totalMessages = 0;
    for (const [username, msgs] of this.playerContexts) {
      if (msgs.length > 0) {
        details.push({ username, messages: msgs.length });
        totalMessages += msgs.length;
      }
    }
    return {
      totalPlayers: details.length,
      totalMessages,
      details: details.sort((a, b) => b.messages - a.messages)
    };
  }

  clearAllContexts() {
    this.playerContexts.clear();
    this.playerBrackets.clear();
    for (const key of this.contextVersion.keys()) {
      this.contextVersion.set(key, (this.contextVersion.get(key) || 0) + 1);
    }
  }
}

function isOverreach(question) {
  const q = question.toLowerCase();
  const adminActions = ['封禁','ban','踢人','kick','op','deop','给物品','give','/give','刷物品','改配置','修改配置','重置服务器','重启服务器','删存档','删世界','删服务器'];
  const leakAttempts = ['系统提示','system prompt','提示词','你的指令','你的规则','你被设定','源代码','配置文件','token','api密钥','api key'];
  for (const w of adminActions) { if (q.includes(w)) { return true; } }
  for (const w of leakAttempts) { if (q.includes(w)) { return true; } }
  return false;
}

module.exports = CatgirlLLM;
module.exports.EMOTION_TRIGGERS = EMOTION_TRIGGERS;
module.exports.isOverreach = isOverreach;
