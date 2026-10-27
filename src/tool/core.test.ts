import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { base64ToBytes, bytesToBase64, charCount, parseBlocks, postTitle, sniffMime, toPostText } from './core';

const draft = readFileSync(new URL('../../samples/示例-草稿.md', import.meta.url), 'utf8');

describe('Markdown 转帖子正文', () => {
  it('示例草稿转成纯文字', () => {
    const t = toPostText(draft);
    expect(t).toBe([
      '【示例：手作新手的第一份工具清单】',
      '> 这是演示用的虚构帖子。',
      '刚入门手作，不用一次买齐。先备好下面这几样，够做第一件作品：',
      '· 一把顺手的剪刀\n· 一把30厘米的直尺\n· 一卷棉线和两根针',
      '【第一周怎么练】',
      '1. 先在废布上练 直线缝\n2. 再练转角，注意针距均匀\n3. 周末做一件小布袋，拍照打卡',
    ].join('\n\n'));
  });
  it('标题取第一个标题，没有标题取第一行，最多 40 字', () => {
    expect(postTitle(draft)).toBe('示例：手作新手的第一份工具清单');
    expect(postTitle('今天聊聊配色\n第二行')).toBe('今天聊聊配色');
    expect(charCount(postTitle('字'.repeat(60)))).toBe(40);
  });
  it('链接写成「文字（地址）」，行内图片和代码标记被处理', () => {
    expect(toPostText('看[这里](https://example.com/a)，![图](x.png)用 `npm i` 安装')).toBe('看这里（https://example.com/a），用 npm i 安装');
  });
  it('代码块原样保留，分隔线变横线，连续空行压成一个', () => {
    expect(toPostText('```\na  b\n```\n\n\n\n---\n\n结尾')).toBe('a  b\n\n————\n\n结尾');
  });
  it('段落内换行保留；列表与段落分开', () => {
    expect(toPostText('第一行\n第二行\n- 项')).toBe('第一行\n第二行\n\n· 项');
  });
  it('空草稿得到空文字', () => {
    expect(toPostText('  \n\n')).toBe('');
    expect(parseBlocks('')).toEqual([]);
  });
  it('下划线在单词内部不当作斜体', () => {
    expect(toPostText('文件名 a_b_c 不变')).toBe('文件名 a_b_c 不变');
  });
});

describe('图片类型与 base64', () => {
  it('按文件头判断类型', () => {
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]))).toBe('image/png');
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(new TextEncoder().encode('GIF89a....'))).toBe('image/gif');
    expect(sniffMime(new TextEncoder().encode('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(new TextEncoder().encode('hello world!!'))).toBeNull();
  });
  it('大数组 base64 往返不丢字节', () => {
    const b = new Uint8Array(100000).map((_, i) => i % 251);
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });
});
