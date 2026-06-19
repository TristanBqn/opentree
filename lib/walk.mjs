import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export async function walkDir(absPath, opts, displayPath = opts.rootName) {
  const isRoot = displayPath === opts.rootName;
  const node = {
    id: opts.nextId(),
    name: isRoot ? displayPath : displayPath.split("/").pop(),
    path: displayPath,
    type: "dir",
    children: [],
  };
  let entries = [];
  try {
    entries = await readdir(absPath, { withFileTypes: true });
  } catch {
    return node; // unreadable dir → empty, never throw
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    if (ent.isDirectory() && opts.exclude.has(ent.name)) continue;
    if (ent.isDirectory() && ent.name.startsWith(".git")) continue;
    const childAbs = join(absPath, ent.name);
    const childDisplay = displayPath + "/" + ent.name;
    if (ent.isDirectory()) {
      node.children.push(await walkDir(childAbs, opts, childDisplay));
    } else if (ent.isFile()) {
      let s;
      try {
        s = await stat(childAbs);
      } catch {
        continue;
      }
      node.children.push({
        id: opts.nextId(),
        name: ent.name,
        path: childDisplay,
        type: "file",
        ext: extOf(ent.name),
        size: s.size,
        mtime: Math.round(s.mtimeMs),
        createdAt: Math.round(s.birthtimeMs || s.ctimeMs),
      });
    }
  }
  return node;
}
