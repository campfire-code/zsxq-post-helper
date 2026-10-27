import { describe, expect, it } from 'vitest';
import { generateImage, imageReady } from './ai';
import { bytesToBase64 } from './core';

const cfg = { baseUrl: 'https://img.example.invalid/v1/', apiKey: 'k-test', model: 'm', size: '512x512' };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]);
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

describe('AI 配图', () => {
  it('没填设置时给出明确提示', async () => {
    expect(imageReady({ ...cfg, apiKey: '' })).toBe(false);
    await expect(generateImage({ ...cfg, apiKey: '' }, 'x', async () => json({}))).rejects.toThrow('还没有设置图像模型');
  });
  it('按 OpenAI 图像接口发请求，读 b64_json', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const r = await generateImage(cfg, ' 一只猫 ', async (url, init) => { seen = { url, init }; return json({ data: [{ b64_json: bytesToBase64(png) }] }); });
    expect(seen!.url).toBe('https://img.example.invalid/v1/images/generations');
    expect(JSON.parse(String(seen!.init!.body))).toEqual({ model: 'm', prompt: '一只猫', n: 1, size: '512x512' });
    expect((seen!.init!.headers as Record<string, string>).Authorization).toBe('Bearer k-test');
    expect(r.mime).toBe('image/png');
    expect(r.bytes).toEqual(png);
  });
  it('返回的是图片地址时再下载一次', async () => {
    const urls: string[] = [];
    const r = await generateImage(cfg, 'x', async (url) => {
      urls.push(url);
      return url.endsWith('/images/generations') ? json({ data: [{ url: 'https://cdn.example.invalid/a.png' }] }) : new Response(png as BodyInit);
    });
    expect(urls[1]).toBe('https://cdn.example.invalid/a.png');
    expect(r.mime).toBe('image/png');
  });
  it('接口出错时说明原因，错误里不带密钥', async () => {
    const e = await generateImage(cfg, 'x', async () => json({ error: 'bad' }, 401)).catch((x: Error) => x) as Error;
    expect(e.message).toContain('密钥不对');
    expect(e.message).not.toContain('k-test');
  });
  it('返回里没有图片或不是图片时报错', async () => {
    await expect(generateImage(cfg, 'x', async () => json({ data: [] }))).rejects.toThrow('没有返回图片');
    await expect(generateImage(cfg, 'x', async () => json({ data: [{ b64_json: btoa('hello world!!!') }] }))).rejects.toThrow('不是常见图片格式');
  });
});
