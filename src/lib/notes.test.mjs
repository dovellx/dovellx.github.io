import test from 'node:test';
import assert from 'node:assert/strict';
import { folderOf, noteHref, folderHref, tagHref, groupByFolder, collectTags, sortNotes } from './notes.mjs';

const notes = [
  { id: 'writing/second', data: { title: '第二篇', date: new Date('2026-09-18'), tags: ['写作', '阅读'] } },
  { id: 'coding/first', data: { title: '第一篇', date: new Date('2026-09-20'), tags: ['阅读'] } },
  { id: 'writing/first', data: { title: '第一篇写作', date: new Date('2026-09-19'), tags: [] } },
];

test('folder follows the nested Markdown path', () => {
  assert.equal(folderOf({ id: 'coding/frontend/css' }), 'coding/frontend');
  assert.equal(folderOf({ id: 'loose-note' }), '未分类');
});

test('links preserve GitHub Pages project base and encode path segments', () => {
  assert.equal(noteHref('/blog/', 'reading/我的 笔记'), '/blog/notes/reading/%E6%88%91%E7%9A%84%20%E7%AC%94%E8%AE%B0/');
  assert.equal(folderHref('/blog/', 'coding/frontend'), '/blog/folders/coding/frontend/');
  assert.equal(tagHref('/', '读书 笔记'), '/tags/%E8%AF%BB%E4%B9%A6%20%E7%AC%94%E8%AE%B0/');
});

test('folders and tags are collected from notes, with newest notes first', () => {
  const folders = groupByFolder(notes);
  assert.deepEqual(folders.map(([name]) => name), ['coding', 'writing']);
  assert.deepEqual(folders.find(([name]) => name === 'writing')[1].map((note) => note.id), ['writing/first', 'writing/second']);
  assert.deepEqual(collectTags(notes), [['阅读', 2], ['写作', 1]]);
  assert.deepEqual(sortNotes(notes).map((note) => note.id), ['coding/first', 'writing/first', 'writing/second']);
});
