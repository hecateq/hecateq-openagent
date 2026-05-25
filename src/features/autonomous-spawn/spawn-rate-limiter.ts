export interface RateLimitConfig {
  enabled: boolean
  maxSpawnsPerWindow: number
  windowMs: number
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  enabled: true,
  maxSpawnsPerWindow: 20,
  windowMs: 60000,
}

export class SpawnRateLimiter {
  private timestamps: number[] = []
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
  }

  tryAcquire(): boolean {
    if (!this.config.enabled) return true

    this.prune()

    if (this.timestamps.length >= this.config.maxSpawnsPerWindow) {
      return false
    }

    this.timestamps.push(Date.now())
    return true
  }

  getAvailableCount(): number {
    if (!this.config.enabled) return this.config.maxSpawnsPerWindow
    this.prune()
    return Math.max(0, this.config.maxSpawnsPerWindow - this.timestamps.length)
  }

  getUsedCount(): number {
    if (!this.config.enabled) return 0
    this.prune()
    return this.timestamps.length
  }

  reset(): void {
    this.timestamps = []
  }

  private prune(): void {
    const cutoff = Date.now() - this.config.windowMs
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift()
    }
  }
}
