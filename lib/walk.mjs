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
  // stats and sub-walks run concurrently; Promise.all keeps the sorted order
  const children = await Promise.all(
    entries.map(async (ent) => {
      if (ent.isDirectory() && opts.exclude.has(ent.name)) return null;
      if (ent.isDirectory() && ent.name.startsWith(".git")) return null;
      const childAbs = join(absPath, ent.name);
      const childDisplay = displayPath + "/" + ent.name;
      if (ent.isDirectory()) {
        return walkDir(childAbs, opts, childDisplay);
      }
      if (!ent.isFile()) return null;
      let s;
      try {
        s = await stat(childAbs);
      } catch {
        return null;
      }
      return {
        id: opts.nextId(),
        name: ent.name,
        path: childDisplay,
        type: "file",
        ext: extOf(ent.name),
        size: s.size,
        mtime: Math.round(s.mtimeMs),
        createdAt: Math.round(s.birthtimeMs || s.ctimeMs),
      };
    }),
  );
  node.children = children.filter(Boolean);
  return node;
}
