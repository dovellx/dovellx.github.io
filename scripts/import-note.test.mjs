import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./import-note.mjs', import.meta.url));

async function withWorkspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'blog-note-import-'));
  try {
    await run({ root, notesDir: join(root, 'notes') });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('CLI explains that a Markdown path is required', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /请提供.*Markdown|用法/);
});

test('imports a plain Markdown note with generated metadata and a safe filename', async () => {
  await withWorkspace(async ({ root, notesDir }) => {
    const source = join(root, 'My first note!.md');
    await writeFile(source, '# Hello\n\nBody.\n', 'utf8');
    const { importNote } = await import('./import-note.mjs');

    const target = await importNote(source, { notesDir, folder: '学习/JavaScript', tags: ['笔记', 'js'] });

    assert.equal(target, join(notesDir, '学习', 'JavaScript', 'My-first-note.md'));
    const content = await readFile(target, 'utf8');
    assert.match(content, /^---\r?\n/);
    assert.match(content, /title: ['"]?My first note!/);
    assert.match(content, /date: ['"]?\d{4}-\d{2}-\d{2}/);
    assert.match(content, /tags:/);
    assert.match(content, /笔记/);
    assert.match(content, /js/);
    assert.match(content, /# Hello\n\nBody\./);
  });
});

test('preserves existing frontmatter fields and overrides tags only when requested', async () => {
  await withWorkspace(async ({ root, notesDir }) => {
    const source = join(root, 'source.md');
    await writeFile(source, '---\ntitle: Custom title\ndate: 2024-02-03\ntags:\n  - old\ndescription: Keep me\n---\n\nNote body.\n', 'utf8');
    const { importNote } = await import('./import-note.mjs');

    const target = await importNote(source, { notesDir, tags: ['new', '中文'] });
    const content = await readFile(target, 'utf8');
    assert.match(content, /title: Custom title/);
    assert.match(content, /description: Keep me/);
    assert.match(content, /date: 2024-02-03/);
    assert.match(content, /new/);
    assert.match(content, /中文/);
    assert.doesNotMatch(content, /\bold\b/);
    assert.doesNotMatch(content, /folder:/);
    assert.match(content, /Note body\./);
  });
});

test('rejects overwrite without changing the existing note', async () => {
  await withWorkspace(async ({ root, notesDir }) => {
    const source = join(root, 'same.md');
    await writeFile(source, 'First version', 'utf8');
    const { importNote } = await import('./import-note.mjs');
    const target = await importNote(source, { notesDir });
    await writeFile(source, 'Second version', 'utf8');

    await assert.rejects(importNote(source, { notesDir }), /已存在/);
    assert.match(await readFile(target, 'utf8'), /First version/);
    assert.doesNotMatch(await readFile(target, 'utf8'), /Second version/);
  });
});

test('rejects non-Markdown input and folder traversal', async () => {
  await withWorkspace(async ({ root, notesDir }) => {
    const textFile = join(root, 'not-markdown.txt');
    const source = join(root, 'good.md');
    await writeFile(textFile, 'text', 'utf8');
    await writeFile(source, 'text', 'utf8');
    const { importNote } = await import('./import-note.mjs');

    await assert.rejects(importNote(textFile, { notesDir }), /\.md|Markdown/);
    await assert.rejects(importNote(source, { notesDir, folder: '../outside' }), /目录|folder/);
    await assert.rejects(importNote(source, { notesDir, folder: '/outside' }), /目录|folder/);
    assert.deepEqual((await readdir(root)).sort(), ['good.md', 'not-markdown.txt']);
  });
});

test('reports a missing local file in Chinese', async () => {
  await withWorkspace(async ({ root, notesDir }) => {
    const { importNote } = await import('./import-note.mjs');
    await assert.rejects(importNote(resolve(root, 'missing.md'), { notesDir }), /文件不存在/);
  });
});

test('copies relative Markdown images and keeps their paths in the imported note', async () => {
  await withWorkspace(async ({ root, notesDir }) => {
    await mkdir(join(root, 'images'));
    await writeFile(join(root, 'cover.png'), 'PNG contents');
    await writeFile(join(root, 'images', 'diagram.svg'), '<svg></svg>');
    const source = join(root, 'illustrated.md');
    const body = '![Cover](./cover.png)\n![Diagram](images/diagram.svg "图")\n![Again](images/diagram.svg)\n';
    await writeFile(source, body);
    const { importNote } = await import('./import-note.mjs');

    const target = await importNote(source, { notesDir, folder: '课件' });

    assert.match(await readFile(target, 'utf8'), /!\[Cover\]\(\.\/cover\.png\)/);
    assert.match(await readFile(target, 'utf8'), /!\[Diagram\]\(images\/diagram\.svg "图"\)/);
    assert.equal(await readFile(join(notesDir, '课件', 'cover.png'), 'utf8'), 'PNG contents');
    assert.equal(await readFile(join(notesDir, '课件', 'images', 'diagram.svg'), 'utf8'), '<svg></svg>');
  });
});

test('missing image aborts before writing the note or other images', async () => {
  await withWorkspace(async ({ root, notesDir }) => {
    await writeFile(join(root, 'present.png'), 'present');
    const source = join(root, 'broken.md');
    await writeFile(source, '![ok](present.png)\n![missing](missing.jpg)\n');
    const { importNote } = await import('./import-note.mjs');

    await assert.rejects(importNote(source, { notesDir }), /图片.*不存在|图片.*找不到/);
    await assert.rejects(readFile(join(notesDir, 'broken.md')));
    await assert.rejects(readFile(join(notesDir, 'present.png')));
  });
});

test('rejects image paths that escape the Markdown file directory', async () => {
  await withWorkspace(async ({ root, notesDir }) => {
    const sourceDir = join(root, 'source');
    await mkdir(sourceDir);
    await writeFile(join(root, 'outside.png'), 'private image');
    const source = join(sourceDir, 'unsafe.md');
    const { importNote } = await import('./import-note.mjs');

    await writeFile(source, '![outside](../outside.png)');
    await assert.rejects(importNote(source, { notesDir }), /图片.*路径|图片.*目录/);
    await writeFile(source, '![absolute](/outside.png)');
    await assert.rejects(importNote(source, { notesDir }), /图片.*路径|图片.*目录/);
    await writeFile(source, '![file URL](file:///outside.png)');
    await assert.rejects(importNote(source, { notesDir }), /图片.*路径|图片.*目录/);
    await assert.rejects(readFile(join(notesDir, 'unsafe.md')));
  });
});

test('does not overwrite an existing image or leave a half-imported note', async () => {
  await withWorkspace(async ({ root, notesDir }) => {
    const source = join(root, 'collision.md');
    await writeFile(source, '![Chart](images/chart.webp)');
    await mkdir(join(root, 'images'));
    await writeFile(join(root, 'images', 'chart.webp'), 'new image');
    await mkdir(join(notesDir, 'images'), { recursive: true });
    const existing = join(notesDir, 'images', 'chart.webp');
    await writeFile(existing, 'existing image');
    const { importNote } = await import('./import-note.mjs');

    await assert.rejects(importNote(source, { notesDir }), /图片.*已存在|资源.*已存在/);
    assert.equal(await readFile(existing, 'utf8'), 'existing image');
    await assert.rejects(readFile(join(notesDir, 'collision.md')));
  });
});

test('ignores image examples inside backtick and tilde code fences', async () => {
  await withWorkspace(async ({ root, notesDir }) => {
    const source = join(root, 'examples.md');
    await writeFile(join(root, 'actual.gif'), 'actual image');
    await writeFile(source, [
      '```markdown',
      '![example](missing.png)',
      '```',
      '~~~md',
      '![another](/absolute.jpg)',
      '~~~',
      '![real](actual.gif)',
      '',
    ].join('\n'));
    const { importNote } = await import('./import-note.mjs');

    const target = await importNote(source, { notesDir });

    assert.match(await readFile(target, 'utf8'), /!\[example\]\(missing\.png\)/);
    assert.equal(await readFile(join(notesDir, 'actual.gif'), 'utf8'), 'actual image');
    await assert.rejects(readFile(join(notesDir, 'missing.png')));
  });
});
