// 与知识星球窗口的通信：向窗口里的注入脚本发调用，等它用事件回传结果。
export interface BridgeIo {
  /** 监听主窗口事件，返回取消函数 */
  listen(event: string, cb: (payload: unknown) => void): Promise<() => void>;
  /** 调用 Rust 命令 */
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

export class TimeoutError extends Error {}

export function createBridge(io: BridgeIo) {
  const pending = new Map<string, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  let off: (() => void) | null = null;
  let seq = 0;

  async function start() {
    if (off) return;
    off = await io.listen('zs-result', (p) => {
      const r = p as { id: string; ok: boolean; data?: unknown; error?: string };
      const w = pending.get(r.id);
      if (!w) return;
      pending.delete(r.id);
      if (r.ok) w.ok(r.data); else w.fail(new Error(r.error || '窗口里的操作失败'));
    });
  }

  /** 调用注入脚本里的 fn(id, ...args)，超时抛 TimeoutError */
  async function call<T>(fn: string, args: unknown[] = [], timeoutMs = 30000): Promise<T> {
    if (!/^[A-Za-z]+$/.test(fn)) throw new Error('函数名不合法');
    await start();
    const id = `c${Date.now().toString(36)}${(seq++).toString(36)}`;
    const script = `window.__campfire.${fn}(${[id, ...args].map((a) => JSON.stringify(a)).join(',')})`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new TimeoutError('等了很久窗口也没有回复：请确认知识星球窗口还开着、没有停在登录页'));
      }, timeoutMs);
      pending.set(id, { ok: (v) => { clearTimeout(timer); resolve(v as T); }, fail: (e) => { clearTimeout(timer); reject(e); } });
      io.invoke('run_in_zsxq', { script }).catch((e) => {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error(String(e)));
      });
    });
  }

  return { call, stop: () => { off?.(); off = null; } };
}
export type Bridge = ReturnType<typeof createBridge>;
