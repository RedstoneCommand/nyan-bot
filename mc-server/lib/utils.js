// ===================================================================
//  工具模块 — 通用函数（不依赖 bot 实例的纯逻辑）
// ===================================================================

const config = require('./config');

// ---- 防刷屏滥用检测 ----
const cooldownAbuse = new Map();
const tempBlacklist = new Map();

function recordCooldownHit(username) {
  const name = username.toLowerCase();
  const now = Date.now();
  if (!cooldownAbuse.has(name)) cooldownAbuse.set(name, []);
  const hits = cooldownAbuse.get(name);
  hits.push(now);
  const cutoff = now - config.ABUSE_WINDOW;
  while (hits.length > 0 && hits[0] < cutoff) hits.shift();
  if (hits.length >= config.ABUSE_THRESHOLD) {
    const until = now + config.ABUSE_BAN_DURATION;
    tempBlacklist.set(name, until);
    console.log(`[ABUSE] ${username} 触发冷却 ${hits.length} 次/5秒，拉黑 60秒`);
    cooldownAbuse.delete(name);
    setTimeout(() => { tempBlacklist.delete(name); }, config.ABUSE_BAN_DURATION);
    return true;
  }
  return false;
}

function isTempBlacklisted(username) {
  const name = username.toLowerCase();
  const until = tempBlacklist.get(name);
  if (!until) return false;
  if (Date.now() >= until) { tempBlacklist.delete(name); return false; }
  return true;
}

// ---- 玩家查找 ----
function findPlayer(name) {
  const bot = config.getBot();
  if (!bot || !bot.players) return null;
  const lower = name.toLowerCase();
  for (const [id, player] of Object.entries(bot.players)) {
    if (id.toLowerCase() === lower) return player;
  }
  // 模糊匹配
  for (const [id, player] of Object.entries(bot.players)) {
    if (id.toLowerCase().includes(lower) || lower.includes(id.toLowerCase())) return player;
  }
  return null;
}

// ---- 武器伤害判断 ----
function getWeaponDamage(item) {
  if (!item) return 1;
  const name = item.name || '';
  // 剑类
  if (name.includes('sword')) {
    if (name.includes('netherite')) return 8;
    if (name.includes('diamond')) return 7;
    if (name.includes('iron')) return 6;
    if (name.includes('stone')) return 5;
    if (name.includes('gold')) return 4;
    if (name.includes('wood')) return 4;
    return 4;
  }
  // 斧类
  if (name.includes('axe')) {
    if (name.includes('netherite')) return 10;
    if (name.includes('diamond')) return 9;
    if (name.includes('iron')) return 8;
    if (name.includes('stone')) return 7;
    if (name.includes('gold') || name.includes('wood')) return 6;
    return 6;
  }
  // 三叉戟
  if (name.includes('trident')) return 9;
  // 镐/锹/锄 一般伤害不高
  if (name.includes('pickaxe') || name.includes('shovel') || name.includes('hoe')) return 3;
  // 弓/弩/其他
  if (name.includes('bow')) return 1;
  if (name.includes('crossbow')) return 1;
  // 魔杖
  if (name.includes('mace') || name.includes('wand') || name.includes('staff')) return 6;
  return 1;
}

// ---- 选择最佳武器 ----
async function selectBestWeapon() {
  const bot = config.getBot();
  if (!bot || !bot.inventory) return null;
  let bestItem = null;
  let bestDamage = 0;
  for (const item of bot.inventory.items()) {
    const dmg = getWeaponDamage(item);
    if (dmg > bestDamage) { bestDamage = dmg; bestItem = item; }
  }
  if (bestItem) {
    try { await bot.equip(bestItem, 'hand'); } catch (e) { return null; }
  }
  return bestItem;
}

// ---- 装备最佳护甲 ----
async function equipBestArmor() {
  const bot = config.getBot();
  if (!bot || !bot.inventory) return;
  const armorSlots = ['head', 'torso', 'legs', 'feet'];
  for (const slot of armorSlots) {
    let best = null;
    let bestProt = 0;
    for (const item of bot.inventory.items()) {
      if (!item.name) continue;
      let prot = 0;
      if (item.name.includes('helmet') && slot === 'head') prot = item.name.includes('netherite') ? 3 : item.name.includes('diamond') ? 3 : item.name.includes('iron') ? 2 : 1;
      if (item.name.includes('chestplate') && slot === 'torso') prot = item.name.includes('netherite') ? 8 : item.name.includes('diamond') ? 8 : item.name.includes('iron') ? 6 : 3;
      if (item.name.includes('leggings') && slot === 'legs') prot = item.name.includes('netherite') ? 6 : item.name.includes('diamond') ? 6 : item.name.includes('iron') ? 5 : 2;
      if (item.name.includes('boots') && slot === 'feet') prot = item.name.includes('netherite') ? 3 : item.name.includes('diamond') ? 3 : item.name.includes('iron') ? 2 : 1;
      if (prot > bestProt) { bestProt = prot; best = item; }
    }
    if (best) { try { await bot.equip(best, slot); } catch (e) {} }
  }
}

// ---- 窗口光标清理 ----
async function clearCursor(window) {
  const bot = config.getBot();
  if (!window || !window.selectedItem) return;
  for (let s = config.SEARCH_START_SLOT; s < window.slots.length; s++) {
    if (!window.slots[s] || window.slots[s].type === -1) {
      try { await bot.clickWindow(s, 0, 0); return; } catch (e) { return; }
    }
  }
  try { await bot.clickWindow(-999, 0, 0); } catch (e) {}
}

// ---- 批量合成回退 ----
async function bulkCraftFallback(recipe, totalCount, craftingTable) {
  const bot = config.getBot();
  if (!bot) return;
  for (let i = 0; i < totalCount; i++) {
    try {
      await bot.craft(recipe, 1, craftingTable);
    } catch (e) {
      break;
    }
  }
}

module.exports = {
  recordCooldownHit, isTempBlacklisted,
  findPlayer,
  getWeaponDamage, selectBestWeapon, equipBestArmor,
  clearCursor, bulkCraftFallback,
};
