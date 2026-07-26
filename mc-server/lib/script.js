// ===================================================================
//  脚本执行器 — >>script / cmd::script
// ===================================================================

const config = require('./config');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const chat = require('./chat-out');

let _scriptRunning = false;
let _scriptStopRequested = false;

// ---- 执行脚本步骤 ----
async function runScriptSteps(steps, owner, sayFn) {
  _scriptRunning = true;
  _scriptStopRequested = false;
  let loopCount = 0;
  const bot = config.getBot();

  for (let i = 0; i < steps.length; i++) {
    if (_scriptStopRequested) {
      sayFn(`@${owner} 🛑 脚本已停止（${i}/${steps.length} 步）`);
      break;
    }
    const step = steps[i];
    if (!step || !step.action) continue;
    try {
      if (step.action === 'chat' && step.value) {
        bot.chat(step.value);
      } else if (step.action === 'say' && step.value) {
        sayFn(step.value);
      } else if (step.action === 'wait' && typeof step.value === 'number') {
        await new Promise(r => setTimeout(r, step.value));
      } else if (step.action === 'look') {
        const yaw = step.x ?? step.yaw;
        const pitch = step.y ?? step.pitch;
        if (typeof yaw !== 'number' || typeof pitch !== 'number') continue;
        await bot.look(yaw, pitch, true);
      } else if (step.action === 'attack') {
        let target = bot.entityAtCursor(config.ATTACK_DEFAULT_RANGE);
        if (target) await bot.attack(target, true);
      } else if (step.action === 'attack_loop' && typeof step.count === 'number' && typeof step.interval === 'number') {
        for (let a = 0; a < step.count; a++) {
          if (_scriptStopRequested) break;
          let target = bot.entityAtCursor(config.ATTACK_DEFAULT_RANGE);
          if (target) await bot.attack(target, true);
          await new Promise(r => setTimeout(r, step.interval));
        }
      } else if (step.action === 'break') {
        const block = bot.blockAtCursor(config.BLOCK_BREAK_RANGE);
        if (block) await bot.dig(block, true);
      } else if (step.action === 'loop') {
        // loop: 重复执行子步骤 count 次
        if (!step.steps || !Array.isArray(step.steps)) continue;
        for (let l = 0; l < (step.count || 1); l++) {
          if (_scriptStopRequested) break;
          for (const sub of step.steps) {
            if (_scriptStopRequested) break;
            if (!sub || !sub.action) continue;
            if (sub.action === 'wait' && typeof sub.value === 'number') await new Promise(r => setTimeout(r, sub.value));
            else if (sub.action === 'chat' && sub.value) bot.chat(sub.value);
            else if (sub.action === 'say' && sub.value) sayFn(sub.value);
            else if (sub.action === 'attack') { const t = bot.entityAtCursor(6); if (t) await bot.attack(t, true); }
          }
        }
      }
    } catch (e) {
      // 单步失败继续执行
    }
  }
  _scriptRunning = false;
}

function isScriptRunning() { return _scriptRunning; }
function stopScript() { _scriptStopRequested = true; }

// ---- 脚本库 ----
function loadScriptLibrary() {
  try { return JSON.parse(readFileSync(config.SCRIPT_LIB_FILE, 'utf8')); } catch (e) { return {}; }
}

function saveScriptLibrary(lib) {
  try { writeFileSync(config.SCRIPT_LIB_FILE, JSON.stringify(lib, null, 2)); } catch (e) {}
}

// ---- 入口：>>script ----
async function runScript(owner, sayFn, args, rawTail) {
  const bot = config.getBot();
  if (!bot) return;

  if (!rawTail || rawTail === '') {
    if (!existsSync(config.SCRIPT_FILE)) {
      sayFn(`@${owner} ⚠️ 找不到 ${config.SCRIPT_FILE}`);
      return;
    }
    const raw = readFileSync(config.SCRIPT_FILE, 'utf8');
    if (!raw) { sayFn(`@${owner} ⚠️ ${config.SCRIPT_FILE} 为空`); return; }
    let steps;
    try { steps = JSON.parse(raw); } catch (e) { sayFn(`@${owner} ⚠️ JSON 解析失败`); return; }
    if (!Array.isArray(steps) || steps.length === 0) { sayFn(`@${owner} ⚠️ 脚本格式错误`); return; }
    sayFn(`@${owner} 📜 执行 ${config.SCRIPT_FILE}，共 ${steps.length} 步`);
    await runScriptSteps(steps, owner, sayFn);
    if (!_scriptStopRequested) sayFn(`@${owner} ✅ 脚本执行完毕`);
    return;
  }

  const parts = rawTail.split(/\s+/);
  const subCmd = parts[0].toLowerCase();

  if (subCmd === 'save') {
    const name = parts[1];
    if (!name) { sayFn(`@${owner} ⚠️ 用法：>>script save <名字> [JSON]`); return; }
    const rest = rawTail.substring(rawTail.indexOf(parts[0]) + parts[0].length).trim().substring(name.length).trim();
    let steps;
    if (rest) {
      try { steps = JSON.parse(rest); } catch (e) { sayFn(`@${owner} ⚠️ JSON 解析失败`); return; }
    } else {
      if (!existsSync(config.SCRIPT_FILE)) { sayFn(`@${owner} ⚠️ ${config.SCRIPT_FILE} 不存在`); return; }
      try { steps = JSON.parse(readFileSync(config.SCRIPT_FILE, 'utf8')); } catch (e) { sayFn(`@${owner} ⚠️ JSON 解析失败`); return; }
    }
    const lib = loadScriptLibrary();
    lib[name] = steps;
    saveScriptLibrary(lib);
    sayFn(`@${owner} ✅ 已保存脚本 ${name}（${steps.length} 步）`);
    return;
  }

  if (subCmd === 'list') {
    const lib = loadScriptLibrary();
    const names = Object.keys(lib);
    if (names.length === 0) { sayFn(`@${owner} 📋 没有已保存的脚本`); return; }
    sayFn(`📋 已保存的脚本 (${names.length} 个)：`);
    names.forEach((n, i) => {
      const stepCount = lib[n] ? lib[n].length : 0;
      setTimeout(() => sayFn(`${i + 1}. ${n}（${stepCount} 步）`), 500 + i * 300);
    });
    return;
  }

  if (subCmd === 'delete') {
    const name = parts[1];
    if (!name) { sayFn(`@${owner} ⚠️ 用法：>>script delete <名字>`); return; }
    const lib = loadScriptLibrary();
    if (lib[name]) { delete lib[name]; saveScriptLibrary(lib); sayFn(`@${owner} ✅ 已删除脚本 ${name}`); }
    else { sayFn(`@${owner} ⚠️ 未找到脚本 ${name}`); }
    return;
  }

  if (subCmd === 'stop') {
    stopScript();
    sayFn(`@${owner} 🛑 正在请求停止脚本...`);
    return;
  }

  if (subCmd === 'help') {
    sayFn(`📜 脚本命令帮助：`);
    const helps = [
      '>>script — 执行 ${config.SCRIPT_FILE}',
      '>>script <名字> — 执行已保存的脚本',
      '>>script save <名字> [JSON] — 保存脚本',
      '>>script list — 列出所有脚本',
      '>>script delete <名字> — 删除脚本',
      '>>script stop — 停止',
      '>>script [JSON] — 直接传入执行',
    ];
    helps.forEach((h, i) => setTimeout(() => sayFn(h), 500 + i * 400));
    return;
  }

  // 否则尝试执行已保存的脚本或 JSON
  const lib = loadScriptLibrary();
  if (lib[rawTail]) {
    const steps = lib[rawTail];
    sayFn(`@${owner} 📜 执行脚本 ${rawTail}，共 ${steps.length} 步`);
    await runScriptSteps(steps, owner, sayFn);
    if (!_scriptStopRequested) sayFn(`@${owner} ✅ 脚本 "${rawTail}" 执行完毕`);
    return;
  }
  try {
    const steps = JSON.parse(rawTail);
    if (!Array.isArray(steps)) throw new Error('不是数组');
    sayFn(`@${owner} 📜 执行内联脚本，共 ${steps.length} 步`);
    await runScriptSteps(steps, owner, sayFn);
    if (!_scriptStopRequested) sayFn(`@${owner} ✅ 内联脚本执行完毕`);
  } catch (e) {
    sayFn(`@${owner} ❌ 未知脚本命令或 JSON 解析失败: ${e.message}`);
  }
}

module.exports = {
  runScriptSteps, isScriptRunning, stopScript,
  loadScriptLibrary, saveScriptLibrary, runScript,
};
