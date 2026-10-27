// 发布记录：只保存标题、时间、链接、星球名，不保存平台返回的任何他人信息。
export interface PostRecord {
  title: string;
  time: string;
  link: string;
  group: string;
}

/** 帖子链接（网页版详情页地址；平台改版后可能打不开，未核实） */
export const topicLink = (topicId: string) => `https://wx.zsxq.com/dweb2/index/topic_detail/${topicId}`;

export const MAX_RECORDS = 500;

export const addRecord = (list: PostRecord[], r: PostRecord) => [r, ...list].slice(0, MAX_RECORDS);

/** 从本机读回来的内容只保留四个字符串字段，其余一律丢弃 */
export function normalizeRecords(raw: unknown): PostRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: PostRecord[] = [];
  for (const x of raw) {
    const o = (x ?? {}) as Record<string, unknown>;
    if (typeof o.title === 'string' && typeof o.time === 'string' && typeof o.link === 'string') {
      out.push({ title: o.title, time: o.time, link: o.link, group: typeof o.group === 'string' ? o.group : '' });
    }
  }
  return out.slice(0, MAX_RECORDS);
}
