// 发布流程：先逐张上传图片，再发帖。一次只发一篇，失败不自动重试（避免重复发帖）。
import { bytesToBase64, type ImageMime } from './core';
import { TimeoutError, type Bridge } from './bridge';

export interface GroupInfo { id: string; name: string }
export interface UploadImage { bytes: Uint8Array; mime: ImageMime }

export async function publishPost(
  bridge: Pick<Bridge, 'call'>,
  p: { groupId: string; text: string; images: UploadImage[] },
  onStep: (s: string) => void = () => {},
): Promise<{ topicId: string }> {
  if (!p.text.trim()) throw new Error('正文是空的');
  const ids: string[] = [];
  for (let i = 0; i < p.images.length; i++) {
    onStep(`上传图片 ${i + 1}/${p.images.length}`);
    const im = p.images[i];
    try {
      const r = await bridge.call<{ imageId: string }>('uploadImage', [bytesToBase64(im.bytes), im.mime], 120000);
      ids.push(r.imageId);
    } catch (e) {
      throw new Error(`第 ${i + 1} 张图片上传失败，帖子还没有发出：${e instanceof Error ? e.message : e}`);
    }
  }
  onStep('发布中');
  try {
    return await bridge.call<{ topicId: string }>('createTopic', [p.groupId, p.text, ids], 60000);
  } catch (e) {
    if (e instanceof TimeoutError) throw new Error('没有收到平台的回复，帖子有可能已经发出。请先到星球里确认，再决定要不要重发。');
    throw e;
  }
}
