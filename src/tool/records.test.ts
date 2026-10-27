import { describe, expect, it } from 'vitest';
import { MAX_RECORDS, addRecord, normalizeRecords, topicLink } from './records';

describe('发布记录', () => {
  it('新记录排最前，最多保留上限条数', () => {
    let l = [] as ReturnType<typeof normalizeRecords>;
    for (let i = 0; i < MAX_RECORDS + 5; i++) l = addRecord(l, { title: `t${i}`, time: 'x', link: 'y', group: 'g' });
    expect(l).toHaveLength(MAX_RECORDS);
    expect(l[0].title).toBe(`t${MAX_RECORDS + 4}`);
  });
  it('读回时只留四个字段，多余的（比如用户信息）全部丢弃', () => {
    const r = normalizeRecords([{ title: 'a', time: 't', link: 'l', group: 'g', owner: { name: '某人', user_id: 1 } }, { title: 1 }, null]);
    expect(r).toEqual([{ title: 'a', time: 't', link: 'l', group: 'g' }]);
    expect(Object.keys(r[0]).sort()).toEqual(['group', 'link', 'time', 'title']);
  });
  it('非数组返回空', () => { expect(normalizeRecords({})).toEqual([]); });
  it('链接带帖子编号', () => { expect(topicLink('123')).toMatch(/123$/); });
});
