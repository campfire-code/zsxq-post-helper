// 用录制（虚构）的接口响应，在假的页面环境里运行注入脚本，验证发帖用的几个函数。不访问真实网络。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (n: string) => readFileSync(new URL(`../../samples/${n}`, import.meta.url), 'utf8');
const code = readFileSync(new URL('../../src-tauri/src/inject.js', import.meta.url), 'utf8');

interface Req { url: string; init?: RequestInit }
function setup(opt: { host?: string; path?: string; routes?: Record<string, () => Response> } = {}) {
  const requests: Req[] = [];
  const events: { event: string; payload: Record<string, unknown> }[] = [];
  const routes: Record<string, () => Response> = {
    'https://api.zsxq.com/v2/groups': () => new Response(read('示例-星球列表响应.json')),
    'https://api.zsxq.com/v2/groups/100000000001': () => new Response('{"succeeded":true,"resp_data":{"group":{"group_id":100000000001,"name":"示例星球·周末手作笔记"}}}'),
    'https://api.zsxq.com/v2/uploads': () => new Response(read('示例-上传令牌响应.json')),
    'https://upload.example.invalid/': () => new Response(read('示例-七牛上传响应.json')),
    'https://api.zsxq.com/v2/groups/100000000001/topics': () => new Response(read('示例-发帖响应.json')),
    ...opt.routes,
  };
  const fetch = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const r = routes[url];
    if (!r) throw new Error('未录制的请求 ' + url);
    return r();
  };
  const XHR = function () {} as unknown as { prototype: { open(): void } };
  XHR.prototype.open = () => {};
  const win: Record<string, unknown> = { fetch, __TAURI_INTERNALS__: { invoke: (_c: string, a: { event: string; payload: Record<string, unknown> }) => events.push(a) } };
  const sandbox = { window: win, location: { hostname: opt.host ?? 'wx.zsxq.com', pathname: opt.path ?? '/group/100000000001', hash: '', href: 'https://wx.zsxq.com/' }, XMLHttpRequest: XHR, Blob, FormData, atob, Uint8Array, URL, JSON, Promise, Object, Error, String, Array, RegExp };
  vm.runInNewContext(code, sandbox);
  const cf = win.__campfire as Record<string, (...a: unknown[]) => void> | undefined;
  const result = async (id: string) => {
    for (let i = 0; i < 50; i++) {
      const e = events.find((x) => x.event === 'zs-result' && x.payload.id === id);
      if (e) return e.payload;
      await new Promise((r) => setTimeout(r, 2));
    }
    throw new Error('没有收到结果');
  };
  return { cf, requests, events, result };
}

describe('注入脚本', () => {
  it('不在 zsxq.com 的页面上什么都不做', () => {
    expect(setup({ host: 'example.com' }).cf).toBeUndefined();
  });
  it('读取星球列表：只回传编号和名称，编号是字符串', async () => {
    const s = setup();
    s.cf!.groups('a1');
    expect(await s.result('a1')).toEqual({ id: 'a1', ok: true, data: [{ id: '100000000001', name: '示例星球·周末手作笔记' }, { id: '100000000002', name: '示例星球·读书打卡' }] });
    expect(s.requests[0].init?.credentials).toBe('include');
  });
  it('窗口当前星球：从页面地址取编号', async () => {
    const s = setup();
    s.cf!.currentGroup('a2');
    expect((await s.result('a2')).data).toEqual({ id: '100000000001', name: '示例星球·周末手作笔记' });
    const s2 = setup({ path: '/dweb2/index' });
    s2.cf!.currentGroup('a3');
    expect((await s2.result('a3')).error).toContain('点进要发帖的星球');
  });
  it('上传图片：先申请凭证再直传，图片编号 17 位不丢精度', async () => {
    const s = setup();
    s.cf!.uploadImage('u1', btoa('png-bytes'), 'image/png');
    expect((await s.result('u1')).data).toEqual({ imageId: '22200000000000011' });
    const [token, up] = s.requests;
    expect(token.url).toBe('https://api.zsxq.com/v2/uploads');
    expect(JSON.parse(String(token.init!.body))).toEqual({ req_data: { type: 'image', size: 9, name: '', hash: '' } });
    expect(up.url).toBe('https://upload.example.invalid/');
    expect((up.init!.body as FormData).get('token')).toBe('示例令牌-不是真实凭证');
  });
  it('发帖：请求体里的编号原样发出；回传里只有帖子编号，没有他人信息', async () => {
    const s = setup();
    s.cf!.createTopic('t1', '100000000001', '正文\n第二行', ['22200000000000011', '22200000000000012']);
    const r = await s.result('t1');
    expect(r.data).toEqual({ topicId: '22200000000000022' });
    const body = String(s.requests[0].init!.body);
    expect(body).toContain('"image_ids":[22200000000000011,22200000000000012]');
    expect(JSON.parse(body.replace(/\d{15,}/g, '"x"')).req_data).toMatchObject({ type: 'topic', text: '正文\n第二行', mentioned_user_ids: [] });
    expect(JSON.stringify(s.events)).not.toMatch(/示例用户|avatar|user_id/);
  });
  it('发帖参数不是数字编号时拒绝，不发请求', async () => {
    const s = setup();
    s.cf!.createTopic('t2', '1/../x', 'a', []);
    expect((await s.result('t2')).error).toBe('星球编号不对');
    s.cf!.createTopic('t3', '100000000001', 'a', ['1,2']);
    expect((await s.result('t3')).error).toBe('图片编号不对');
    expect(s.requests).toHaveLength(0);
  });
  it('登录过期、平台拒绝、返回格式变了，都给出能看懂的原因', async () => {
    const mk = (res: () => Response) => { const s = setup({ routes: { 'https://api.zsxq.com/v2/groups': res } }); s.cf!.groups('g'); return s.result('g'); };
    expect((await mk(() => new Response('{}', { status: 401 }))).error).toContain('重新扫码');
    expect((await mk(() => new Response('{"succeeded":false,"code":1059}'))).error).toBe('平台拒绝了请求（错误码 1059）');
    expect((await mk(() => new Response('<html>'))).error).toContain('可能已改版');
    expect((await mk(() => new Response('{"succeeded":true,"resp_data":{}}'))).error).toContain('使用窗口当前星球');
  });
  it('脚本里没有读取 Cookie 的代码', () => {
    expect(code).not.toMatch(/document\.cookie|cookieStore/);
  });
});
