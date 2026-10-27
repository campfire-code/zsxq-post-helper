// 纯函数：Markdown 草稿解析（预览与转纯文本共用同一棵树）、图片类型判断、字节与 base64 互转。
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold' | 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; c: Inline[]; href: string };

export type Block =
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'hr' };

const INLINE = /!\[[^\]]*\]\([^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\*(?!\s)(.+?)\*|(?<![A-Za-z0-9])_(.+?)_(?![A-Za-z0-9])/g;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    last = m.index + m[0].length;
    if (m[0].startsWith('![')) continue; // 行内图片不进正文；图片请用「插入图片」
    if (m[1] !== undefined) out.push({ t: 'link', c: parseInline(m[1]), href: m[2] });
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ t: 'bold', c: parseInline(m[3] ?? m[4]) });
    else if (m[5] !== undefined) out.push({ t: 'code', v: m[5] });
    else out.push({ t: 'em', c: parseInline(m[6] ?? m[7]) });
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

const LIST = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
      i++;
      blocks.push({ t: 'code', v: buf.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { blocks.push({ t: 'h', level: h[1].length, c: parseInline(h[2]) }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ t: 'quote', c: parseInline(buf.join('\n')) });
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (!m || /\d/.test(m[1]) !== ordered) break;
        items.push(parseInline(m[2]));
        i++;
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !LIST.test(lines[i])) buf.push(lines[i++].trim());
    blocks.push({ t: 'p', c: parseInline(buf.join('\n')) });
  }
  return blocks;
}

export function inlineText(c: Inline[]): string {
  return c.map((x) => {
    switch (x.t) {
      case 'text': case 'code': return x.v;
      case 'bold': case 'em': return inlineText(x.c);
      case 'link': { const t = inlineText(x.c); return t === x.href ? t : `${t}（${x.href}）`; }
    }
  }).join('');
}

/** 知识星球帖子正文按纯文字发送：把 Markdown 标记转成普通文字 */
export function toPostText(md: string): string {
  const parts = parseBlocks(md).map((b) => {
    switch (b.t) {
      case 'h': return b.level <= 2 ? `【${inlineText(b.c)}】` : inlineText(b.c);
      case 'p': return inlineText(b.c);
      case 'quote': return inlineText(b.c).split('\n').map((l) => `> ${l}`).join('\n');
      case 'code': return b.v;
      case 'hr': return '————';
      case 'ul': return b.items.map((it) => `· ${inlineText(it)}`).join('\n');
      case 'ol': return b.items.map((it, n) => `${n + 1}. ${inlineText(it)}`).join('\n');
    }
  });
  return parts.filter((p) => p.trim()).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 记录用的标题：第一个标题，没有就取第一行文字，最多 40 字 */
export function postTitle(md: string): string {
  const blocks = parseBlocks(md);
  const h = blocks.find((b) => b.t === 'h');
  const first = h && h.t === 'h' ? inlineText(h.c) : toPostText(md).split('\n').find((l) => l.trim()) ?? '';
  const t = first.replace(/^【|】$/g, '').trim();
  return [...t].slice(0, 40).join('');
}

export const charCount = (s: string) => [...s].length;

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export function sniffMime(b: Uint8Array): ImageMime | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 单张图片大小上限（经窗口传递，太大容易卡住） */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
