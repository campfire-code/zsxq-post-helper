// 信息图：内容全部由用户填写，这里只有版式。解析是纯函数，绘制用浏览器画布（不用 OffscreenCanvas）。
import type { ImageMime } from './core';

export interface TableSpec { title: string; subtitle: string; head: string[]; rows: string[][] }
export interface StepsSpec { title: string; subtitle: string; steps: { title: string; desc: string }[] }

const split = (l: string) => l.split(/[|｜]/).map((x) => x.trim());
const lines = (s: string) => s.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);

/** 第一行是表头，用 | 分列；缺的格补空，多的丢弃 */
export function parseTable(title: string, subtitle: string, text: string): TableSpec {
  const ls = lines(text);
  if (ls.length < 2) throw new Error('对比表至少要有表头一行和数据一行，用 | 分列');
  const head = split(ls[0]);
  if (head.length < 2) throw new Error('表头至少要有两列，用 | 分列');
  const rows = ls.slice(1).map((l) => head.map((_, i) => split(l)[i] ?? ''));
  return { title: title.trim(), subtitle: subtitle.trim(), head, rows };
}

/** 每行一步：「步骤名 | 说明」，说明可省略 */
export function parseSteps(title: string, subtitle: string, text: string): StepsSpec {
  const steps = lines(text).map((l) => { const [t, ...d] = split(l); return { title: t, desc: d.join(' ') }; });
  if (steps.length < 2) throw new Error('流程图至少要有两步，每行一步');
  return { title: title.trim(), subtitle: subtitle.trim(), steps };
}

const C = { bg: '#FFF8F1', ink: '#2B2B2B', sub: '#7A6A5C', accent: '#E8590C', head: '#FDE3CF', zebra: '#FFEFE2', line: '#E7CDB8' };
const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif';
const W = 1200;
const M = 60;

type Ctx = CanvasRenderingContext2D;

function wrap(g: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const ch of para) {
      if (cur && g.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch; } else cur += ch;
    }
    out.push(cur);
  }
  return out;
}

function toPng(c: HTMLCanvasElement): Promise<{ bytes: Uint8Array; mime: ImageMime }> {
  return new Promise((resolve, reject) => c.toBlob(async (b) => {
    if (!b) return reject(new Error('生成图片失败'));
    resolve({ bytes: new Uint8Array(await b.arrayBuffer()), mime: 'image/png' });
  }, 'image/png'));
}

function header(g: Ctx, title: string, subtitle: string): number {
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = C.ink; g.font = `bold 42px ${FONT}`;
  let y = M + 42;
  for (const l of wrap(g, title, W - 2 * M)) { g.fillText(l, W / 2, y); y += 54; }
  if (subtitle) { g.fillStyle = C.accent; g.font = `22px ${FONT}`; g.fillText(subtitle, W / 2, y); y += 40; }
  return y + 14;
}
function headerHeight(g: Ctx, title: string, subtitle: string): number {
  g.font = `bold 42px ${FONT}`;
  return M + 42 + wrap(g, title, W - 2 * M).length * 54 + (subtitle ? 40 : 0) + 14;
}

function canvas(h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = W; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, h);
  return { c, g };
}

export async function renderTable(s: TableSpec) {
  const probe = canvas(10).g;
  const fw = Math.round((W - 2 * M) * (s.head.length > 2 ? 0.28 : 0.4));
  const colW = [fw, ...s.head.slice(1).map(() => (W - 2 * M - fw) / (s.head.length - 1))];
  probe.font = `24px ${FONT}`;
  const rowH = s.rows.map((r) => Math.max(...r.map((t, i) => wrap(probe, t, colW[i] - 36).length)) * 34 + 36);
  const headH = 76;
  const top = headerHeight(probe, s.title, s.subtitle);
  const H = top + headH + rowH.reduce((a, b) => a + b, 0) + M;
  const { c, g } = canvas(H);
  let y = header(g, s.title, s.subtitle);
  g.fillStyle = C.head; g.fillRect(M, y, W - 2 * M, headH);
  g.fillStyle = C.ink; g.font = `bold 26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  let x = M;
  s.head.forEach((t, i) => { g.fillText(t, x + colW[i] / 2, y + headH / 2, colW[i] - 20); x += colW[i]; });
  y += headH;
  s.rows.forEach((r, ri) => {
    if (ri % 2 === 0) { g.fillStyle = C.zebra; g.fillRect(M, y, W - 2 * M, rowH[ri]); }
    let cx = M;
    r.forEach((t, i) => {
      g.font = `${i === 0 ? 'bold ' : ''}24px ${FONT}`; g.fillStyle = C.ink; g.textBaseline = 'alphabetic';
      g.textAlign = i === 0 ? 'left' : 'center';
      const ls = wrap(g, t, colW[i] - 36);
      const y0 = y + (rowH[ri] - ls.length * 34) / 2 + 25;
      ls.forEach((l, k) => g.fillText(l, i === 0 ? cx + 18 : cx + colW[i] / 2, y0 + k * 34));
      cx += colW[i];
    });
    g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath(); g.moveTo(M, y + rowH[ri]); g.lineTo(W - M, y + rowH[ri]); g.stroke();
    y += rowH[ri];
  });
  g.strokeStyle = C.accent; g.lineWidth = 3; g.strokeRect(M, y - rowH.reduce((a, b) => a + b, 0) - headH, W - 2 * M, headH + rowH.reduce((a, b) => a + b, 0));
  return toPng(c);
}

export async function renderSteps(s: StepsSpec) {
  const probe = canvas(10).g;
  probe.font = `22px ${FONT}`;
  const textW = W - 2 * M - 120;
  const boxH = s.steps.map((st) => 28 * 1.6 + (st.desc ? wrap(probe, st.desc, textW).length * 32 : 0) + 40);
  const gap = 44;
  const top = headerHeight(probe, s.title, s.subtitle);
  const H = top + boxH.reduce((a, b) => a + b, 0) + gap * (s.steps.length - 1) + M;
  const { c, g } = canvas(H);
  let y = header(g, s.title, s.subtitle);
  s.steps.forEach((st, i) => {
    const h = boxH[i];
    g.fillStyle = '#FFFFFF'; g.strokeStyle = C.line; g.lineWidth = 2;
    g.beginPath(); g.roundRect(M, y, W - 2 * M, h, 18); g.fill(); g.stroke();
    g.fillStyle = C.accent; g.beginPath(); g.arc(M + 52, y + h / 2, 26, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFFFFF'; g.font = `bold 28px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(i + 1), M + 52, y + h / 2 + 1);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = C.ink; g.font = `bold 28px ${FONT}`;
    let ty = y + 20 + 30;
    g.fillText(st.title, M + 100, ty, textW);
    if (st.desc) { g.font = `22px ${FONT}`; g.fillStyle = C.sub; for (const l of wrap(g, st.desc, textW)) { ty += 32; g.fillText(l, M + 100, ty); } }
    if (i < s.steps.length - 1) {
      const ay = y + h + 6;
      g.fillStyle = C.accent; g.beginPath(); g.moveTo(W / 2 - 14, ay); g.lineTo(W / 2 + 14, ay); g.lineTo(W / 2, ay + 26); g.closePath(); g.fill();
    }
    y += h + gap;
  });
  return toPng(c);
}
