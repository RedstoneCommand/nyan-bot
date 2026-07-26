/**
 * QuestionQueue - 任务队列
 * - 最大 5 条，满了回复"我有点忙"
 * - FIFO 先进先出
 * - 单线程串行处理
 */
class QuestionQueue {
  constructor(maxSize = 5) {
    this.queue = []
    this.maxSize = maxSize
    this.processing = false
  }

  /**
   * 入队
   * @param {string} username
   * @param {string} question
   * @returns {{ queued: boolean, message?: string }}
   */
  enqueue(username, question) {
    if (this.queue.length >= this.maxSize) {
      return {
        queued: false,
        message: `喵～我现在有点忙，等一下再找我玩好吗？😺`
      }
    }

    this.queue.push({
      username,
      question: question.trim(),
      timestamp: Date.now()
    })
    return { queued: true }
  }

  /** 出队（FIFO） */
  dequeue() {
    return this.queue.shift() || null
  }

  get length() {
    return this.queue.length
  }

  get isEmpty() {
    return this.queue.length === 0
  }

  clear() {
    this.queue = []
  }
}

module.exports = QuestionQueue
