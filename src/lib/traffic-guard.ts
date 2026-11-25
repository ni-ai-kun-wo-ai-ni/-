import { HttpError } from './http-error';

// 单机单进程保护。拒绝过量新请求，不无限排队或清空仍有效的计数。
export class RateLimiter {
  private entries = new Map<string, { count: number; until: number }>();
  constructor(private capacity = 20000) {}
  check(key: string, limit: number, windowMs: number, now = Date.now()) {
    return this.consume(key, 1, limit, windowMs, now);
  }
  consume(key: string, cost: number, limit: number, windowMs: number, now = Date.now()) {
    let entry = this.entries.get(key);
    if (!entry || entry.until <= now) {
      if (this.entries.size >= this.capacity) {
        for (const [id, value] of this.entries) if (value.until <= now) this.entries.delete(id);
        if (this.entries.size >= this.capacity) throw new HttpError(503, '服务繁忙，请稍后重试', 5);
      }
      entry = { count: 0, until: now + windowMs };
      this.entries.set(key, entry);
    }
    if (entry.count + cost > limit)
      throw new HttpError(
        429,
        '操作过于频繁或上传量超过限额，请稍后重试',
        Math.max(1, Math.ceil((entry.until - now) / 1000)),
      );
    entry.count += cost;
  }
}

export class ConcurrencyGate {
  private active = 0;
  private waiting: {
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];
  constructor(
    private limit: number,
    private maxWaiting = 0,
    private waitMs = 10000,
  ) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++;
      return this.releaseHandle();
    }
    if (this.waiting.length >= this.maxWaiting)
      throw new HttpError(503, '当前提交较多，请稍后重试，填写内容仍保留', 3);
    return new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(entry);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(new HttpError(503, '等待处理超时，请稍后重试', 3));
        }, this.waitMs),
      };
      this.waiting.push(entry);
    });
  }
  private releaseHandle() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(this.releaseHandle());
      } else this.active--;
    };
  }
  async run<T>(work: () => Promise<T>) {
    const release = await this.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }
}

const state = globalThis as unknown as {
  gradeTraffic?: {
    rates: RateLimiter;
    requests: ConcurrencyGate;
    uploads: ConcurrencyGate;
    expensive: ConcurrencyGate;
  };
};
export const traffic = (state.gradeTraffic ??= {
  rates: new RateLimiter(),
  requests: new ConcurrencyGate(64),
  uploads: new ConcurrencyGate(3),
  expensive: new ConcurrencyGate(2, 16, 10000),
});

export function sourceKey(request: Request) {
  // 只在本机绑定、经受信任 Cloudflare 隧道转发的部署模式开启。
  const ip =
    process.env.TRUST_CLOUDFLARE_IP === 'true' ? request.headers.get('cf-connecting-ip') : null;
  return ip && /^[a-fA-F0-9:.]{3,64}$/.test(ip) ? ip : 'shared';
}
