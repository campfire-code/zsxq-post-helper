// 主界面：左边登录、选星球、AI 配图与信息图，右边写帖与发布记录。发帖在应用自带的知识星球窗口里完成。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, ImagePlus, LogIn, LogOut, RefreshCw, Send, Sparkles, Trash2, X } from 'lucide-react';
import type { CustomTool } from '../kit/types';
import { httpFetch, openLink, pickFiles, settingsStore } from '../kit/platform';
import { useDroppedFiles } from '../kit/parts';
import { EMPTY_IMAGE_CONFIG, generateImage, imageReady, type ImageConfig } from './ai';
import { createBridge, type BridgeIo } from './bridge';
import { MAX_IMAGE_BYTES, charCount, parseBlocks, postTitle, sniffMime, toPostText, type Block, type ImageMime, type Inline } from './core';
import { publishPost, type GroupInfo } from './flow';
import { parseSteps, parseTable, renderSteps, renderTable } from './infographic';
import { addRecord, normalizeRecords, topicLink, type PostRecord } from './records';
import './tool.css';

type Ctx = Parameters<CustomTool['Main']>[0]['ctx'];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isPreview = typeof location !== 'undefined' && location.pathname.endsWith('preview.html');
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const pad = (n: number) => String(n).padStart(2, '0');
const nowText = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

interface Img { id: string; name: string; mime: ImageMime; bytes: Uint8Array; src: string }
let imgSeq = 0;
const mkImg = (name: string, bytes: Uint8Array, mime: ImageMime): Img => ({ id: `m${Date.now().toString(36)}${imgSeq++}`, name, mime, bytes, src: URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) });

const tauriIo: BridgeIo = {
  async listen(event, cb) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen(event, (e) => cb(e.payload));
  },
  async invoke(cmd, args) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(cmd, args);
  },
};

async function store<T>(key: string, fallback: T): Promise<T> {
  try { return ((await (await settingsStore()).get<T>(key)) ?? fallback); } catch { return fallback; }
}
async function save(key: string, v: unknown) {
  try { await (await settingsStore()).set(key, v); } catch { /* 预览或没有本机存储时忽略 */ }
}

const DEMO_GROUP: GroupInfo = { id: '100000000001', name: '示例星球·周末手作笔记' };
const DEMO_MD = `# 示例：手作新手的第一份工具清单

> 这是演示用的虚构帖子，用来展示编辑与预览。

刚入门手作，不用一次买齐。先备好下面这几样，**够做第一件作品**：

- 一把顺手的剪刀
- 一把30厘米的直尺
- 一卷棉线和两根针

## 第一周怎么练

1. 先在废布上练 *直线缝*
2. 再练转角，注意针距均匀
3. 周末做一件小布袋，拍照打卡

完整清单见对比图，欢迎在评论区交流。`;
const DEMO_TABLE = `项目 | 入门款 | 进阶款\n预算 | 100 元内 | 300 元左右\n适合人群 | 第一次尝试 | 已做过几件作品\n推荐先做 | 小布袋 | 拉链包`;
const DEMO_RECORDS: PostRecord[] = [
  { title: '示例：本周手作打卡汇总', time: '2026-10-25 20:10', link: topicLink('1000000000000001'), group: DEMO_GROUP.name },
  { title: '示例：新手常见的三个针法问题', time: '2026-10-22 09:30', link: topicLink('1000000000000002'), group: DEMO_GROUP.name },
  { title: '示例：材料店逛店清单', time: '2026-10-19 18:45', link: topicLink('1000000000000003'), group: DEMO_GROUP.name },
];

function renderInline(c: Inline[]): React.ReactNode {
  return c.map((x, i) => {
    switch (x.t) {
      case 'text': return x.v;
      case 'bold': return <strong key={i}>{renderInline(x.c)}</strong>;
      case 'em': return <em key={i}>{renderInline(x.c)}</em>;
      case 'code': return <code key={i}>{x.v}</code>;
      case 'link': return <span key={i} className="zp-link" title={x.href}>{renderInline(x.c)}</span>;
    }
  });
}
function Preview({ md }: { md: string }) {
  const blocks = useMemo<Block[]>(() => parseBlocks(md), [md]);
  if (!blocks.length) return <p className="k-muted">预览会显示在这里。</p>;
  return (
    <div className="zp-md">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h': return <p key={i} className={`zp-h zp-h${Math.min(b.level, 3)}`}>{renderInline(b.c)}</p>;
          case 'p': return <p key={i}>{renderInline(b.c)}</p>;
          case 'quote': return <blockquote key={i}>{renderInline(b.c)}</blockquote>;
          case 'code': return <pre key={i}>{b.v}</pre>;
          case 'hr': return <hr key={i} />;
          case 'ul': return <ul key={i}>{b.items.map((it, k) => <li key={k}>{renderInline(it)}</li>)}</ul>;
          case 'ol': return <ol key={i}>{b.items.map((it, k) => <li key={k}>{renderInline(it)}</li>)}</ol>;
        }
      })}
    </div>
  );
}

export function Main({ ctx }: { ctx?: Ctx }) {
  const bridge = useMemo(() => createBridge(tauriIo), []);
  const [groups, setGroups] = useState<GroupInfo[]>(isPreview ? [DEMO_GROUP] : []);
  const [groupId, setGroupId] = useState(isPreview ? DEMO_GROUP.id : '');
  const [md, setMd] = useState(isPreview ? DEMO_MD : '');
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [tab, setTab] = useState<'write' | 'records'>('write');
  const [images, setImages] = useState<Img[]>([]);
  const [records, setRecords] = useState<PostRecord[]>(isPreview ? DEMO_RECORDS : []);
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string; link?: string } | null>(null);
  const [aiCfg, setAiCfg] = useState<ImageConfig>(EMPTY_IMAGE_CONFIG);
  const [aiPrompt, setAiPrompt] = useState('');
  const [info, setInfo] = useState({ kind: 'table' as 'table' | 'steps', title: '', subtitle: '', body: '' });
  const [sniff, setSniff] = useState(false);
  const [net, setNet] = useState<string[]>([]);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // 读回本机保存的内容
  useEffect(() => {
    if (isPreview) return;
    (async () => {
      setAiCfg({ ...EMPTY_IMAGE_CONFIG, ...(await store<Partial<ImageConfig>>('zsxq-image', {})) });
      setRecords(normalizeRecords(await store<unknown>('zsxq-records', [])));
      setMd(await store('zsxq-draft', ''));
      setGroupId(await store('zsxq-group', ''));
    })();
  }, []);
  useEffect(() => { if (!isPreview) { const t = setTimeout(() => void save('zsxq-draft', md), 600); return () => clearTimeout(t); } }, [md]);
  useEffect(() => () => { imagesRef.current.forEach((i) => URL.revokeObjectURL(i.src)); bridge.stop(); }, [bridge]);

  // 预览页：放一张虚构的信息图做示例
  useEffect(() => {
    if (!isPreview) return;
    renderTable(parseTable('示例：手作入门两档清单', '示例图，内容为虚构', DEMO_TABLE)).then((r) => setImages([mkImg('示例-对比表.png', r.bytes, r.mime)])).catch(() => {});
    setInfo({ kind: 'table', title: '示例：手作入门两档清单', subtitle: '示例图，内容为虚构', body: DEMO_TABLE });
  }, []);

  // 接口记录（排查用）
  useEffect(() => {
    if (!inTauri) return;
    let off: (() => void) | undefined; let dead = false;
    tauriIo.listen('zs-net', (p) => {
      const r = p as { method: string; path: string; status: number };
      setNet((l) => [`${r.method} ${r.path} → ${r.status || '失败'}`, ...l].slice(0, 20));
    }).then((f) => { if (dead) f(); else off = f; });
    return () => { dead = true; off?.(); };
  }, []);

  const call = async (cmd: string) => {
    if (!inTauri) return setNotice({ kind: 'err', text: '预览模式下不能打开知识星球窗口' });
    try { await tauriIo.invoke(cmd); } catch (e) { setNotice({ kind: 'err', text: errText(e) }); }
  };
  const guard = async (label: string, fn: () => Promise<void>) => {
    if (!inTauri) return setNotice({ kind: 'err', text: '预览模式下不能连接知识星球窗口' });
    setBusy(label); setNotice(null);
    try { await fn(); } catch (e) { setNotice({ kind: 'err', text: errText(e) }); }
    setBusy('');
  };

  const pickGroup = (id: string) => { setGroupId(id); void save('zsxq-group', id); };
  const readGroups = () => guard('读取星球', async () => {
    const list = await bridge.call<GroupInfo[]>('groups');
    setGroups(list);
    if (!list.length) throw new Error('这个账号下没有读到星球');
    if (!list.some((g) => g.id === groupId)) pickGroup(list[0].id);
    setNotice({ kind: 'ok', text: `读到 ${list.length} 个星球，请选择要发到的那一个` });
  });
  const useCurrent = () => guard('读取当前星球', async () => {
    const g = await bridge.call<GroupInfo>('currentGroup');
    setGroups((l) => (l.some((x) => x.id === g.id) ? l : [...l, g]));
    pickGroup(g.id);
    setNotice({ kind: 'ok', text: `已选择窗口当前的星球：${g.name || g.id}` });
  });
  const logout = async () => { await call('clear_zsxq_login'); setGroups([]); pickGroup(''); };

  const addImages = useCallback(async (paths: string[]) => {
    if (!ctx) return;
    const added: Img[] = []; const bad: string[] = [];
    for (const p of paths) {
      const name = p.split(/[\\/]/).pop() ?? p;
      try {
        const bytes = await ctx.readFile(p);
        const mime = sniffMime(bytes);
        if (!mime) bad.push(`${name}（不是 png/jpg/gif/webp）`);
        else if (bytes.length > MAX_IMAGE_BYTES) bad.push(`${name}（超过 10 MB）`);
        else added.push(mkImg(name, bytes, mime));
      } catch { bad.push(`${name}（读取失败）`); }
    }
    if (added.length) setImages((l) => [...l, ...added]);
    if (bad.length) setNotice({ kind: 'err', text: `这些图片没有加入：${bad.join('、')}` });
  }, [ctx]);
  const hover = useDroppedFiles((p) => void addImages(p.filter((x) => /\.(png|jpe?g|gif|webp)$/i.test(x))));
  const removeImage = (id: string) => setImages((l) => { l.filter((i) => i.id === id).forEach((i) => URL.revokeObjectURL(i.src)); return l.filter((i) => i.id !== id); });

  const setAi = (patch: Partial<ImageConfig>) => { const n = { ...aiCfg, ...patch }; setAiCfg(n); void save('zsxq-image', n); };
  const doAi = async () => {
    setBusy('生成图片'); setNotice(null);
    try {
      const r = await generateImage(aiCfg, aiPrompt, httpFetch as never);
      setImages((l) => [...l, mkImg(`AI配图-${l.length + 1}.${r.mime === 'image/jpeg' ? 'jpg' : r.mime.split('/')[1]}`, r.bytes, r.mime)]);
    } catch (e) { setNotice({ kind: 'err', text: errText(e) }); }
    setBusy('');
  };
  const doInfo = async () => {
    setNotice(null);
    try {
      const r = info.kind === 'table' ? await renderTable(parseTable(info.title, info.subtitle, info.body)) : await renderSteps(parseSteps(info.title, info.subtitle, info.body));
      setImages((l) => [...l, mkImg(`信息图-${l.length + 1}.png`, r.bytes, r.mime)]);
    } catch (e) { setNotice({ kind: 'err', text: errText(e) }); }
  };

  const text = useMemo(() => toPostText(md), [md]);
  const title = useMemo(() => postTitle(md), [md]);
  const group = groups.find((g) => g.id === groupId);
  const canPublish = Boolean(text && groupId && !busy);

  const doPublish = async () => {
    setConfirming(false);
    await guard('发布', async () => {
      const r = await publishPost(bridge, { groupId, text, images: images.map((i) => ({ bytes: i.bytes, mime: i.mime })) }, (s) => setBusy(s));
      const link = topicLink(r.topicId);
      const next = addRecord(records, { title: title || '（无标题）', time: nowText(), link, group: group?.name || groupId });
      setRecords(next); void save('zsxq-records', next);
      images.forEach((i) => URL.revokeObjectURL(i.src));
      setImages([]); setMd('');
      setNotice({ kind: 'ok', text: '已发布，草稿已清空，记录已保存到「发布记录」', link });
    });
  };

  const toggleSniff = (on: boolean) => {
    setSniff(on);
    if (!on) setNet([]);
    void bridge.call('sniff', [on]).catch((e) => setNotice({ kind: 'err', text: errText(e) }));
  };

  return (
    <div className="zp-root">

      <main className="zp-main k-scroll">
        <div className="zp-warn" role="note">非官方工具：知识星球没有公开的发帖接口，本工具借用网页版自己的接口，平台改版会失效，也有被平台限制账号的风险。一次只发一篇，发前请确认。</div>
        {notice && (
          <div className={`k-notice ${notice.kind}`} role="status">
            <span className="k-ellipsis">{notice.text}</span>
            {notice.link && <button className="k-link" onClick={() => openLink(notice.link!)}><ExternalLink size={13} />打开帖子</button>}
          </div>
        )}
        <div className="k-seg zp-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'write'} className={tab === 'write' ? 'on' : ''} onClick={() => setTab('write')}>写帖</button>
          <button role="tab" aria-selected={tab === 'records'} className={tab === 'records' ? 'on' : ''} onClick={() => setTab('records')}>发布记录（{records.length}）</button>
        </div>

        {tab === 'write' && (
          <>
            <section className="k-panel zp-card">
              <div className="zp-card-hd">
                <div className="k-seg" role="tablist">
                  <button role="tab" aria-selected={view === 'edit'} className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')}>编辑</button>
                  <button role="tab" aria-selected={view === 'preview'} className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>预览</button>
                </div>
                <span className="k-muted zp-count">{charCount(text)} 字 · {images.length} 张图</span>
              </div>
              {view === 'edit'
                ? <textarea className="k-textarea zp-editor" aria-label="帖子正文（Markdown）" placeholder="用 Markdown 写正文：# 标题、**加粗**、- 列表、> 引用。发布时会转成纯文字。" value={md} onChange={(e) => setMd(e.target.value)} />
                : <div className="zp-preview k-scroll"><Preview md={md} /></div>}
              <small className="k-muted">知识星球帖子正文按纯文字发送：发布时标题会写成【标题】，列表写成「· 」，加粗、链接等标记会去掉。图片不能插在文字中间，会附在帖子后面。</small>
            </section>
            <section className={`k-panel zp-card${hover ? ' zp-hover' : ''}`}>
              <div className="zp-card-hd">
                <b>图片（{images.length}）</b>
                <button className="k-btn ghost" onClick={async () => addImages(await pickFiles(['png', 'jpg', 'jpeg', 'gif', 'webp'], '图片').catch(() => []))}><ImagePlus size={14} />添加图片</button>
              </div>
              {images.length === 0 && <p className="k-muted zp-p">可以把图片拖进窗口，或点「添加图片」；也可以用左边的 AI 配图、信息图生成。张数上限以平台为准（未核实）。</p>}
              <div className="zp-imgs">
                {images.map((im, i) => (
                  <figure key={im.id} className="zp-img">
                    <img src={im.src} alt={im.name} />
                    <figcaption className="k-ellipsis" title={im.name}>{i + 1}. {im.name}</figcaption>
                    <button className="k-icon-btn zp-x" aria-label={`移除 ${im.name}`} onClick={() => removeImage(im.id)}><X size={13} /></button>
                  </figure>
                ))}
              </div>
            </section>
            <div className="zp-pub">
              <button className="k-btn primary" disabled={!canPublish} onClick={() => setConfirming(true)}><Send size={14} />{busy || '发布…'}</button>
              <span className="k-muted">{!groupId ? '先在左边选择星球' : !text ? '先写正文' : `将发到「${group?.name || groupId}」`}</span>
            </div>
          </>
        )}

        {tab === 'records' && (
          <section className="k-panel zp-card">
            <p className="k-muted zp-p">只保存标题、发布时间、链接和星球名，存在本机。链接是按网页版地址格式拼的，平台改版后可能打不开（未核实）。</p>
            {records.length === 0 && <p className="k-muted">还没有发布记录。</p>}
            <table className="k-table">
              {records.length > 0 && <thead><tr><th>标题</th><th>星球</th><th>时间</th><th /></tr></thead>}
              <tbody>
                {records.map((r, i) => (
                  <tr key={i}>
                    <td>{r.title}</td><td>{r.group}</td><td className="k-num">{r.time}</td>
                    <td className="zp-ops">
                      <button className="k-link" onClick={() => openLink(r.link)}><ExternalLink size={13} />打开</button>
                      <button className="k-icon-btn" aria-label="删除这条记录" onClick={() => { const n = records.filter((_, k) => k !== i); setRecords(n); void save('zsxq-records', n); }}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>

      <aside className="k-panel zp-side k-scroll">
        <section className="zp-sec">
          <b>1. 登录知识星球</b>
          <p className="k-muted zp-p">在应用自带的窗口里用知识星球 App 扫码登录。登录状态只保存在本应用的窗口里，不读取你的浏览器，本工具也不读取、不保存 Cookie。</p>
          <div className="zp-btns">
            <button className="k-btn primary" onClick={() => call('open_zsxq')}><LogIn size={14} />打开知识星球窗口</button>
            <button className="k-btn ghost" title="清除本应用里保存的知识星球登录状态" onClick={logout}><LogOut size={14} />退出登录</button>
          </div>
        </section>
        <section className="zp-sec">
          <b>2. 选择要发到的星球</b>
          <div className="zp-btns">
            <button className="k-btn primary" disabled={!!busy} onClick={readGroups}><RefreshCw size={14} />读取我的星球</button>
            <button className="k-btn ghost" disabled={!!busy} onClick={useCurrent}>使用窗口当前星球</button>
          </div>
          <select className="k-input" aria-label="发到哪个星球" value={groupId} onChange={(e) => pickGroup(e.target.value)} disabled={!groups.length}>
            {!groups.length && <option value="">还没有选择星球</option>}
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name || g.id}</option>)}
          </select>
          <small className="k-muted">读取不到时，先在知识星球窗口里点进那个星球，再点「使用窗口当前星球」。</small>
        </section>
        <details className="zp-sec zp-det">
          <summary><b>AI 配图（可选）</b></summary>
          <p className="k-muted zp-p">填你自己的图像模型接口（兼容 OpenAI 图像接口，地址写到 /v1 这一级）。密钥只保存在本机。</p>
          <label className="zp-f"><span>接口地址</span><input className="k-input" value={aiCfg.baseUrl} placeholder="https://…/v1" onChange={(e) => setAi({ baseUrl: e.target.value })} /></label>
          <label className="zp-f"><span>密钥</span><input className="k-input" type="password" value={aiCfg.apiKey} onChange={(e) => setAi({ apiKey: e.target.value })} /></label>
          <label className="zp-f"><span>模型名</span><input className="k-input" value={aiCfg.model} onChange={(e) => setAi({ model: e.target.value })} /></label>
          <label className="zp-f"><span>图片尺寸</span><input className="k-input" value={aiCfg.size} placeholder="1024x1024" onChange={(e) => setAi({ size: e.target.value })} /></label>
          <textarea className="k-textarea" rows={3} placeholder="用一句话描述想要的图" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} />
          <button className="k-btn primary" disabled={!!busy || !imageReady(aiCfg) || !aiPrompt.trim()} onClick={doAi}><Sparkles size={14} />生成并加入图片</button>
        </details>
        <details className="zp-sec zp-det">
          <summary><b>信息图（对比表 / 流程图）</b></summary>
          <p className="k-muted zp-p">内容自己填，工具只负责排版成图片，加入帖子的图片里。</p>
          <div className="k-seg" role="tablist">
            <button role="tab" aria-selected={info.kind === 'table'} className={info.kind === 'table' ? 'on' : ''} onClick={() => setInfo({ ...info, kind: 'table' })}>对比表</button>
            <button role="tab" aria-selected={info.kind === 'steps'} className={info.kind === 'steps' ? 'on' : ''} onClick={() => setInfo({ ...info, kind: 'steps' })}>流程图</button>
          </div>
          <label className="zp-f"><span>标题</span><input className="k-input" value={info.title} onChange={(e) => setInfo({ ...info, title: e.target.value })} /></label>
          <label className="zp-f"><span>副标题</span><input className="k-input" value={info.subtitle} onChange={(e) => setInfo({ ...info, subtitle: e.target.value })} /></label>
          <textarea className="k-textarea" rows={5} value={info.body} onChange={(e) => setInfo({ ...info, body: e.target.value })}
            placeholder={info.kind === 'table' ? '第一行是表头，用 | 分列，例如：\n项目 | 方案甲 | 方案乙\n价格 | 低 | 高' : '每行一步，用 | 分开步骤名和说明，例如：\n准备材料 | 列出清单\n动手做 | 按步骤来'} />
          <button className="k-btn primary" disabled={!info.body.trim() || !info.title.trim()} onClick={doInfo}>生成并加入图片</button>
        </details>
        <details className="zp-sec zp-det">
          <summary><b>排查（可选）</b></summary>
          <label className="zp-row"><input type="checkbox" checked={sniff} onChange={(e) => toggleSniff(e.target.checked)} />记录知识星球窗口发出的请求</label>
          <small className="k-muted">只记录请求方法、路径和状态码，不记录内容和登录信息。平台改版后发帖失败时，用它看哪一步的接口变了。</small>
          {net.length > 0 && <ul className="zp-log">{net.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </details>
      </aside>

      {confirming && (
        <div className="zp-modal" role="dialog" aria-modal="true" aria-label="确认发布">
          <div className="k-panel zp-dialog">
            <h3>确认发布这一篇？</h3>
            <p>发到星球：<b>{group?.name || groupId}</b>　·　{charCount(text)} 字　·　{images.length} 张图</p>
            <pre className="zp-final k-scroll">{text}</pre>
            <small className="k-muted">发出后只能到知识星球里删除或修改，本工具不能撤回。</small>
            <div className="zp-btns">
              <button className="k-btn ghost" onClick={() => setConfirming(false)}>再改改</button>
              <button className="k-btn primary" onClick={doPublish}><Send size={14} />确认发布</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
