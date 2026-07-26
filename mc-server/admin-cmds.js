// ===================================================================
//  管理员命令模块（喵bot 开源版精简实现）
// ===================================================================

const { existsSync, readFileSync, writeFileSync } = require('fs');
const path = require('path');
const config = require('./lib/config');

const BLACKLIST_FILE = path.join(__dirname, 'blacklist.json');
const WHITELIST_FILE = path.join(__dirname, 'whitelist.json');

// ---- 黑名单（文件持久化） ----
let _blacklist = new Set();
try {
  if (existsSync(BLACKLIST_FILE)) {
    const arr = JSON.parse(readFileSync(BLACKLIST_FILE, 'utf8'));
    if (Array.isArray(arr)) _blacklist = new Set(arr.map(n => n.toLowerCase()));
  }
} catch (e) {}

function saveBlacklist() {
  writeFileSync(BLACKLIST_FILE, JSON.stringify([..._blacklist]));
}

function isBlacklisted(name) {
  return _blacklist.has(name.toLowerCase());
}

function addBlacklist(name) {
  _blacklist.add(name.toLowerCase());
  saveBlacklist();
}

function removeBlacklist(name) {
  _blacklist.delete(name.toLowerCase());
  saveBlacklist();
}

// ---- 白名单（文件持久化） ----
let _whitelist = new Set();
try {
  if (existsSync(WHITELIST_FILE)) {
    const arr = JSON.parse(readFileSync(WHITELIST_FILE, 'utf8'));
    if (Array.isArray(arr)) _whitelist = new Set(arr.map(n => n.toLowerCase()));
  }
} catch (e) {}

function saveWhitelist() {
  writeFileSync(WHITELIST_FILE, JSON.stringify([..._whitelist]));
}

function isWhitelisted(name) {
  return _whitelist.has(name.toLowerCase());
}

function addWhitelist(name) {
  _whitelist.add(name.toLowerCase());
  saveWhitelist();
}

function removeWhitelist(name) {
  _whitelist.delete(name.toLowerCase());
  saveWhitelist();
}

function buildProfileInfo() {
  const bot = config.getBot();
  const players = bot && bot.players ? Object.keys(bot.players) : [];
  return {
    onlinePlayers: players.filter(p => p !== bot?.username),
    playerCount: players.length - 1,
    serverHost: config.HOST,
    serverVersion: bot?.version || 'unknown',
  };
}

async function handleAdminCmd(username, message, say, fallbackAI, extra) {
  const { llm } = extra || {};
  const cmd = message.replace(/^>>\s*/, '').trim().toLowerCase();
  const args = cmd.split(/\s+/);
  const main = args[0];

  if (main === 'help') {
    say('&#FFD700>> 管理命令列表：&f');
    setTimeout(() => say('&#87CEEBhelp&f — 显示帮助'), 500);
    setTimeout(() => say('&#87CEEBinventory&f — 查看背包'), 1000);
    setTimeout(() => say('&#87CEEBresetAll&f — 重置所有聊天记录'), 1500);
    setTimeout(() => say('&#87CEEBwhitelist&f add/remove — 管理白名单'), 2000);
    setTimeout(() => say('&#87CEEBblacklist&f add/remove/list — 管理黑名单'), 2500);
    setTimeout(() => say('&#87CEEBcontext&f — 查看上下文统计'), 3000);
    return;
  }

  if (main === 'resetall') {
    if (!llm) { say('&#FF6B6B❌ LLM 模块未加载&f'); return; }
    llm.clearAllContexts();
    say('&#99FF99✅ 已重置所有玩家的聊天记录&f');
    return;
  }

  // ---- 上下文统计 ----
  if (main === 'context') {
    if (!llm) { say('&#FF6B6B❌ LLM 模块未加载&f'); return; }
    const stats = llm.getContextStats();
    if (stats.totalPlayers === 0) {
      say('📋 当前没有活跃的对话上下文');
    } else {
      say(`📋 共 ${stats.totalPlayers} 位活跃玩家，${stats.totalMessages} 条消息`);
      // 只显示前三个最活跃的
      const limit = Math.min(stats.details.length, 3);
      for (let i = 0; i < limit; i++) {
        const d = stats.details[i];
        setTimeout(() => say(`  ${d.username}: ${d.messages}条消息`), 300 * (i + 1));
      }
    }
    return;
  }

  // ---- 白名单管理 ----
  if (main === 'whitelist') {
    const sub = args[1];
    const name = args[2];
    if (sub === 'add' && name) {
      addWhitelist(name);
      say(`&#99FF99✅ 已将 &f${name} 加入白名单`);
    } else if (sub === 'remove' && name) {
      removeWhitelist(name);
      say(`&#FF6B6B✅ 已将 &f${name} 移出白名单`);
    } else {
      say('&#FFD700用法：&f>>whitelist add/remove <玩家名>');
    }
    return;
  }

  // ---- 黑名单管理 ----
  if (main === 'blacklist') {
    const sub = args[1];
    const name = args[2];
    if (sub === 'add' && name) {
      addBlacklist(name);
      say(`&#FF6B6B✅ 已将 &f${name} 加入黑名单`);
    } else if (sub === 'remove' && name) {
      removeBlacklist(name);
      say(`&#99FF99✅ 已将 &f${name} 移出黑名单`);
    } else if (sub === 'list') {
      const names = [..._blacklist];
      if (names.length === 0) {
        say('📋 黑名单为空');
      } else {
        say(`📋 黑名单(${names.length}人)：${names.join(', ')}`);
      }
    } else {
      say('&#FFD700用法：&f>>blacklist add/remove <玩家名> | list');
    }
    return;
  }

  // 其他命令交给 AI 处理
  fallbackAI(username, cmd, false);
}

module.exports = {
  handleAdminCmd, isWhitelisted, isBlacklisted,
  buildProfileInfo, addWhitelist, removeWhitelist,
  addBlacklist, removeBlacklist
};
