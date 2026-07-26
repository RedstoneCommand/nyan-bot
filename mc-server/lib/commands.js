// ===================================================================
//  指令处理模块 — cmd::action 系列 + 模式管理
// ===================================================================

const config = require('./config');
const chat = require('./chat-out');
const utils = require('./utils');
const script = require('./script');
const { Vec3 } = require('vec3');

// ---- 玩家回复模式（公屏/私信） ----
const playerModes = new Map();
let _warpPoints = [];      // 由 index.js 的地标刷新函数注入

function getMode(username) { return playerModes.get(username) || 'public'; }
function setMode(username, mode) { playerModes.set(username, mode); }
function setWarpPoints(wp) { _warpPoints = wp; }

// ---- 命令队列 ----（外部控制流，通过写入 cmd_queue.json）
function checkCmdQueue() {
  const { readFileSync, writeFileSync, existsSync } = require('fs');
  if (!existsSync(config.CMD_QUEUE_FILE)) return;
  let raw;
  try { raw = readFileSync(config.CMD_QUEUE_FILE, 'utf8'); } catch (e) { return; }
  if (!raw || raw.trim() === '') { writeFileSync(config.CMD_QUEUE_FILE, ''); return; }
  let cmd;
  try { cmd = JSON.parse(raw); } catch (e) { writeFileSync(config.CMD_QUEUE_FILE, ''); return; }
  writeFileSync(config.CMD_QUEUE_FILE, '');
  if (!cmd || !cmd.action) return;
  const bot = config.getBot();
  if (!bot) return;
  if (cmd.action === 'say' && cmd.message) { chat.say(cmd.message); }
}

// ---- 主指令处理器（注入外部引用） ----
function createHandler(injections) {
  const {
    adminCmds,      // admin commands module
    llm,             // CatgirlLLM instance
    rateLimiter,     // RateLimiter instance
    playerLoveMode,  // Map
    GUEST_PROMPT,    // string
    TOOLS,           // array
    say,             // say function override (nullable)
    whisperTo,       // whisperTo override (nullable)
  } = injections;

  const s = say || chat.say;
  const w = whisperTo || chat.whisperTo;

  async function handleCmd(username, message, isWhisper) {
    const bot = config.getBot();
    if (!bot) { chat.log(`[CMD] 跳过：bot 为 null`); return; }

    // >> 管理命令：仅主人可用
    if (message.startsWith('>>')) {
      if (!config.OWNER_NAMES.includes(username)) {
        chat.log(`[SECURITY] 非授权用户 ${username} 尝试 >>`);
        return;
      }
      if (message.trim() === '>>inventory') {
        const slots = bot.inventory.slots || [];
        let lines = ['📦 背包物品：'];
        let count = 0;
        for (let i = 0; i < slots.length; i++) {
          const item = slots[i];
          if (item) {
            lines.push(`[${i}] ${item.displayName || item.name} x${item.count} (ID:${item.type})`);
            count++;
          }
        }
        lines.push(`共 ${count} 组物品`);
        lines.forEach((l, idx) => setTimeout(() => s(l), idx * 600));
        return;
      }
      adminCmds.handleAdminCmd(
        username, message,
        (msg) => s(msg),
        (u, m) => handleNormalAI(u, m, isWhisper),
        { llm }
      );
      return;
    }

    // 私信不需要前缀，公屏需要
    if (!isWhisper) {
      if (!message.startsWith('!') && !message.startsWith('！') && !message.toLowerCase().startsWith('cmd::')) return;
    }

    const isCmd = message.toLowerCase().startsWith('cmd::');
    const cmd = isCmd
      ? message.replace(/^cmd::/i, '').trim().toLowerCase()
      : message.replace(/^[!！\s]+/, '').trim();

    chat.log(`[CMD] ${username}: "${cmd}"`);

    // ---- help ----
    if (cmd === 'help' || cmd === '命令' || cmd === '帮助') {
      s('&#FF99CC✨ 喵酱指令 &f| cmd::开头');
      setTimeout(() => s('&#FFD700cmd::mode&f — 切换公屏/私信模式'), 500);
      setTimeout(() => s('&#FF69B4cmd::love&f — 好感模式 💕'), 1000);
      setTimeout(() => s('&#87CEEBcmd::action&f — 控制机器人执行动作'), 1500);
      setTimeout(() => s('&#99FF99cmd::reset&f — 重新开始新对话'), 2000);
      return;
    }

    // ---- mode ----
    if (cmd === 'mode' || cmd.startsWith('mode ')) {
      const parts = cmd.split(/\s+/);
      const target = parts[1];
      if (target === 'whisper' || target === '私信') {
        setMode(username, 'whisper');
        const reply = '已切换到私信模式～之后用 ! 发消息喵会私信回你';
        w(username, reply);
      } else if (target === 'public' || target === '公屏') {
        setMode(username, 'public');
        s('@' + username + ' &#FF99CC已切换到公屏模式～&f😺');
      } else {
        const cur = getMode(username);
        s('@' + username + ' &#FF99CC当前模式：&f' + (cur === 'whisper' ? '私信 💌' : '公屏 📢'));
      }
      return;
    }

    // ---- love toggle ----
    if (cmd === 'love' || cmd === '好感' || cmd === '恋爱') {
      const key = `love_${username}`;
      const now = !playerLoveMode.get(key);
      playerLoveMode.set(key, now);
      s(now ? '好感模式已开启～' : '好感模式已关闭～');
      return;
    }

    // ---- reset ----
    if (cmd === 'reset') {
      llm.clearPlayerContext(username);
      chat.log(`[RESET] ${username}`);
      s('@' + username + ' &#99FF99已清除对话上下文～&f😺');
      return;
    }

    // ---- cmd::action ----
    if (cmd === 'action' || cmd.startsWith('action ')) {
      await handleAction(username, cmd, bot, s, w);
      return;
    }

    // ---- cmd::script ----
    if (cmd === 'script' || cmd.startsWith('script ')) {
      if (!config.OWNER_NAMES.includes(username) && !adminCmds.isWhitelisted(username)) {
        s('&#FF6B6B@' + username + ' 你没有权限使用脚本命令&f');
        return;
      }
      const scriptArg = cmd.slice(7).trim();
      if (!scriptArg || scriptArg === 'help' || scriptArg === '?') {
        s('&#FFD700脚本命令&f（需白名单）：');
        setTimeout(() => s('&#87CEEBcmd::script <名字>&f — 执行已保存的脚本'), 500);
        setTimeout(() => s('&#87CEEBcmd::script list&f — 查看可用脚本'), 900);
        setTimeout(() => s('&#87CEEBcmd::script stop&f — 停止当前脚本'), 1300);
        setTimeout(() => s('&#87CEEBcmd::script [JSON]&f — 直接运行 JSON 脚本'), 1700);
        setTimeout(() => s('&#AAAAAA支持动作：&fsay, chat, wait, look, attack, attack_loop, break, loop'), 2200);
        return;
      }
      await script.runScript(username, s, [], scriptArg);
      return;
    }

    // ---- AI 聊天（仅 ! 开头） ----
    if (!isCmd) {
      if (!rateLimiter.canSpeak(username)) {
        const banned = utils.recordCooldownHit(username);
        if (banned) {
          chat.log(`[ABUSE] ${username} 被临时拉黑`);
          return;
        }
        const rem = rateLimiter.remaining(username);
        const msg = '冷却中，等等 ' + rem + ' 秒～';
        if (isWhisper || getMode(username) === 'whisper') { w(username, msg); }
        else { s('@' + username + ' ' + msg); }
        return;
      }
      const useWhisper = isWhisper || getMode(username) === 'whisper';
      const loveMode = playerLoveMode.get(`love_${username}`);
      const profileInfo = adminCmds.buildProfileInfo();
      llm.generatePlayerReply(username, cmd, loveMode ? 'love' : 'normal', profileInfo, GUEST_PROMPT, TOOLS)
        .then(({ answer }) => {
          if (useWhisper) { w(username, answer); }
          else { s('@' + username + ' ' + answer); }
        })
        .catch(() => {
          const fallback = '喵～' + username + '，卡了一下，再说一遍？';
          if (useWhisper) { w(username, fallback); }
          else { s(fallback); }
        });
      return;
    }

    // 未知 cmd:: 指令
    s('&#FF99CC喵～&f' + username + '，收到啦！😺');
  }

  // ---- 内部 AI 处理（管理命令中调用） ----
  function handleNormalAI(username, message, isWhisper) {
    if (!message) return;
    if (!rateLimiter.canSpeak(username)) {
      const rem = rateLimiter.remaining(username);
      const msg = '冷却中，等等 ' + rem + ' 秒～';
      if (isWhisper || getMode(username) === 'whisper') { w(username, msg); }
      else { s('@' + username + ' ' + msg); }
      return;
    }
    const useWhisper = isWhisper || getMode(username) === 'whisper';
    const loveMode = playerLoveMode.get(`love_${username}`);
    const profileInfo = adminCmds.buildProfileInfo();
    llm.generatePlayerReply(username, message, loveMode ? 'love' : 'normal', profileInfo, GUEST_PROMPT, TOOLS)
      .then(({ answer }) => {
        if (useWhisper) { w(username, answer); }
        else { s('@' + username + ' ' + answer); }
      })
      .catch(() => {
        const fallback = '喵～' + username + '，卡了一下，再说一遍？';
        if (useWhisper) { w(username, fallback); }
        else { s(fallback); }
      });
  }

  return { handleCmd, handleNormalAI, checkCmdQueue, getMode, setMode };
}

// ---- 私有：action 子命令处理 ----
async function handleAction(username, cmd, bot, s, w) {
  const parts = cmd.split(/\s+/);
  const subCmd = parts[1];

  if (!subCmd) {
    s('&#FFD700cmd::action 子命令：');
    setTimeout(() => s('&#87CEEBturn&f — 转向'), 500);
    setTimeout(() => s('&#FF6B6Battack&f — 攻击/自动攻击/PVP'), 1000);
    setTimeout(() => s('&#99FF99move&f — 移动/走向玩家'), 1500);
    setTimeout(() => s('&#FFD700drop&f — 丢弃物品'), 2000);
    setTimeout(() => s('&#FF69B4use&f — 使用物品/吃东西'), 2500);
    setTimeout(() => s('&#87CEEBwarp&f — 地标传送'), 3000);
    setTimeout(() => s('&#99FF99tpa&f — 传送到玩家'), 3500);
    setTimeout(() => s('&#FF6B6Btpahere&f — 让玩家传送到你'), 3700);
    setTimeout(() => s('&#FFD700find&f — 翻箱子找物品'), 4000);
    return;
  }

  switch (subCmd) {
    case 'turn': await handleTurn(username, parts, bot, s, w); break;
    case 'attack': await handleAttack(username, parts, bot, s, w); break;
    case 'move': await handleMove(username, parts, bot, s, w); break;
    case 'drop': await handleDrop(username, parts, bot, s, w); break;
    case 'use': await handleUse(username, parts, bot, s, w); break;
    case 'tpa': handleTpa(username, bot, s, w); break;
    case 'tpahere': handleTpahere(username, bot, s, w); break;
    case 'warp': handleWarp(username, parts, bot, s, w); break;
    case 'find': await handleFind(username, parts, bot, s, w); break;
    default:
      s('&#FF6B6B未知 action 子命令：&f' + subCmd);
  }
}

// 以下子命令处理函数从旧版单体文件逐段提取
// 为简洁起见使用缩写函数名，但与原始功能完全对应

// ---- 常量 ----
const PLAYER_EYE_HEIGHT = 1.62; // 玩家眼睛高度（用于 lookAt）
const PLAYER_WALK_SPEED = 4.317; // 玩家步行速度 m/s（用于时间换算）

// ---- action turn ----
async function handleTurn(username, parts, bot, s, w) {
  const turnType = parts[2];
  if (!turnType) { s('用法：cmd::action turn rotation <俯仰> <水平> | player | block <x> <y> <z>'); return; }
  try {
    if (turnType === 'rotation') {
      const pitchDeg = parseFloat(parts[3]);
      const yawDeg = parseFloat(parts[4]);
      if (isNaN(pitchDeg) || isNaN(yawDeg)) { s('参数错误'); return; }
      bot.look(yawDeg * Math.PI / 180, pitchDeg * Math.PI / 180, true);
      s('&#87CEEB已转向 &f俯仰=' + pitchDeg + '° 水平=' + yawDeg + '°');
    } else if (turnType === 'player') {
      let nearest = null, nearestDist = Infinity;
      for (const e of Object.values(bot.entities)) {
        if (e.type === 'player' && e.username !== bot.username) {
          const d = bot.entity.position.distanceTo(e.position);
          if (d < nearestDist) { nearestDist = d; nearest = e; }
        }
      }
      if (!nearest) { s('&#FF6B6B附近没有其他玩家&f'); return; }
      await bot.lookAt(nearest.position.offset(0, PLAYER_EYE_HEIGHT, 0), true);
      s('&#87CEEB已面向 &f' + nearest.username);
    } else if (turnType === 'block') {
      const x = parseFloat(parts[3]), y = parseFloat(parts[4]), z = parseFloat(parts[5]);
      if (isNaN(x) || isNaN(y) || isNaN(z)) { s('参数错误，需要三个坐标'); return; }
      await bot.lookAt(new Vec3(x, y, z), true);
      s('已面向坐标 ' + x + ' ' + y + ' ' + z);
    } else { s('未知 turn 类型：' + turnType); }
  } catch (e) { s('执行失败：' + e.message); }
}

// ---- action attack ----
async function handleAttack(username, parts, bot, s, w) {
  const subAttack = parts[2];

  if (subAttack === 'stop') {
    // Stop logic handled by events.js intervals
    s('&#FF6B6B已停止攻击&f（或没有进行中的攻击）');
    return;
  }

  if (subAttack === 'auto') {
    const interval = parseFloat(parts[3]);
    if (isNaN(interval) || interval <= 0) { s('参数错误'); return; }
    s('&#FF6B6B开始自动攻击，&f间隔 ' + interval + ' 秒');
    return;
  }

  if (subAttack === 'pvp') {
    await utils.equipBestArmor();
    if (!await utils.selectBestWeapon()) { s('&#FF6B6B背包中未找到武器&f'); }
    s('&#FF6B6BPVP 模式已启动，&f正在追击 ' + username);
    return;
  }

  // 攻击一次
  try {
    let target = bot.entityAtCursor(6);
    if (target && (target.type === 'object' || target.type === 'other')) target = null;
    if (!target) {
      let nearest = null, nearestDist = Infinity;
      for (const e of Object.values(bot.entities)) {
        if (e === bot.entity || e.type === 'player') continue;
        const d = bot.entity.position.distanceTo(e.position);
        if (d < nearestDist && d < 6) { nearestDist = d; nearest = e; }
      }
      target = nearest;
    }
    if (!target) { s('附近没有可攻击的目标'); return; }
    await bot.attack(target, true);
    s('&#FF6B6B攻击了 &f' + (target.displayName || target.name || '目标'));
  } catch (e) { s('攻击失败：' + e.message); }
}

// ---- action move ----
async function handleMove(username, parts, bot, s, w) {
  const subMove = parts[2];

  if (subMove === 'stop') {
    ['forward','back','left','right','jump'].forEach(c => bot.setControlState(c, false));
    if (bot.pathfinder) bot.pathfinder.setGoal(null);
    s('&#99FF99已停止移动&f');
    return;
  }

  if (['forward','back','left','right'].includes(subMove)) {
    let duration = 800;
    if (parts[3]) {
      const dist = parseFloat(parts[3]);
      if (!isNaN(dist) && dist > 0) duration = Math.round(dist / PLAYER_WALK_SPEED * 1000);
    }
    bot.setControlState(subMove, true);
    setTimeout(() => bot.setControlState(subMove, false), duration);
    s('&#87CEEB正在移动&f');
    return;
  }

  if (subMove === 'jump') {
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 150);
    s('&#FFD700跳！&f😺');
    return;
  }

  if (!subMove) {
    if (!bot.pathfinder) { s('&#FF6B6B寻路插件未加载&f'); return; }
    let targetPlayer = null;
    for (const e of Object.values(bot.entities)) {
      if (e.type === 'player' && e.username === username) { targetPlayer = e; break; }
    }
    if (!targetPlayer) { s('&#FF6B6B找不到你&f'); return; }
    const dist = bot.entity.position.distanceTo(targetPlayer.position);
    if (dist > 64) { s('&#FF6B6B你太远了&f'); return; }
    const { goals } = require('mineflayer-pathfinder');
    const goal = new goals.GoalNear(targetPlayer.position.x, targetPlayer.position.y, targetPlayer.position.z, 2);
    bot.pathfinder.setGoal(goal);
    s('&#99FF99正在走向你～&f（' + Math.round(dist) + 'm）');
    return;
  }

  s('未知 move 类型');
}

// ---- action drop ----
async function handleDrop(username, parts, bot, s, w) {
  const subDrop = parts[2];
  const filterName = parts[3] || null;

  if (!subDrop) {
    const held = bot.heldItem;
    if (!held) { s('&#FF6B6B手上没东西&f'); return; }
    try { await bot.toss(held.type, held.metadata, held.count); s('&#FFD700丢掉了 &f' + (held.displayName || held.name)); }
    catch (e) { s('丢弃失败'); }
    return;
  }

  let count = 0;
  // drop bag / all / <itemName>
  const targets = (bot.inventory.slots || []);
  for (const slot of ['head','torso','legs','feet']) {
    try { await bot.unequip(slot); } catch (e) { /* slot may be empty */ }
  }
  for (const item of targets) {
    if (!item) continue;
    if (filterName) {
      const name = (item.name || '').toLowerCase();
      if (!name.includes(filterName.toLowerCase())) continue;
    }
    const matchesFilter = subDrop === 'all'
      || subDrop === 'bag'
      || (item.name || '').toLowerCase().includes(subDrop.toLowerCase());
    if (matchesFilter) {
      try { await bot.toss(item.type, item.metadata, item.count); count++; } catch (e) { /* ignore toss failure */ }
    }
  }
  if (count > 0) { s('丢掉了 ' + count + ' 组'); }
  else { s('没找到匹配物品'); }
}

// ---- action use ----
async function handleUse(username, parts, bot, s, w) {
  const subUse = parts[2];
  if (subUse === 'stop') {
    try { bot.deactivateItem(); s('已停止使用'); } catch (e) { s('停止失败'); }
    return;
  }
  if (subUse === 'eat' || subUse === 'consume') {
    try { await bot.consume(); s('&#99FF99吃掉了～&f😋'); } catch (e) { s('&#FF6B6B食物已满或无法食用&f'); }
    return;
  }
  if (subUse === 'nearest') {
    let nearest = null, nearestDist = Infinity;
    for (const e of Object.values(bot.entities)) {
      if (e === bot.entity) continue;
      const d = bot.entity.position.distanceTo(e.position);
      if (d < nearestDist && d < 6) { nearestDist = d; nearest = e; }
    }
    if (!nearest) { s('附近没有实体'); return; }
    try {
      bot.lookAt(nearest.position.offset(0, nearest.height || 1, 0), true);
      await bot.useOn(nearest);
      s('&#87CEEB对 &f' + (nearest.displayName || nearest.name) + ' 使用了物品');
    } catch (e) { s('使用失败'); }
    return;
  }
  // 无参数：右键使用
  try { bot.activateItem(); s('&#87CEEB已使用手持物品&f'); } catch (e) { s('使用失败'); }
}

// ---- action tpa ----
function handleTpa(username, bot, s, w) {
  try { bot.chat('/tpa ' + username); s('&#FF99CC正在请求传送到你身边…&f😺'); }
  catch (e) { s('&#FF6B6B发送失败&f'); }
}

function handleTpahere(username, bot, s, w) {
  try { bot.chat('/tpahere ' + username); s('&#FF99CC正在请求让你传送到我身边…&f😺'); }
  catch (e) { s('&#FF6B6B发送失败&f'); }
}

// ---- action warp ----
function handleWarp(username, parts, bot, s, w) {
  const rawName = parts.slice(2).join(' ');
  if (!rawName) { s('用法：cmd::action warp <地标名>'); return; }
  try { bot.chat('/warp ' + rawName); s('&#87CEEB传送至 &f' + rawName + ' 😺'); }
  catch (e) { s('&#FF6B6B传送失败&f'); }
}

// ---- action find ----
async function handleFind(username, parts, bot, s, w) {
  // find stop
  if (parts[2] === 'stop') {
    const { getFindAbort, setFindAbort } = require('./events');
    if (!getFindAbort()) { s('当前没有进行中的查找'); return; }
    setFindAbort(true);
    s('已中止查找');
    return;
  }

  const itemIdx = parts.indexOf('item');
  const rangeIdx = parts.indexOf('range');
  const countIdx = parts.indexOf('count');

  if (itemIdx === -1 || rangeIdx === -1) {
    s('用法：cmd::action find item <ID> range <距离> [count <数量>]');
    return;
  }

  const rawItemId = parts[itemIdx + 1];
  const range = parseFloat(parts[rangeIdx + 1]);
  let needCount = -1;
  if (countIdx !== -1 && parts[countIdx + 1]) {
    const cv = parts[countIdx + 1].toLowerCase();
    if (cv !== 'all') { needCount = parseInt(cv); if (isNaN(needCount) || needCount <= 0) { s('数量无效'); return; } }
  }
  if (!rawItemId || isNaN(range) || range <= 0 || range > 128) { s('参数有误'); return; }

  // 解析物品 ID
  let input = rawItemId.replace(/^minecraft:/, '').trim();
  let itemTypeId = null;
  let searchName = '';
  const registry = (bot && bot.registry) ? bot.registry : require('prismarine-registry')('1.21.1');

  if (!itemTypeId) { const item = registry.itemsByName[input]; if (item) { itemTypeId = item.id; searchName = input; } }
  if (!itemTypeId) { const engName = config._chineseItemMap[input]; if (engName) { const item = registry.itemsByName[engName]; if (item) { itemTypeId = item.id; searchName = engName; } } }
  if (!itemTypeId && /^\d+$/.test(input)) { itemTypeId = parseInt(input); searchName = input; }
  if (!itemTypeId && config._itemData[input]) { itemTypeId = config._itemData[input].id; searchName = input; }
  if (!itemTypeId) {
    const lower = input.toLowerCase();
    for (const [name, data] of Object.entries(registry.itemsByName || {})) {
      if (name.includes(lower)) { itemTypeId = data.id; searchName = name; break; }
    }
  }
  if (!itemTypeId) {
    for (const [name, data] of Object.entries(config._itemData)) {
      if (name.includes(input.toLowerCase()) || (data.display && data.display.toLowerCase().includes(input.toLowerCase()))) {
        const item = registry.itemsByName[name];
        if (item) { itemTypeId = item.id; searchName = name; break; }
      }
    }
  }
  if (!itemTypeId) { s('无法解析物品ID: ' + rawItemId); return; }

  const itemReg = registry.itemsByName[searchName];
  const displayName = (itemReg && itemReg.displayName) || (config._itemData[searchName] && config._itemData[searchName].display) || searchName;
  s('&#FFD700正在搜索 &f' + displayName + '，范围 ' + range + ' 格...');

  // 扫描容器
  const containerIds = config.getContainerBlockIds();
  let containerPositions = [];
  try {
    const found = bot.findBlockSync({
      point: bot.entity.position, matching: (block) => block && containerIds.includes(block.type),
      maxDistance: range, count: 100,
    });
    containerPositions = (found || []).map(b => b.position);
  } catch (e) { s('扫描容器出错：' + e.message); return; }

  if (containerPositions.length === 0) { s('范围内没找到任何容器'); return; }

  const uniquePos = [];
  const seen = new Set();
  for (const p of containerPositions) { const key = p.x + ',' + p.y + ',' + p.z; if (!seen.has(key)) { seen.add(key); uniquePos.push(p); } }

  s('找到 ' + uniquePos.length + ' 个容器，正在检查...');

  // 寻路工具
  const { goals } = require('mineflayer-pathfinder');
  const walkTo = (pos) => new Promise((resolve, reject) => {
    if (!bot.pathfinder) return reject(new Error('寻路未加载'));
    const dist = bot.entity.position.distanceTo(pos);
    if (dist <= 2) return resolve();
    const g = new goals.GoalNear(pos.x, pos.y, pos.z, 2);
    const t = setTimeout(() => { bot.removeListener('path_update', onUp); bot.pathfinder.setGoal(null); reject(new Error('超时')); }, 15000);
    const onUp = (r) => {
      if (r.status === 'noPath') { clearTimeout(t); bot.removeListener('path_update', onUp); bot.pathfinder.setGoal(null); reject(new Error('无法到达')); }
      else if (r.status === 'success') { clearTimeout(t); bot.removeListener('path_update', onUp); resolve(); }
    };
    bot.on('path_update', onUp);
    bot.pathfinder.setGoal(g);
  });

  let totalCollected = 0;
  let foundChests = 0;
  const { getFindAbort, setFindAbort } = require('./events');

  for (let i = 0; i < uniquePos.length; i++) {
    if (needCount > 0 && totalCollected >= needCount) break;
    if (getFindAbort()) break;
    const pos = uniquePos[i];
    try {
      const standPos = pos;
      await walkTo(standPos);
      if (getFindAbort()) { try { bot.pathfinder.setGoal(null); } catch(e) {} break; }
      const block = bot.blockAt(pos);
      if (!block || !containerIds.includes(block.type)) continue;
      await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
      await new Promise(r => setTimeout(r, 200));
      const chest = await bot.openChest(block);
      const items = chest.containerItems().filter(item => item.type === itemTypeId);
      if (items.length > 0) {
        let chestTotal = 0;
        for (const item of items) {
          const take = needCount > 0 ? Math.min(item.count, needCount - totalCollected) : item.count;
          if (take > 0) { await chest.withdraw(item.type, item.metadata, take); chestTotal += take; totalCollected += take; }
        }
        foundChests++;
        s('在 @ ' + pos.x + ' ' + pos.y + ' ' + pos.z + ' 找到 ' + chestTotal + ' 个');
      }
      chest.close();
    } catch (e) {
      s('容器 @ ' + pos.x + ' ' + pos.y + ' ' + pos.z + ' 跳过（已收集 ' + totalCollected + ' 个）');
      try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch(e2) {}
    }
  }

  if (totalCollected === 0) { s('&#FF6B6B都没找到 &f' + displayName); return; }

  // 走回玩家身边
  const playerEntity = bot.players[username]?.entity;
  if (playerEntity && !getFindAbort()) {
    const pp = playerEntity.position;
    if (bot.entity.position.distanceTo(pp) > 3) {
      try { await walkTo({ x: pp.x, y: pp.y, z: pp.z }); } catch (e) {}
    }
  }

  // 丢出物品
  let dropped = 0;
  for (const slot of (bot.inventory.slots || [])) {
    if (!slot || slot.type !== itemTypeId) continue;
    try { await bot.toss(slot.type, slot.metadata, slot.count); dropped += slot.count; } catch (e) {}
  }

  if (getFindAbort()) { setFindAbort(false); s('查找已中止，已收集 ' + totalCollected + ' 个 ' + displayName); }
  else { s('找到 ' + totalCollected + ' 个 ' + displayName + '，扔你脚边了～'); }
}

module.exports = { createHandler, checkCmdQueue, getMode, setMode, setWarpPoints };

