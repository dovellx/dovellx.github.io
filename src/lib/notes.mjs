export function folderOf(note) {
  const parts = note.id.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '未分类';
}

function pathWithBase(base, section, value) {
  const prefix = `/${base.split('/').filter(Boolean).join('/')}`.replace(/^\/$/, '');
  const suffix = value.split('/').map(encodeURIComponent).join('/');
  return `${prefix}/${section}/${suffix}/`;
}

export const noteHref = (base, id) => pathWithBase(base, 'notes', id);
export const folderHref = (base, folder) => pathWithBase(base, 'folders', folder);
export const tagHref = (base, tag) => pathWithBase(base, 'tags', tag);

export function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    const byDate = new Date(b.data.date).getTime() - new Date(a.data.date).getTime();
    return byDate || a.data.title.localeCompare(b.data.title, 'zh-CN');
  });
}

export function groupByFolder(notes) {
  const groups = new Map();
  for (const note of notes) {
    const folder = folderOf(note);
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(note);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
    .map(([name, entries]) => [name, sortNotes(entries)]);
}

export function collectTags(notes) {
  const counts = new Map();
  for (const note of notes) {
    for (const tag of new Set(note.data.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b, 'zh-CN'));
}
