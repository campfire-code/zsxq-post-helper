import { describe, expect, it } from 'vitest';
import { TimeoutError } from './bridge';
import { publishPost } from './flow';

const img = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]), mime: 'image/png' as const };

function fakeBridge(handlers: Record<string, (args: unknown[]) => unknown>) {
  const calls: { fn: string; args: unknown[] }[] = [];
  return {
    calls,
    call: async <T,>(fn: string, args: unknown[] = []) => { calls.push({ fn, args }); return handlers[fn](args) as T; },
  };
}

describe('发布流程', () => {
  it('先逐张传图，再带着图片编号发帖，步骤依次提示', async () => {
    let n = 0;
    const b = fakeBridge({ uploadImage: () => ({ imageId: `2220000000000000${++n}` }), createTopic: () => ({ topicId: '22200000000000099' }) });
    const steps: string[] = [];
    const r = await publishPost(b, { groupId: '100', text: '正文', images: [img, img] }, (s) => steps.push(s));
    expect(r.topicId).toBe('22200000000000099');
    expect(b.calls.map((c) => c.fn)).toEqual(['uploadImage', 'uploadImage', 'createTopic']);
    expect(b.calls[2].args).toEqual(['100', '正文', ['22200000000000001', '22200000000000002']]);
    expect(steps).toEqual(['上传图片 1/2', '上传图片 2/2', '发布中']);
  });
  it('图片上传失败时不会发帖', async () => {
    const b = fakeBridge({ uploadImage: () => { throw new Error('平台拒绝了请求（错误码 1）'); }, createTopic: () => ({ topicId: '1' }) });
    await expect(publishPost(b, { groupId: '1', text: 'x', images: [img] })).rejects.toThrow('帖子还没有发出');
    expect(b.calls.map((c) => c.fn)).toEqual(['uploadImage']);
  });
  it('发帖超时要提示「可能已发出」，且不自动重试', async () => {
    const b = fakeBridge({ createTopic: () => { throw new TimeoutError('t'); } });
    await expect(publishPost(b, { groupId: '1', text: 'x', images: [] })).rejects.toThrow('有可能已经发出');
    expect(b.calls).toHaveLength(1);
  });
  it('正文为空时拒绝', async () => {
    await expect(publishPost(fakeBridge({}), { groupId: '1', text: '  ', images: [] })).rejects.toThrow('正文是空的');
  });
});
