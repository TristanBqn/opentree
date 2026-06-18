// Deterministic, plausible file-preview snippets + meta formatting.

export function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export function formatDate(ts) {
  const d = new Date(ts);
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}
export function relDate(ts) {
  const days = Math.round((Date.UTC(2026, 5, 9) - ts) / 86400000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 30) return 'il y a ' + days + ' j';
  if (days < 365) return 'il y a ' + Math.round(days / 30) + ' mois';
  return 'il y a ' + (days / 365).toFixed(1) + ' an';
}

export const GIT_LABEL = {
  clean: { txt: 'à jour', cls: 'clean' },
  modified: { txt: 'modifié', cls: 'modified' },
  added: { txt: 'ajouté', cls: 'added' },
  untracked: { txt: 'non suivi', cls: 'untracked' },
};

const BIN = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'woff2', 'woff', 'ttf']);
export function isBinary(ext) { return BIN.has(ext); }

function pascal(name) {
  return name.replace(/\.[^.]*$/, '').replace(/(^|[-_.])([a-z])/g, (_, __, c) => c.toUpperCase()).replace(/[-_.]/g, '');
}

export function langOf(ext) {
  return ({ ts: 'TypeScript', tsx: 'TypeScript React', js: 'JavaScript', jsx: 'JavaScript React',
    mjs: 'JavaScript', css: 'CSS', json: 'JSON', md: 'Markdown', sql: 'SQL', yml: 'YAML',
    yaml: 'YAML', sh: 'Shell', ico: 'Icon', svg: 'SVG', png: 'PNG', jpg: 'JPEG', webp: 'WebP',
    woff2: 'Font' })[ext] || 'Texte';
}

export function snippet(file) {
  const ext = file.ext;
  const base = file.name.replace(/\.[^.]*$/, '');
  const C = pascal(base);
  if (isBinary(ext)) return null;
  switch (ext) {
    case 'tsx':
    case 'jsx':
      return `import { useState, useCallback } from 'react';\nimport styles from './${base}.module.css';\n\nexport interface ${C}Props {\n  id: string;\n  active?: boolean;\n  onSelect?: (id: string) => void;\n}\n\nexport function ${C}({ id, active, onSelect }: ${C}Props) {\n  const [hover, setHover] = useState(false);\n  const handle = useCallback(() => onSelect?.(id), [id, onSelect]);\n\n  return (\n    <div\n      className={styles.root}\n      data-active={active}\n      onMouseEnter={() => setHover(true)}\n      onClick={handle}\n    >\n      {/* … */}\n    </div>\n  );\n}`;
    case 'ts':
    case 'js':
    case 'mjs':
      if (base.startsWith('use')) {
        return `import { useEffect, useRef, useState } from 'react';\n\nexport function ${base}(initial?: number) {\n  const [value, setValue] = useState(initial ?? 0);\n  const ref = useRef<number>(value);\n\n  useEffect(() => {\n    ref.current = value;\n  }, [value]);\n\n  return { value, setValue, ref } as const;\n}`;
      }
      return `import { z } from 'zod';\n\nexport const ${C}Schema = z.object({\n  id: z.string().uuid(),\n  name: z.string().min(1),\n  createdAt: z.coerce.date(),\n});\n\nexport type ${C} = z.infer<typeof ${C}Schema>;\n\nexport function parse${C}(input: unknown): ${C} {\n  return ${C}Schema.parse(input);\n}`;
    case 'css':
      return `.root {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-2);\n  padding: var(--space-3);\n  border-radius: var(--radius-md);\n  background: var(--surface);\n}\n\n.root[data-active='true'] {\n  outline: 2px solid var(--accent);\n}`;
    case 'json':
      return `{\n  "name": "${base}",\n  "version": "1.4.2",\n  "private": true,\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc && vite build",\n    "test": "vitest"\n  }\n}`;
    case 'md':
      return `# ${C.replace(/([a-z])([A-Z])/g, '$1 $2')}\n\n> Documentation générée pour le module **${base}**.\n\n## Aperçu\n\nCe document décrit le rôle, l'API publique et les contraintes\nd'utilisation. Voir aussi la section *architecture*.\n\n- Entrée : configuration validée\n- Sortie : artefact sérialisé\n- Statut : stable`;
    case 'sql':
      return `-- migration: ${base}\nCREATE TABLE IF NOT EXISTS ${base.split('_').slice(1).join('_') || 'records'} (\n  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  name       TEXT NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n);\nCREATE INDEX ON ${base.split('_').slice(1).join('_') || 'records'} (created_at);`;
    case 'yml':
    case 'yaml':
      return `name: ${base}\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm run build`;
    case 'sh':
      return `#!/usr/bin/env bash\nset -euo pipefail\n\necho "→ running ${base}"\nroot="$(cd "$(dirname "$0")/.." && pwd)"\ncd "$root"\nnpm run build`;
    case 'svg':
      return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\n  <path d="M4 12h16M12 4v16" stroke="currentColor" stroke-width="2" />\n</svg>`;
    default:
      return `// ${file.path}`;
  }
}
