import { describe, expect, it, vi } from 'vitest';
import { TimeoutError, createBridge, type BridgeIo } from './bridge';

function fakeIo(reply?: (script: string, emit: (p: unknown) => void) => void) {
  let cb: (p: unknown) => void = () => {};
  const scripts: string[] = [];
  const io: BridgeIo = {
    async listen(_e, f) { cb = f; return () => {}; },
    async invoke(_c, a) { const s = String(a?.script); scripts.push(s); reply?.(s, cb); return null; },
  };
  return { io, scripts };
}
const idOf = (s: string) => /\("([^"]+)"/.exec(s)![1];

describe('窗口通信', () => {
  it('生成的脚本只调用 window.__campfire，参数按 JSON 传递', async () => {
    const { io, scripts } = fakeIo((s, emit) => emit({ id: idOf(s), ok: true, data: { x: 1 } }));
    const r = await createBridge(io).call('createTopic', ['123', '带"引号"\n换行', ['1', '2']]);
    expect(r).toEqual({ x: 1 });
    expect(scripts[0]).toMatch(/^window\.__campfire\.createTopic\("[^"]+","123","带\\"引号\\"\\n换行",\["1","2"\]\)$/);
  });
  it('窗口回传失败时抛出原因', async () => {
    const { io } = fakeIo((s, emit) => emit({ id: idOf(s), ok: false, error: '未登录' }));
    await expect(createBridge(io).call('groups')).rejects.toThrow('未登录');
  });
  it('不认识的 id 被忽略；超时抛 TimeoutError', async () => {
    vi.useFakeTimers();
    const { io } = fakeIo((_s, emit) => emit({ id: 'other', ok: true, data: 1 }));
    const p = createBridge(io).call('groups', [], 1000);
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
    vi.useRealTimers();
  });
  it('函数名不合法时拒绝', async () => {
    await expect(createBridge(fakeIo().io).call('a(); alert(1)')).rejects.toThrow('函数名不合法');
  });
});
