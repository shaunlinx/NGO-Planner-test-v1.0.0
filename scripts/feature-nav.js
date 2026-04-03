const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const navRoot = path.join(repoRoot, '.trae', 'feature_nav');
const entriesRoot = path.join(navRoot, 'entries');
const templatePath = path.join(navRoot, '_template.md');
const indexPath = path.join(navRoot, 'index.json');

function nowIso() {
  return new Date().toISOString();
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readUtf8(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeUtf8(p, content) {
  fs.writeFileSync(p, content, 'utf8');
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [rawKey, rawValue] = token.split('=');
      const key = rawKey.slice(2);
      const next = argv[i + 1];
      const hasInlineValue = rawValue !== undefined;
      const value = hasInlineValue ? rawValue : (next && !next.startsWith('--') ? next : 'true');
      flags[key] = value;
      i += hasInlineValue ? 1 : (value === 'true' ? 1 : 2);
      continue;
    }
    positional.push(token);
    i += 1;
  }
  return { positional, flags };
}

function splitCsv(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function slugify(input) {
  const raw = String(input || '').trim().toLowerCase();
  const ascii = raw
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (ascii) return ascii;
  return `feature-${todayYmd()}-${Date.now()}`;
}

function parseFrontmatter(markdown) {
  const trimmed = String(markdown || '');
  if (!trimmed.startsWith('---\n')) return null;
  const end = trimmed.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const block = trimmed.slice(4, end).trim();
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  const out = {};

  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    if (!key) continue;

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim();
      if (!inner) {
        out[key] = [];
        continue;
      }
      out[key] = inner
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.replace(/^"(.*)"$/s, '$1'));
      continue;
    }

    out[key] = rawValue.replace(/^"(.*)"$/s, '$1');
  }

  return out;
}

function loadIndex() {
  if (!fs.existsSync(indexPath)) {
    return { version: 1, entries: [] };
  }
  const parsed = JSON.parse(readUtf8(indexPath));
  if (!parsed || typeof parsed !== 'object') return { version: 1, entries: [] };
  if (!Array.isArray(parsed.entries)) parsed.entries = [];
  if (typeof parsed.version !== 'number') parsed.version = 1;
  return parsed;
}

function saveIndex(index) {
  const stable = {
    version: 1,
    entries: index.entries
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  };
  writeUtf8(indexPath, JSON.stringify(stable, null, 2) + '\n');
}

function upsertEntry(index, entry) {
  const existingIndex = index.entries.findIndex(e => e && e.id === entry.id);
  if (existingIndex >= 0) index.entries[existingIndex] = entry;
  else index.entries.push(entry);
}

function fillTemplate(template, fields) {
  const lines = template.split('\n');
  const out = [];
  let inFrontmatter = false;
  let frontmatterDone = false;

  for (const line of lines) {
    if (line.trim() === '---' && !frontmatterDone) {
      inFrontmatter = !inFrontmatter;
      out.push(line);
      if (!inFrontmatter) frontmatterDone = true;
      continue;
    }

    if (inFrontmatter) {
      if (line.startsWith('title:')) out.push(`title: "${fields.title.replaceAll('"', '\\"')}"`);
      else if (line.startsWith('slug:')) out.push(`slug: "${fields.slug}"`);
      else if (line.startsWith('createdAt:')) out.push(`createdAt: "${fields.createdAt}"`);
      else if (line.startsWith('updatedAt:')) out.push(`updatedAt: "${fields.updatedAt}"`);
      else if (line.startsWith('modules:')) out.push(`modules: [${fields.modules.map(m => `"${m.replaceAll('"', '\\"')}"`).join(', ')}]`);
      else if (line.startsWith('tags:')) out.push(`tags: [${fields.tags.map(t => `"${t.replaceAll('"', '\\"')}"`).join(', ')}]`);
      else if (line.startsWith('refs:')) out.push(`refs: [${fields.refs.map(r => `"${r.replaceAll('"', '\\"')}"`).join(', ')}]`);
      else out.push(line);
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

function createNote({ title, slug, modules, tags, refs }) {
  ensureDir(navRoot);
  ensureDir(entriesRoot);

  const template = fs.existsSync(templatePath)
    ? readUtf8(templatePath)
    : `---\ntitle: \"\"\nslug: \"\"\ncreatedAt: \"\"\nupdatedAt: \"\"\nmodules: []\ntags: []\nrefs: []\n---\n\n## 已落地的能力（解决什么根因）\n\n-\n`;

  const createdAt = nowIso();
  const updatedAt = createdAt;
  const ymd = todayYmd();
  const noteDir = path.join(entriesRoot, slug);
  ensureDir(noteDir);

  const filename = `${ymd}__${slug}.md`;
  const notePath = path.join(noteDir, filename);
  if (fs.existsSync(notePath)) {
    throw new Error(`目标文件已存在: ${notePath}`);
  }

  const content = fillTemplate(template, { title, slug, createdAt, updatedAt, modules, tags, refs });
  writeUtf8(notePath, content.endsWith('\n') ? content : (content + '\n'));

  const index = loadIndex();
  const id = `${ymd}__${slug}`;
  upsertEntry(index, {
    id,
    title,
    slug,
    createdAt,
    updatedAt,
    modules,
    tags,
    refs,
    entryPath: path.relative(repoRoot, notePath).replaceAll(path.sep, '/')
  });
  saveIndex(index);

  return { id, notePath };
}

function stagePaths(paths) {
  const quoted = paths.map(p => `"${p}"`).join(' ');
  execSync(`git add -f ${quoted}`, { stdio: 'inherit' });
}

function walkFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

function reindex() {
  ensureDir(navRoot);
  ensureDir(entriesRoot);

  const files = walkFiles(entriesRoot).filter(f => f.toLowerCase().endsWith('.md'));
  const index = { version: 1, entries: [] };

  for (const file of files) {
    const md = readUtf8(file);
    const fm = parseFrontmatter(md);
    if (!fm) continue;
    const slug = String(fm.slug || '').trim() || path.basename(path.dirname(file));
    const fileBase = path.basename(file);
    const ymdFromName = fileBase.includes('__') ? fileBase.split('__')[0] : '';
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(ymdFromName) ? ymdFromName : (String(fm.createdAt || '').slice(0, 10) || todayYmd());

    upsertEntry(index, {
      id: `${ymd}__${slug}`,
      title: String(fm.title || '').trim() || slug,
      slug,
      createdAt: String(fm.createdAt || '').trim() || '',
      updatedAt: String(fm.updatedAt || '').trim() || String(fm.createdAt || '').trim() || '',
      modules: Array.isArray(fm.modules) ? fm.modules : [],
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      refs: Array.isArray(fm.refs) ? fm.refs : [],
      entryPath: path.relative(repoRoot, file).replaceAll(path.sep, '/')
    });
  }

  saveIndex(index);
  process.stdout.write(`✅ 已重建索引: ${index.entries.length} 条\n`);
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0] || 'new';

  if (flags.help === 'true' || flags.h === 'true') {
    process.stdout.write(
      [
        'Usage:',
        '  node scripts/feature-nav.js new --title "标题" --slug "short-name" [--modules a,b] [--tags x,y] [--refs file.tsx#L1-L2,...] [--stage]',
        '  node scripts/feature-nav.js reindex',
        '',
        'Examples:',
        '  node scripts/feature-nav.js new --title "Planner Context 闭环" --slug planner-context --modules calendar,rag --tags context,token',
        '  npm run nav:new -- --title "Planner Context 闭环" --slug planner-context --refs "components/PlanModal.tsx#L306-L339,electron/main.js#L1889-L1937"'
      ].join('\n') + '\n'
    );
    return;
  }

  if (command === 'reindex') {
    reindex();
    return;
  }

  if (command !== 'new') throw new Error(`未知命令: ${command}`);

  const title = String(flags.title || positional.slice(1).join(' ') || '').trim();
  if (!title) throw new Error('缺少参数 --title');

  const slug = slugify(flags.slug || title);
  const modules = splitCsv(flags.modules);
  const tags = splitCsv(flags.tags);
  const refs = splitCsv(flags.refs);

  const { notePath } = createNote({ title, slug, modules, tags, refs });
  process.stdout.write(`✅ 已生成: ${notePath}\n`);

  if (flags.stage === 'true') {
    stagePaths([notePath, indexPath, path.join(navRoot, 'README.md'), templatePath].filter(p => fs.existsSync(p)));
  }
}

try {
  main();
} catch (e) {
  process.stderr.write(`❌ ${e && e.message ? e.message : String(e)}\n`);
  process.exit(1);
}
