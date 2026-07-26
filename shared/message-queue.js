/**
 * 消息队列 + 输出限速
 * 控制 bot 发送消息的速度，防止刷屏
 * 速度可调，默认每 1.5 秒发送一条（类似于帮助菜单滚动速度）
 */
class MessageQueue {
  constructor(delayMs = 1500) {
    this.queue = []
    this.delay = delayMs
    this._timer = null
    this._sending = false
    this._bot = null
  }

  /** 绑定 bot 实例 */
  setBot(bot) {
    this._bot = bot
  }

  /** 调整发送速度（毫秒） */
  setDelay(ms) {
    this.delay = ms
  }

  /** 往队列加一条消息 */
  enqueue(fn) {
    this.queue.push(fn)
    if (!this._sending) this._start()
  }

  /** 立即发送一条消息（带限速）—— 用于 say() 封装 */
  send(msg) {
    const self = this
    this.enqueue(() => {
      if (!self._bot || typeof self._bot.chat !== 'function') return
      self._bot.chat(msg)
    })
  }

  _start() {
    if (this._timer) clearTimeout(this._timer)
    this._sending = true
    this._next()
  }

  _next() {
    if (this.queue.length === 0) {
      this._sending = false
      return
    }
    const fn = this.queue.shift()
    try { fn() } catch (e) {
      console.error(`[MQ] send error: ${e.message}`)
    }
    this._timer = setTimeout(() => this._next(), this.delay)
  }

  /** 清空队列 */
  clear() {
    this.queue = []
  }

  /** 队列长度 */
  get length() { return this.queue.length }

  destroy() {
    this.clear()
    if (this._timer) clearTimeout(this._timer)
    this._sending = false
    this._bot = null
  }
}

module.exports = MessageQueue
