// ===================================================================
//  喵bot (Nyan-bot) — Minecraft 聊天机器人入口
//  node index.js 启动
//     守护进程重连：run.sh 在进程退出 180s 后自动重启
// ===================================================================

const path = require('path');
const { readFileSync, existsSync } = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder: pathfinderPlugin, Movements } = require('mineflayer-pathfinder');
const blockfinderPlugin = require('mineflayer-blockfinder')();

// ---- 模块加载 ----
const config = require('./lib/config');
const chat = require('./lib/chat-out');
const utils = require('./lib/utils');
const script = require('./lib/script');
const events = require('./lib/events');

// ---- 崩溃保护 ----
process.on('uncaughtException', (e) => {
  if (e.message && (e.message.includes('PartialReadError') || e.message.includes('Read error'))) return;
  console.error('[FATAL]', e.message);
});
process.on('unhandledRejection', (e) => {
  if (e && e.message && (e.message.includes('PartialReadError') || e.message.includes('Read error'))) return;
  console.error('[FATAL]', e ? e.message : 'unknown');
});

// ---- 控制台日志过滤（protodef 刷屏） ----
const _origConsoleLog = console.log.bind(console);
console.log = (...args) => {
  const str = args.join(' ');
  if (str.includes('PartialReadError') || str.includes('world_particles') || str.includes('Read error')) return;
  return _origConsoleLog(...args);
};

// ---- AI 模块 ----
const CatgirlLLM = require('../shared/catgirl-llm');
const RateLimiter = require('../shared/rate-limiter');
const MessageQueue = require('../shared/message-queue');

let apiKey = process.env.DEEPSEEK_API_KEY || config.API_KEY;
if (!apiKey) {
  try {
    const envPath = config.ENV_FILE;
    if (existsSync(envPath)) {
      const env = readFileSync(envPath, 'utf8');
      const match = env.match(/DEEPSEEK_API_KEY=['"]?([^'"\n]+)/);
      if (match) apiKey = match[1];
    }
  } catch (e) {}
}

const llm = new CatgirlLLM(apiKey, { ownerName: config.OWNER_NAMES[0] || 'OWNER' });
const rateLimiter = new RateLimiter(config.COOLDOWN_MS);

// ---- LLM 工具注册 ----
const tpa_to_player = async (args) => {
  const player = args.player || 'unknown';
  try { bot.chat('/tpa ' + player); return '已发送 /tpa'; } catch (e) { return '发送/tpa失败'; }
};
const play_music = async (args) => {
  const source = args.source || '163';
  const song = args.song || '';
  try { bot.chat('/zm music ' + source + ' ' + song); return '播放中'; } catch (e) { return '播放失败'; }
};
const stop_music = async (args) => {
  try { bot.chat('/zm stop'); return '已停止'; } catch (e) { return '停止失败'; }
};
const tpa_here = async (args) => {
  const player = args.player || 'unknown';
  try { bot.chat('/tpahere ' + player); return '已发送 /tpahere'; } catch (e) { return '发送失败'; }
};
const __run_command = async (args) => {
  const cmd = args.cmd || '';
  try { bot.chat(cmd); return '已执行'; } catch (e) { return '执行失败'; }
};

llm.registerTool('tpa_to_player', tpa_to_player);
llm.registerTool('play_music', play_music);
llm.registerTool('stop_music', stop_music);
llm.registerTool('tpa_here', tpa_here);
llm.registerTool('__run_command', __run_command);

const TOOLS = [
  { name: 'tpa_to_player', description: '传送到指定玩家', parameters: { player: '玩家名' } },
  { name: 'play_music', description: '播放音乐 (Zm)', parameters: { source: '163/qq', song: '歌名' } },
  { name: 'stop_music', description: '停止音乐', parameters: {} },
  { name: 'tpa_here', description: '请求玩家传送到机器人', parameters: { player: '玩家名' } },
  { name: '__run_command', description: '执行任意指令', parameters: { cmd: '完整指令（不含/）' } },
];

// ---- 加载提示词 ----
let GUEST_PROMPT;
try { GUEST_PROMPT = readFileSync(config.PROMPTS_DIR + '/main.txt', 'utf8').trim(); }
catch (e) { GUEST_PROMPT = '你是 Minecraft 猫娘喵酱，说话带喵～'; }

// ---- 好感模式 ----
const playerLoveMode = new Map();

// ---- 管理员命令模块 ----
const adminCmds = require('./admin-cmds');

// ---- 消息队列 ----
const msgQueue = new MessageQueue(config.MSG_QUEUE_INTERVAL);
chat.setMsgQueue(msgQueue);

// ---- 外部配置 ----
let CONFIG;
try { CONFIG = JSON.parse(readFileSync(config.CONFIG_FILE, 'utf8')); } catch (e) { CONFIG = {}; }

// ---- 指令处理器 ----
const cmdHandler = require('./lib/commands').createHandler({
  adminCmds, llm, rateLimiter, playerLoveMode,
  GUEST_PROMPT, TOOLS,
});

const { handleCmd, handleNormalAI } = cmdHandler;

// ===================================================================
//  连接管理 —— run.sh 守护进程兜底重启
// ===================================================================

let bot = null;
let lastChatTime = Date.now();
let cmdQueueInterval = null;

// ---- 地标刷新 ----
async function _refreshWarpList() {
  if (!bot || !bot.tabComplete) return;
  try {
    const seen = new Set();
    for (const prefix of 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) {
      try {
        const matches = await bot.tabComplete('/warp ' + prefix, true, false, 3000);
        if (matches && matches.length > 0) {
          for (const m of matches) {
            const wp = m.replace('/warp ', '').trim().toLowerCase();
            if (wp && wp.length > 0) seen.add(wp);
          }
        }
      } catch (e) {}
    }
    if (seen.size > 0) { require('./lib/commands').setWarpPoints([...seen].sort()); }
    chat.log(`[WARP] 已加载 ${seen.size} 个地标`);
  } catch (e) {}
}

// ---- 主连接函数 ----
async function connect() {
  chat.log('[BOOT] 正在连接 ' + config.HOST + ':' + config.PORT);

  bot = mineflayer.createBot({
    host: config.HOST,
    port: config.PORT,
    username: config.USERNAME,
    version: config.VERSION,
    checkTimeoutInterval: config.CHECK_TIMEOUT,
  });

  config.setBot(bot);
  msgQueue.setBot(bot);

  bot.on('connect', () => chat.log('[CONN] TCP 连接成功'));

  let spawnTimeout = null;
  let spawnTimedOut = false;

  // ---- login — 协议层初始化 ----
  bot.on('login', () => {
    chat.log('[CONN] 已登录');
    spawnTimedOut = false;
    bot._spawned = false;

    const client = bot._client;

    // 屏蔽协议层 PartialReadError
    client.on('error', (e) => {
      if (e.message && (e.message.includes('PartialReadError') || e.message.includes('Read error'))) return;
      chat.log('[PROTO] ❌ ' + e.message.substring(0, 100));
    });

    // 预吞掉不兼容包
    client.on('world_particles', () => {});
    client.on('particle', () => {});

    // 手工触发 spawn（某些服不自动触发）
    const checkSpawn = () => {
      if (!spawnTimedOut && !bot._spawned) {
        bot._spawned = true;
        chat.log('[CONN] position 包 → 手工触发 spawn');
        clearTimeout(spawnTimeout);
        setTimeout(() => bot.emit('spawn'), 100);
      }
    };
    client.on('position', checkSpawn);

    // 配方声明
    client.on('declare_recipes', (packet) => {
      let count = 0;
      const firstNames = [];
      for (const recipe of (packet.recipes || [])) {
        if (!recipe.name) continue;
        firstNames.push(recipe.name);
        const parts = recipe.name.split(':');
        const name = parts[parts.length - 1];
        if (config._itemData[name]) {
          const map = config.getRecipeIdByName();
          map[name] = recipe.name;
          config.setRecipeIdByName(map);
          count++;
        }
        if (firstNames.length >= 5) break;
      }
      chat.log(`[RECIPES] 收到 ${(packet.recipes || []).length} 个配方，匹配 ${count} 个`);
    });

    // 尝试 AuthMe 注册/登录
    try { bot.chat('/register ' + config.PASSWORD + ' ' + config.PASSWORD); } catch (e) {}
    setTimeout(() => {
      try { bot.chat('/login ' + config.PASSWORD); } catch (e) {}
    }, 2000);

    // spawn 超时检测（60秒后退出，由 run.sh 重启）
    clearTimeout(spawnTimeout);
    spawnTimeout = setTimeout(() => {
      if (bot && bot.end && !spawnTimedOut) {
        spawnTimedOut = true;
        chat.log('[CONN] 登录60秒未生成实体，退出进程');
        try { bot.end('spawn timeout'); } catch (e) {}
      }
    }, 60000);
  });

  // ---- spawn — 就绪 ----
  bot.on('spawn', () => {
    if (bot._spawnHandled) { return; }
    bot._spawnHandled = true;
    spawnTimedOut = false;
    clearTimeout(spawnTimeout);
    chat.log('[SPAWN] 已生成');

    // 上线消息
    setTimeout(() => chat.say('&#FF99CC喵～我上线了！&f😺'), 5000);

    // 加载寻路 + blockfinder
    try {
      bot.loadPlugin(pathfinderPlugin);
      bot.loadPlugin(blockfinderPlugin);
      const mcData = require('minecraft-data')(bot.version);

      // 配置寻路参数（合规行为）
      const movements = new Movements(bot, mcData);
      movements.canDig = false;
      movements.allow1by1towers = false;
      movements.scafoldingBlocks = [];
      movements.dontCreateFlow = true;
      bot.pathfinder.setMovements(movements);
      chat.log('[PATHFINDER] 已加载并配置');
    } catch (e) {
      chat.log(`[PATHFINDER] 加载失败: ${e.message}`);
    }

    // 刷新容器方块 ID
    try {
      const mcData = require('minecraft-data')(bot.version);
      const containerNames = ['chest', 'trapped_chest', 'barrel', 'shulker_box',
        'white_shulker_box', 'orange_shulker_box', 'magenta_shulker_box',
        'light_blue_shulker_box', 'yellow_shulker_box', 'lime_shulker_box',
        'pink_shulker_box', 'gray_shulker_box', 'light_gray_shulker_box',
        'cyan_shulker_box', 'purple_shulker_box', 'blue_shulker_box',
        'brown_shulker_box', 'green_shulker_box', 'red_shulker_box', 'black_shulker_box'];
      const newIds = containerNames.map(n => mcData.blocksByName[n]).filter(Boolean).map(b => b.id);
      if (newIds.length >= 3) config.setContainerBlockIds(newIds);
      chat.log(`[CONTAINER] 方块 ID 已刷新 (${config.getContainerBlockIds().length} 种)`);
    } catch (e) {}

    // 命令队列轮询
    if (cmdQueueInterval) clearInterval(cmdQueueInterval);
    cmdQueueInterval = setInterval(() => cmdHandler.checkCmdQueue(), 2000);

    // 地标
    setTimeout(_refreshWarpList, 5000);
  });

  // ---- kicked — 被踢出，直接退出等守护进程重启 ----
  bot.on('kicked', (r) => {
    const msg = typeof r === 'string' ? r : (r.text || JSON.stringify(r));
    chat.log('[KICKED] ' + msg.substring(0, 200));
    events.clearIntervals();
    config.setBot(null);
    msgQueue.setBot(null);
    chat.log('[EXIT] 被踢出，3分钟后由守护进程重启');
    // run.sh 会在进程退出后 180 秒重启
    process.exit(1);
  });

  // ---- error ----
  bot.on('error', (e) => {
    if (e.message && !e.message.includes('PartialReadError') && !e.message.includes('Read error')) {
      chat.log('[ERROR] ' + e.message.substring(0, 100));
    }
  });

  // ---- end — 断开连接，退出等守护进程重启 ----
  bot.on('end', () => {
    chat.log('[DISCONNECT] 断开连接');
    events.clearIntervals();
    config.setBot(null);
    msgQueue.setBot(null);
    chat.log('[EXIT] 断开连接，3分钟后由守护进程重启');
    process.exit(1);
  });

  // ---- 系统消息（AuthMe 登录提示） ----
  bot.on('messagestr', (text) => {
    if (bot._authDone) { return; }
    const lower = text.toLowerCase();
    const triggers = config.AUTH_LOGIN_TRIGGERS;
    for (const t of triggers) {
      if (lower.includes(t)) {
        bot._authDone = true;
        try { bot.chat('/l ' + config.PASSWORD); chat.log('[AUTH] 已发送 /l'); } catch (e) {}
        break;
      }
    }
    if (lower.includes('register') && !bot._authDone) {
      bot._authDone = true;
      try { bot.chat('/register ' + config.PASSWORD + ' ' + config.PASSWORD); } catch (e) {}
    }
  });

  // ---- 聊天事件（用 events.registerEvents 注册） ----
  events.registerEvents(bot, { handleCmd, onSpawn: null, onKicked: null, onEnd: null, onError: null });
}

// ---- 定期清理 AI 上下文 ----
setInterval(() => {
  chat.log('[CLEANUP] 清理 AI 上下文');
  llm.clearAllContexts();
  chat.log('[CLEANUP] 完成');
}, config.CONTEXT_CLEAN_INTERVAL);

// ---- 启动 ----
chat.log('[BOOT] 喵bot 启动中...');

// ---- 好玩吗 ----
const easterEggs = [
  '今天的喵能量是 ' + (Math.floor(Math.random() * 99) + 1) + '%',
  '偷偷告诉你，服务器里有只猫在盯着你 👀',
  '本次启动耗时: 待计算...',
  '🐟 鱼干库存充足！',
  '检测到附近有 0 只狗，安全 ✅',
  '今天的幸运方块: 钻石块 💎',
  '正在初始化...🐾 肉球校准完成 ✅',
  '本日推荐: 找个箱子蹲进去等玩家来',
  '🛠️ 红石粉不足？不存在的',
  '喵生目标: 摸遍所有玩家的头',
];
const seniorsTombstone = [
  '人在强也是人，神再弱还是神...',
  '这么做，有意义吗...',
  '何必呢...',
  '无意义的挣扎...',
  '看到了...我的接班人',
  '好笑吗...',
  '呼吸性碱中毒...',
  '这是事实...',
  'TO BE YOURSELF...',
  'SOUL UNDYING...'
];
const eggPool = Math.random() < 0.5 ? easterEggs : seniorsTombstone;
chat.log('[FAKE ERROR] ' + eggPool[Math.floor(Math.random() * eggPool.length)]);
connect();
