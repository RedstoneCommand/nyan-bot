/**
 * RateLimiter - 每人 5 秒冷却
 * 超过冷却时间的消息直接丢弃不处理
 */
class RateLimiter {
  constructor(cooldownMs = 5000) {
    this.cooldowns = new Map()
    this.cooldown = cooldownMs
    this._cleanupTimer = setInterval(() => this.cleanup(), 30000)
  }

  /**
   * @param {string} username
   * @returns {boolean} true=可以说话, false=冷却中
   */
  canSpeak(username) {
    if (!username) return false
    const now = Date.now()
    const until = this.cooldowns.get(username.toLowerCase())
    if (until && now < until) {
      return false
    }
    this.cooldowns.set(username.toLowerCase(), now + this.cooldown)
    return true
  }

  /**
   * 获取剩余冷却秒数
   * @param {string} username
   * @returns {number} 0 = 已冷却完毕
   */
  remaining(username) {
    const until = this.cooldowns.get(username.toLowerCase())
    if (!until) return 0
    const rem = Math.ceil((until - Date.now()) / 1000)
    return rem > 0 ? rem : 0
  }

  cleanup() {
    const now = Date.now()
    for (const [name, time] of this.cooldowns) {
      if (time < now - 60000) this.cooldowns.delete(name)
    }
  }

  destroy() {
    clearInterval(this._cleanupTimer)
    this.cooldowns.clear()
  }
}

module.exports = RateLimiter
