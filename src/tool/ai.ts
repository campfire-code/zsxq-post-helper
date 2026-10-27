// AI 配图：调用用户自己填写的、兼容 OpenAI 图像接口（POST {接口地址}/images/generations）的服务。不内置任何接口和密钥。
import { base64ToBytes, sniffMime, type ImageMime } from './core';

export interface ImageConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
}
export const EMPTY_IMAGE_CONFIG: ImageConfig = { baseUrl: '', apiKey: '', model: '', size: '1024x1024' };
export const imageReady = (c: ImageConfig) => Boolean(c.baseUrl && c.apiKey && c.model);

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function generateImage(cfg: ImageConfig, prompt: string, f: Fetch): Promise<{ bytes: Uint8Array; mime: ImageMime }> {
  if (!imageReady(cfg)) throw new Error('还没有设置图像模型：请在左侧「AI 配图」里填写接口地址、密钥和模型名');
  if (!prompt.trim()) throw new Error('请先写一句图片描述');
  const res = await f(cfg.baseUrl.replace(/\/+$/, '') + '/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, prompt: prompt.trim(), n: 1, ...(cfg.size ? { size: cfg.size } : {}) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = res.status === 401 ? '密钥不对或已过期' : res.status === 404 ? '接口地址或模型名不对' : res.status === 429 ? '调用太频繁或额度用完' : '接口返回错误';
    throw new Error(`图像模型调用失败（${res.status}，${hint}）${body ? '：' + body.slice(0, 160) : ''}`);
  }
  const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = data.data?.[0];
  let bytes: Uint8Array;
  if (item?.b64_json) bytes = base64ToBytes(item.b64_json);
  else if (item?.url) {
    const img = await f(item.url);
    if (!img.ok) throw new Error(`下载生成的图片失败（${img.status}）`);
    bytes = new Uint8Array(await img.arrayBuffer());
  } else throw new Error('图像模型没有返回图片（返回里既没有 b64_json 也没有 url）');
  const mime = sniffMime(bytes);
  if (!mime) throw new Error('图像模型返回的内容不是常见图片格式');
  return { bytes, mime };
}
