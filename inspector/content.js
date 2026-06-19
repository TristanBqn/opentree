// Meta formatting + plausible file-preview snippets.
import { NOW } from "./data.js";

export function formatSize(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(2) + " MB";
}
const MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];
export function formatDate(ts) {
  const d = new Date(ts);
  return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}
export function relDate(ts) {
  const mins = Math.round((NOW - ts) / 60000);
  if (mins < 60) return "il y a " + Math.max(1, mins) + " min";
  const hours = Math.round(mins / 60);
  if (hours < 24) return "il y a " + hours + " h";
  const days = Math.round(hours / 24);
  if (days === 1) return "hier";
  if (days < 30) return "il y a " + days + " j";
  if (days < 365) return "il y a " + Math.round(days / 30) + " mois";
  return "il y a " + (days / 365).toFixed(1) + " an";
}

export const GIT_LABEL = {
  clean: { txt: "à jour", cls: "clean" },
  modified: { txt: "modifié", cls: "modified" },
  added: { txt: "ajouté", cls: "added" },
  untracked: { txt: "non suivi", cls: "untracked" },
};

const BIN = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "ico",
  "woff2",
  "woff",
  "ttf",
  "bin",
  "mp3",
]);
export function isBinary(ext) {
  return BIN.has(ext);
}

function pascal(name) {
  return name
    .replace(/\.[^.]*$/, "")
    .replace(/(^|[-_.])([a-z])/g, (_, __, c) => c.toUpperCase())
    .replace(/[-_.]/g, "");
}

export function langOf(ext) {
  return (
    {
      ts: "TypeScript",
      tsx: "TypeScript React",
      js: "JavaScript",
      jsx: "JavaScript React",
      mjs: "JavaScript",
      css: "CSS",
      json: "JSON",
      md: "Markdown",
      sql: "SQL",
      yml: "YAML",
      yaml: "YAML",
      sh: "Shell",
      bash: "Shell",
      conf: "Config",
      toml: "TOML",
      xml: "XML",
      log: "Journal",
      bak: "Sauvegarde",
      patch: "Patch",
      bin: "Binaire",
      mp3: "Audio",
      ico: "Icon",
      svg: "SVG",
      png: "PNG",
      jpg: "JPEG",
      webp: "WebP",
      html: "HTML",
      woff2: "Font",
    }[ext] || "Texte"
  );
}

export function snippet(file) {
  const ext = file.ext;
  const base = file.name.replace(/\.[^.]*$/, "");
  const C = pascal(base);
  if (isBinary(ext)) return null;
  switch (ext) {
    case "tsx":
    case "jsx":
      return `import { useState, useCallback } from 'react';\nimport styles from './${base}.module.css';\n\nexport interface ${C}Props {\n  id: string;\n  active?: boolean;\n  onSelect?: (id: string) => void;\n}\n\nexport function ${C}({ id, active, onSelect }: ${C}Props) {\n  const [hover, setHover] = useState(false);\n  const handle = useCallback(() => onSelect?.(id), [id, onSelect]);\n\n  return (\n    <div className={styles.root} data-active={active} onClick={handle}>\n      {/* … */}\n    </div>\n  );\n}`;
    case "ts":
    case "js":
    case "mjs":
      return `import { z } from 'zod';\nimport { logger } from '../infra/logger';\n\nexport const ${C}Schema = z.object({\n  id: z.string().uuid(),\n  channel: z.string(),\n  createdAt: z.coerce.date(),\n});\n\nexport type ${C} = z.infer<typeof ${C}Schema>;\n\nexport async function handle${C}(input: unknown): Promise<${C}> {\n  const parsed = ${C}Schema.parse(input);\n  logger.debug({ id: parsed.id }, '${base} handled');\n  return parsed;\n}`;
    case "css":
      return `.root {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-2);\n  padding: var(--space-3);\n  border-radius: var(--radius-md);\n  background: var(--surface);\n}`;
    case "json":
      return `{\n  "name": "${base}",\n  "gateway": {\n    "port": 3978,\n    "bind": "127.0.0.1",\n    "healthcheck": "/healthz"\n  },\n  "agents": {\n    "model": "claude-sonnet-4-5",\n    "maxConcurrent": 2\n  }\n}`;
    case "md":
      return `# ${C.replace(/([a-z])([A-Z])/g, "$1 $2")}\n\n> Documentation du module **${base}** — stack OpenClaw.\n\n## Aperçu\n\nRôle, API publique et contraintes d'utilisation.\n\n- Entrée : configuration validée\n- Sortie : artefact sérialisé\n- Statut : stable`;
    case "yml":
    case "yaml":
      return `services:\n  openclaw-gateway:\n    image: openclaw:local\n    restart: unless-stopped\n    ports:\n      - "127.0.0.1:3978:3978"\n      - "127.0.0.1:8742:8742"\n    healthcheck:\n      test: ["CMD", "node", "dist/healthcheck.js"]\n      interval: 30s\n    networks: [openclaw_default]`;
    case "sh":
    case "":
      return `#!/usr/bin/env bash\nset -euo pipefail\n\necho "→ running ${base}"\ncd /home/openclaw/openclaw\ndocker compose ps --format json | jq -r '.[].Health'`;
    case "log":
      return `2026-06-12T14:58:21Z INFO  gateway listening :3978\n2026-06-12T14:58:22Z INFO  channel whatsapp connected\n2026-06-12T14:59:05Z DEBUG session main resumed (12 msgs)\n2026-06-12T15:00:41Z INFO  healthcheck ok (latency 12ms)\n2026-06-12T15:02:13Z WARN  rate-limit bottleneck queued (3)`;
    case "conf":
      return `server {\n  listen 443 ssl;\n  server_name openclaw.example.fr;\n\n  location / {\n    proxy_pass http://127.0.0.1:3978;\n    proxy_set_header Upgrade $http_upgrade;\n  }\n}`;
    case "svg":
      return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\n  <path d="M4 12h16M12 4v16" stroke="currentColor" stroke-width="2" />\n</svg>`;
    case "patch":
      return `--- a/src/ws.ts\n+++ b/src/ws.ts\n@@ -41,6 +41,9 @@\n   onClose(code) {\n+    if (code === 1006) this.scheduleReconnect();\n     this.emit('close', code);\n   }`;
    default:
      return `// ${file.path}`;
  }
}
