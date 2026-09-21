import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const defaultNotesDir = fileURLToPath(new URL('../src/content/notes/', import.meta.url));
const usage = '用法：npm run import -- <本地.md路径> [--folder <目录名>] [--tags <逗号分隔标签>]';
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function safeFilename(stem) {
  const filename = stem.normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  if (!filename) throw new Error('文件名无有效字符，请重命名 Markdown 文件后重试。');
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(filename)
    ? `note-${filename}`
    : filename;
}

function folderSegments(folder) {
  if (folder === undefined || folder === '') return [];
  if (typeof folder !== 'string' || /^[\\/]/.test(folder) || /^[a-zA-Z]:/.test(folder)) {
    throw new Error('目录必须是笔记目录下的相对路径。');
  }
  const segments = folder.split(/[\\/]/);
  if (segments.some((part) =>
    !part || part === '.' || part === '..' ||
    /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(part)
  )) {
    throw new Error('目录包含无效名称或路径穿越片段。');
  }
  return segments;
}

function normalizeTags(tags) {
  if (tags === undefined) return undefined;
  if (!Array.isArray(tags)) throw new Error('标签格式无效。');
  return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
}

async function ensureSafeDirectory(root, segments) {
  await mkdir(root, { recursive: true });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('笔记目录不能是符号链接或非文件夹。');
  }
  let directory = root;
  for (const segment of segments) {
    directory = join(directory, segment);
    try {
      await mkdir(directory);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('目录中包含符号链接或非文件夹，已停止导入。');
    }
  }
  return directory;
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function withoutFencedCode(markdown) {
  let fenceCharacter;
  let fenceLength = 0;
  return markdown.split(/\r?\n/).map((line) => {
    if (!fenceCharacter) {
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (!opening) return line;
      fenceCharacter = opening[1][0];
      fenceLength = opening[1].length;
      return '';
    }
    const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
    if (closing && closing[1][0] === fenceCharacter && closing[1].length >= fenceLength) {
      fenceCharacter = undefined;
      fenceLength = 0;
    }
    return '';
  }).join('\n');
}

async function collectImages(markdown, source) {
  const images = [];
  const seen = new Set();
  const sourceDirectory = await realpath(dirname(source));
  const imageSyntax = /!\[[^\]\r\n]*\]\(\s*(<[^>\r\n]+>|[^\s)\r\n]+)(?:\s+[^)\r\n]*)?\)/g;
  for (const match of withoutFencedCode(markdown).matchAll(imageSyntax)) {
    const reference = match[1].startsWith('<') ? match[1].slice(1, -1) : match[1];
    if (/^file:/i.test(reference)) throw new Error(`图片路径不能使用本地文件 URL：${reference}`);
    if (/^[a-z][a-z0-9+.-]*:/i.test(reference) && !/^[a-zA-Z]:/.test(reference)) continue;
    if (!reference || /^[\\/]/.test(reference) || /^[a-zA-Z]:/.test(reference) ||
      isAbsolute(reference) || reference.includes('\\') || /[?#%]/.test(reference)) {
      throw new Error(`图片路径必须是相对路径且不能包含查询参数或编码：${reference}`);
    }
    const pathSegments = reference.split('/');
    if (pathSegments.some((part) => !part || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part))) {
      throw new Error(`图片路径不能逃出笔记目录：${reference}`);
    }
    const normalizedSegments = pathSegments.filter((part) => part !== '.');
    if (!normalizedSegments.length || !imageExtensions.has(extname(normalizedSegments.at(-1)).toLowerCase())) {
      throw new Error(`图片格式不受支持：${reference}（支持 png、jpg、jpeg、webp、gif、svg）`);
    }
    const sourceImage = resolve(sourceDirectory, ...normalizedSegments);
    let realImage;
    try {
      realImage = await realpath(sourceImage);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`图片文件不存在：${reference}`);
      throw error;
    }
    const fromSourceDirectory = relative(sourceDirectory, realImage);
    if (fromSourceDirectory === '..' || fromSourceDirectory.startsWith(`..${sep}`) || isAbsolute(fromSourceDirectory)) {
      throw new Error(`图片路径不能逃出笔记目录：${reference}`);
    }
    if (!(await stat(realImage)).isFile()) throw new Error(`图片路径不是文件：${reference}`);
    const key = normalizedSegments.join('/').toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      images.push({ reference, source: realImage, segments: normalizedSegments });
    }
  }
  return images;
}

/** Import one local Markdown file; notesDir can point to another notes collection. */
export async function importNote(sourcePath, { folder, tags, notesDir = defaultNotesDir } = {}) {
  if (!sourcePath || typeof sourcePath !== 'string') {
    throw new Error(`请提供本地 Markdown 文件路径。\n${usage}`);
  }
  if (extname(sourcePath).toLowerCase() !== '.md') {
    throw new Error('只能导入 .md 格式的 Markdown 文件。');
  }
  const segments = folderSegments(folder);
  const selectedTags = normalizeTags(tags);
  const source = resolve(sourcePath);
  let info;
  try {
    info = await stat(source);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`文件不存在：${source}`);
    throw error;
  }
  if (!info.isFile()) throw new Error('输入路径必须指向一个 Markdown 文件。');

  const originalTitle = basename(source, extname(source));
  const filename = `${safeFilename(originalTitle)}.md`;
  const raw = await readFile(source, 'utf8');
  const parsed = matter(raw);
  const metadata = { ...parsed.data };
  const hadFrontmatter = /^\uFEFF?---\s*\r?\n/.test(raw);
  let changed = !hadFrontmatter;
  if (!metadata.title) { metadata.title = originalTitle; changed = true; }
  if (!metadata.date) { metadata.date = today(); changed = true; }
  if (!Object.hasOwn(metadata, 'tags')) { metadata.tags = []; changed = true; }
  if (selectedTags !== undefined) { metadata.tags = selectedTags; changed = true; }
  const output = changed ? matter.stringify(parsed.content, metadata) : raw;

  const images = await collectImages(parsed.content, source);
  const notesRoot = resolve(notesDir);
  const destinationDirectory = join(notesRoot, ...segments);
  const destination = join(destinationDirectory, filename);
  if (await pathExists(destination)) throw new Error(`目标笔记已存在，未覆盖：${destination}`);
  for (const image of images) {
    image.destination = join(destinationDirectory, ...image.segments);
    if (await pathExists(image.destination)) {
      throw new Error(`目标图片已存在，未覆盖：${image.destination}`);
    }
  }
  const copiedImages = [];
  try {
    await ensureSafeDirectory(notesRoot, segments);
    for (const image of images) {
      await ensureSafeDirectory(notesRoot, [...segments, ...image.segments.slice(0, -1)]);
      try {
        await copyFile(image.source, image.destination, constants.COPYFILE_EXCL);
        copiedImages.push(image.destination);
      } catch (error) {
        if (error.code === 'EEXIST') throw new Error(`目标图片已存在，未覆盖：${image.destination}`);
        await unlink(image.destination).catch(() => {});
        throw error;
      }
    }
    try {
      await writeFile(destination, output, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') await unlink(destination).catch(() => {});
      throw error;
    }
  } catch (error) {
    for (const imagePath of copiedImages.reverse()) await unlink(imagePath).catch(() => {});
    if (error.code === 'EEXIST') throw new Error(`目标笔记已存在，未覆盖：${destination}`);
    throw error;
  }
  return destination;
}

function parseArgs(args) {
  if (!args.length || args[0].startsWith('--')) {
    throw new Error(`请提供本地 Markdown 文件路径。\n${usage}`);
  }
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--folder', '--tags'].includes(flag)) throw new Error(`未知参数：${flag}\n${usage}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${flag} 缺少值。\n${usage}`);
    if (flag === '--folder') options.folder = value;
    if (flag === '--tags') options.tags = value.split(',');
  }
  return { sourcePath: args[0], options };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { sourcePath, options } = parseArgs(process.argv.slice(2));
    const destination = await importNote(sourcePath, options);
    console.log(`已导入笔记：${destination}`);
  } catch (error) {
    console.error(`导入失败：${error.message}`);
    process.exitCode = 1;
  }
}
