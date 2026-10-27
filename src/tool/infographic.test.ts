import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSteps, parseTable } from './infographic';

const read = (n: string) => readFileSync(new URL(`../../samples/${n}`, import.meta.url), 'utf8');

describe('信息图解析', () => {
  it('对比表：第一行表头，缺格补空，多格丢弃', () => {
    const t = parseTable(' 标题 ', '', 'A | B | C\n1 | 2\n3 | 4 | 5 | 6');
    expect(t.title).toBe('标题');
    expect(t.head).toEqual(['A', 'B', 'C']);
    expect(t.rows).toEqual([['1', '2', ''], ['3', '4', '5']]);
  });
  it('示例文件能解析；全角竖线也行', () => {
    expect(parseTable('t', '', read('示例-对比表.txt')).rows).toHaveLength(3);
    expect(parseTable('t', '', 'A｜B\n1｜2').rows).toEqual([['1', '2']]);
    const s = parseSteps('t', '', read('示例-流程.txt'));
    expect(s.steps.map((x) => x.title)).toEqual(['准备材料', '练直线缝', '做小布袋']);
    expect(s.steps[0].desc).toContain('剪刀');
  });
  it('内容太少时报错', () => {
    expect(() => parseTable('t', '', 'A | B')).toThrow('至少要有表头一行和数据一行');
    expect(() => parseTable('t', '', 'A\n1')).toThrow('至少要有两列');
    expect(() => parseSteps('t', '', '只有一步')).toThrow('至少要有两步');
  });
});
