// 工具声明：知识星球发帖助手（在应用自带的窗口里登录知识星球网页版，Markdown 草稿一篇篇发图文帖，发布记录存本机）。
import { Send } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'c36',
  name: '知识星球发帖助手',
  tagline: '扫码登录知识星球后，用 Markdown 写图文帖，确认后一篇篇发布并在本机留记录，可 AI 配图。非官方工具，有平台风险，见说明。',
  icon: Send,
  category: '内容生产',
  type: 'text',
  mode: 'custom',
  mainLabel: '写帖',
  params: [],
  Main: ({ ctx }) => createElement(Main, { ctx }),
};

export default tool;
