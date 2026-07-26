// ===================================================================
//  事件模块 — bot 事件监听（spawn / kicked / chat / message 等）
// ===================================================================

const config = require('./config');
const chat = require('./chat-out');
const utils = require('./utils');
const admin = require('../admin-cmds');

let autoAttackInterval = null;
let pvpInterval = null;
let _findAbort = false;

function getAutoAttackInterval() { return autoAttackInterval; }
function setAutoAttackInterval(v) { autoAttackInterval = v; }
function getPvpInterval() { return pvpInterval; }
function setPvpInterval(v) { pvpInterval = v; }
function getFindAbort() { return _findAbort; }
function setFindAbort(v) { _findAbort = v; }

// ---- 清理所有战斗/动作定时器 ----
function clearIntervals() {
  if (autoAttackInterval) { clearInterval(autoAttackInterval); autoAttackInterval = null; }
  if (pvpInterval) { clearInterval(pvpInterval); pvpInterval = null; }
}

// ---- 注册所有 bot 事件 ----
function registerEvents(bot, handlers) {
  const { handleCmd, onSpawn, onKicked, onEnd, onError } = handlers;

  bot.on('kicked', (r) => {
    const msg = typeof r === 'string' ? r : (r.text || JSON.stringify(r));
    chat.log(`[KICKED] ${msg.substring(0, 100)}`);
    if (autoAttackInterval) { clearInterval(autoAttackInterval); autoAttackInterval = null; }
    if (pvpInterval) { clearInterval(pvpInterval); pvpInterval = null; }
    if (onKicked) { onKicked(); }
  });

  bot.on('error', (e) => {
    if (e.message && !e.message.includes('PartialReadError') && !e.message.includes('Read error')) {
      chat.log(`[ERROR] ${e.message.substring(0, 100)}`);
    }
    if (onError) { onError(e); }
  });

  bot.on('end', () => {
    chat.log('[DISCONNECT] 断开连接');
    if (autoAttackInterval) { clearInterval(autoAttackInterval); autoAttackInterval = null; }
    if (pvpInterval) { clearInterval(pvpInterval); pvpInterval = null; }
    if (onEnd) { onEnd(); }
  });

  bot.on('spawn', () => {
    if (bot._spawnHandled) { return; }
    bot._spawnHandled = true;
    chat.log('[SPAWN] 已生成');
    setTimeout(() => { chat.say('&#FF99CC喵～我上线了！&f😺'); }, 5000);
    // 刷新容器方块 ID
    try {
      if (bot.registry && bot.registry.blocksByName) {
        const ids = new Set();
        for (const [name, block] of Object.entries(bot.registry.blocksByName)) {
          if (name.includes('chest') || name.includes('barrel') || name.includes('shulker_box')) {
            ids.add(block.id);
          }
        }
        if (ids.size > 0) config.setContainerBlockIds([...ids]);
        chat.log(`[CONTAINER] 容器方块 ID 已刷新 (${config.getContainerBlockIds().length} 种)`);
      }
    } catch (e) { chat.log(`[CONTAINER] 刷新失败: ${e.message}`); }

    // 加载寻路插件
    try {
      const { pathfinder: pf } = require('mineflayer-pathfinder');
      bot.loadPlugin(pf);
      chat.log('[PATHFINDER] 已加载');
    } catch (e) { chat.log(`[PATHFINDER] 加载失败: ${e.message}`); }

    // 加载 blockfinder 插件
    try {
      const bf = require('mineflayer-blockfinder')();
      bot.loadPlugin(bf);
      chat.log('[BLOCKFINDER] 已加载');
    } catch (e) { chat.log(`[BLOCKFINDER] 加载失败: ${e.message}`); }

    if (onSpawn) { onSpawn(); }
  });

  // 系统消息监听（AuthMe 登录提示）
  bot.on('messagestr', (text) => {
    if (bot._authDone) { return; }
    const lower = text.toLowerCase();
    if (lower.includes('/login') || lower.includes('/register') || lower.includes('/l ') || lower.includes('注册') || lower.includes('登录')) {
      bot._authDone = true;
      chat.log('[AUTH] 检测到登录提示');
      try { bot.chat('/l ' + config.PASSWORD); chat.log('[AUTH] 已发送 /l'); } catch (e) { /* auth may already be done */ }
    }
  });

  // 聊天消息（旧版，备胎）
  bot.on('chat', (username, message) => {
    if (username === bot.username) { return; }
    if (utils.isTempBlacklisted(username)) { return; }
    if (admin.isBlacklisted(username)) { return; }
    chat.log(`[CHAT_LEGACY] <${username}> ${message}`);
    if (handleCmd) { handleCmd(username, message); }
  });

  bot.on('playerChat', (player, message) => {
    chat.log(`[CHAT_PLAYER] player=${JSON.stringify({name:player?.username, uuid:player?.uuid})} msg="${message}"`);
    if (player && player.username === bot.username) { return; }
    if (utils.isTempBlacklisted(player?.username)) { return; }
    chat.log(`[CHAT] <${player.username}> ${message}`);
    if (handleCmd) { handleCmd(player.username, message); }
  });

  // 自定义聊天格式 — 抄自主服 bot.js 的 message 处理
  function _extractPlayerName(jsonMsg) {
    try {
      const raw = JSON.stringify(jsonMsg);
      const angleMatch = raw.match(/<([^>]+)>/);
      if (angleMatch && angleMatch[1] !== bot.username && angleMatch[1].length < 20) return angleMatch[1];
      const insertMatch = raw.match(/"insertion":"([^"]+)"/);
      if (insertMatch && insertMatch[1] !== bot.username && insertMatch[1].length < 20) return insertMatch[1];
      const hoverMatch = raw.match(/"hover_event"[^}]*"text":"([^"]+)"/);
      if (hoverMatch && hoverMatch[1] !== bot.username && hoverMatch[1].length < 20) return hoverMatch[1];
    } catch (e) {}
    return null;
  }

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString();
    const lower = text.toLowerCase();

    if (lower.includes('joined the game') || lower.includes('left the game')) return;
    if (lower.includes('[chatcolor]')) return;

    // <Player> message 标准格式
    const chatP = text.match(/^<([^>]+)>\s(.+)/);
    if (chatP) {
      if (utils.isTempBlacklisted(chatP[1])) { return; }
      chat.log(`[CHAT] <${chatP[1]}> ${chatP[2]}`);
      if (handleCmd) { handleCmd(chatP[1], chatP[2]); }
      return;
    }

    // 非标准格式（带 ChatColor 前缀等）— 抄主服 bot.js
    if (text.startsWith('>>') || text.startsWith('!') || text.startsWith('！') || text.startsWith('#') || text.startsWith('＃') || text.toLowerCase().startsWith('cmd::')) {
      let player = _extractPlayerName(jsonMsg);
      if (!player && bot.players) {
        const others = Object.keys(bot.players).filter(p => p !== bot.username);
        if (others.length === 1) player = others[0];
        else if (others.length > 1) {
          const ownerNames = config.OWNER_NAMES;
          const found = others.find(p => ownerNames.map(n => n.toLowerCase()).includes(p.toLowerCase()));
          if (found) player = found;
        }
      }
      if (!player) {
        chat.log(`[MSG_DIAG] ⚠️ 无法识别发送者 text="${text.substring(0, 60)}"`);
        chat.log(`[MSG_DIAG] ⚠️ rawJson="${JSON.stringify(jsonMsg).substring(0, 200)}"`);
        return;
      }
      if (utils.isTempBlacklisted(player)) { return; }
      chat.log(`[CHAT] <${player}> ${text}`);
      if (handleCmd) { handleCmd(player, text); }
    }
  });
}

module.exports = {
  registerEvents,
  clearIntervals,
  getAutoAttackInterval, setAutoAttackInterval,
  getPvpInterval, setPvpInterval,
  getFindAbort, setFindAbort,
};
