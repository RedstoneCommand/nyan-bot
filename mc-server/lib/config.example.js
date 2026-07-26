// ===================================================================
//  配置示例 — 复制此文件为 config.js 并按需修改
//  所有带 YOUR_ 的值都需要替换
// ===================================================================

const path = require('path');
const { readFileSync } = require('fs');

// ==================== 服务器连接 ====================
const HOST = 'YOUR_SERVER_IP';             // 服务器地址
const PORT = 25565;                        // 服务器端口
const USERNAME = 'YOUR_BOT_USERNAME';      // Bot 游戏 ID
const PASSWORD = 'YOUR_AUTHME_PASSWORD';   // AuthMe 登录密码
const CHECK_TIMEOUT = 120000;              // 连接超时（毫秒）
const VERSION = false;                     // MC 版本（false=自动检测）

// ==================== API 配置 ====================
// 优先读取环境变量 DEEPSEEK_API_KEY，若不存在则用此硬编码值
const API_KEY = '';                        // DeepSeek API Key
const API_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const MODEL_NAME = 'deepseek-v4-flash';    // AI 模型名
const MAX_TOKENS = 300;                    // AI 回复最大 token 数

// ==================== 管理员配置 ====================
const OWNER_NAMES = ['YOUR_GAME_ID'];       // 服主游戏 ID（可多个）

// ==================== 防刷屏 ====================
const COOLDOWN_MS = 5000;                  // 玩家指令冷却间隔
const ABUSE_WINDOW = 5000;                 // 滥用检测窗口（毫秒）
const ABUSE_THRESHOLD = 3;                 // 窗口内触发次数上限
const ABUSE_BAN_DURATION = 60000;          // 临时拉黑时长

// ==================== 定时器间隔 ====================
const CONTEXT_CLEAN_INTERVAL = 3 * 60 * 60 * 1000; // AI 上下文清理间隔（3小时）

// ==================== Bot 行为 ====================
const MOVE_DEFAULT_DURATION = 800;         // 默认移动时长（毫秒）
const MSG_QUEUE_INTERVAL = 1500;           // 消息队列输出间隔
const SEARCH_START_SLOT = 10;              // 背包搜索起始位（跳过合成格）
const ATTACK_DEFAULT_RANGE = 6;            // 默认攻击距离
const BLOCK_BREAK_RANGE = 6;               // 挖掘距离

// ==================== 消息格式（聊天信息匹配正则） ====================
// 原版服务器用 bot.on('chat') 监听即可。自定义格式（如带 [前缀] 的聊天框）
// 需要在 bot.on('message') 中解析。设 null = 不使用该格式。
const CHAT_MESSAGE_REGEX = /^\[.*?\]\s*<([^>]+)>\s(.+)/;  // 公屏正则，如 [Server] <player> message
const WHISPER_REGEX = /^\[(\w+)\s*➥\s*(\w+)\]\s+(.+)/;   // 私聊正则，如 [sender ➥ receiver] message
const WHISPER_INDEX_SENDER = 1;            // 私聊匹配中发送者的捕获组索引
const WHISPER_INDEX_RECEIVER = 2;          // 私聊匹配中接收者的捕获组索引
const WHISPER_INDEX_MESSAGE = 3;           // 私聊匹配中消息内容的捕获组索引

// ==================== AuthMe 自动登录 ====================
// 收到以下关键词的消息时自动执行 /login 或 /register
const AUTH_LOGIN_TRIGGERS = ['/login','/register','/l ','/reg ','登录','注册','密码'];

// ==================== 文件路径（相对项目根目录） ====================
const PROJECT_DIR = path.join(__dirname, '..');   // 项目根目录
const DATA_DIR = PROJECT_DIR;                      // 数据文件目录（可改为 ./data/）
const LOG_DIR = PROJECT_DIR;                       // 日志目录（可改为 ./logs/）

const LOG_FILE = path.join(LOG_DIR, 'nyanbot.log');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ENV_FILE = path.join(DATA_DIR, '.env');
const SCRIPT_FILE = path.join(DATA_DIR, 'script.json');
const SCRIPT_LIB_FILE = path.join(DATA_DIR, 'script_library.json');
const CMD_QUEUE_FILE = path.join(DATA_DIR, 'nyan_cmd.json');
const ITEM_DATA_FILE = path.join(DATA_DIR, 'item_data.json');
const CHINESE_ITEM_MAP_FILE = path.join(DATA_DIR, 'chinese_item_map.json');
const PROMPTS_DIR = path.join(DATA_DIR, 'prompts');

// ==================== 物品数据（运行时自动加载） ====================
const _itemData = JSON.parse(readFileSync(ITEM_DATA_FILE, 'utf8'));
const _chineseItemMap = JSON.parse(readFileSync(CHINESE_ITEM_MAP_FILE, 'utf8'));

// 反向映射：显示名 → 英文 ID
const _displayNameToId = {};
Object.entries(_itemData).forEach(([name, data]) => { _displayNameToId[data.display] = name });

// ID → 显示名
const _idToDisplay = {};
Object.entries(_itemData).forEach(([name, data]) => { _idToDisplay[data.id] = data.display });

const _nameById = {};
Object.entries(_itemData).forEach(([name, data]) => { _nameById[data.id] = name });

// ---- 运行时状态（会被 index.js 注入 bot 引用） ----
let bot = null;

function setBot(b) { bot = b; }
function getBot() { return bot; }

// ---- 容器方块 ID（bot 连接后从 registry 动态刷新） ----
let _containerBlockIds = [177, 411, 774]; // chest, trapped_chest, barrel
for (let i = 613; i <= 629; i++) _containerBlockIds.push(i); // shulker_box 各色

function getContainerBlockIds() { return _containerBlockIds; }
function setContainerBlockIds(ids) { _containerBlockIds = ids; }

// ---- 食谱 ID 映射 ----
let _recipeIdByName = {};

function getRecipeIdByName() { return _recipeIdByName; }
function setRecipeIdByName(map) { _recipeIdByName = map; }

// ---- 物品查找工具 ----

// 安全获取物品英文名（优先用 bot 运行时的 registry）
function safeEngNameById(id) {
  try {
    if (bot && bot.registry && bot.registry.itemsArray) {
      const item = bot.registry.itemsArray.find(i => i.id === id);
      if (item && item.name) return item.name;
    }
  } catch (e) {}
  return _nameById[id] || null;
}

// 安全获取物品显示名
function safeItemName(id) {
  try {
    if (bot && bot.registry && bot.registry.itemsArray) {
      const item = bot.registry.itemsArray.find(i => i.id === id);
      if (item) return item.displayName;
    }
  } catch (e) {}
  return _idToDisplay[id] || ('#' + id);
}

// 安全获取物品 ID（优先用 bot 运行时的 registry）
function safeItemId(engName) {
  try {
    if (bot && bot.registry && bot.registry.itemsByName) {
      const item = bot.registry.itemsByName[engName];
      if (item) return item.id;
    }
  } catch (e) {}
  return _itemData[engName] ? _itemData[engName].id : null;
}

// 中文名 → 英文 ID
function chineseToItemId(chineseName) {
  const engName = _chineseItemMap[chineseName];
  if (!engName) return null;
  return safeItemId(engName);
}

// 模糊匹配中文名
function fuzzyChineseMatch(query) {
  const lower = query.toLowerCase();
  for (const [cn, en] of Object.entries(_chineseItemMap)) {
    if (cn.includes(lower) || lower.includes(cn)) {
      const id = safeItemId(en);
      if (id) return { chineseName: cn, engName: en, id };
    }
  }
  return null;
}

// 显示名 → 英文 ID
function displayNameToId(display) {
  const engName = _displayNameToId[display];
  if (!engName) return null;
  return safeItemId(engName);
}

// ==================== 导出 ====================
module.exports = {
  // 服务器
  HOST, PORT, USERNAME, PASSWORD, CHECK_TIMEOUT, VERSION,
  // API
  API_KEY, API_ENDPOINT, MODEL_NAME, MAX_TOKENS,
  // 管理
  OWNER_NAMES,
  // 防刷屏
  COOLDOWN_MS, ABUSE_WINDOW, ABUSE_THRESHOLD, ABUSE_BAN_DURATION,
  // 定时器
  CONTEXT_CLEAN_INTERVAL,
  // Bot 行为
  MOVE_DEFAULT_DURATION, MSG_QUEUE_INTERVAL, SEARCH_START_SLOT,
  ATTACK_DEFAULT_RANGE, BLOCK_BREAK_RANGE,
  // 消息格式
  CHAT_MESSAGE_REGEX, WHISPER_REGEX,
  WHISPER_INDEX_SENDER, WHISPER_INDEX_RECEIVER, WHISPER_INDEX_MESSAGE,
  // AuthMe
  AUTH_LOGIN_TRIGGERS,
  // 文件路径
  PROJECT_DIR, DATA_DIR, LOG_DIR,
  LOG_FILE, CONFIG_FILE, ENV_FILE,
  SCRIPT_FILE, SCRIPT_LIB_FILE, CMD_QUEUE_FILE,
  ITEM_DATA_FILE, CHINESE_ITEM_MAP_FILE, PROMPTS_DIR,
  // 文件路径
  PROJECT_DIR, DATA_DIR, LOG_DIR,
  LOG_FILE, CONFIG_FILE, ENV_FILE,
  SCRIPT_FILE, SCRIPT_LIB_FILE, CMD_QUEUE_FILE,
  ITEM_DATA_FILE, CHINESE_ITEM_MAP_FILE, PROMPTS_DIR,
  // 运行时状态
  setBot, getBot,
  getContainerBlockIds, setContainerBlockIds,
  getRecipeIdByName, setRecipeIdByName,
  // 物品工具
  safeEngNameById, safeItemName, safeItemId,
  chineseToItemId, fuzzyChineseMatch, displayNameToId,
  _itemData, _chineseItemMap,
};
