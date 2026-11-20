#!/usr/bin/env node
// Package an Obsidian vault into the portable OnlineVault format.
// No npm install, no React build — this script only uses Node built-ins.
//
//   node pack-vault.mjs "/path/to/vault" [--out DIR] [--dry-run] [--verbose]
//   node pack-vault.mjs --index [--out DIR]        # index an already-injected vault-assets folder
//
// In a built template the default output is ./vault-assets (next to index.html),
// so `node tools/pack-vault.mjs --index` is all an end user needs to run.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const verbose = args.includes('--verbose')
const indexOnly = args.includes('--index') || args.includes('--reindex')
const has = flag => args.includes(flag)
const valueAfter = flag => {
  const at = args.indexOf(flag)
  return at >= 0 ? args[at + 1] : undefined
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const siteRoot = path.dirname(scriptDir)
const defaultOut = path.join(siteRoot, fs.existsSync(path.join(siteRoot, 'public')) ? 'public/vault-assets' : 'vault-assets')
const out = path.resolve(valueAfter('--out') || defaultOut)

let vaultArg
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') { i++; continue }
  if (args[i].startsWith('--')) continue
  vaultArg = args[i]
  break
}

if (!has('--index') && !has('--reindex') && !vaultArg) {
  console.error('Usage: node pack-vault.mjs "/path/to/vault" [--out DIR] [--dry-run] [--verbose]')
  console.error('       node pack-vault.mjs --index [--out DIR]')
  process.exit(1)
}

const source = indexOnly ? out : path.resolve(vaultArg)
if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
  console.error(`Vault not found or not a directory: ${source}`)
  process.exit(1)
}
if (!indexOnly && (source === out || out.startsWith(source + path.sep))) {
  console.error('The output folder cannot be inside the source vault. Use --out with another location.')
  process.exit(1)
}

// Folders and files that are never part of a published knowledge base.
const EXCLUDED_DIRS = new Set([
  '.obsidian', '.trash', '.git', '.github', '.svn', 'node_modules', 'dist', 'build',
  'out', '.venv', 'venv', '__pycache__', '.idea', '.vscode', '.cache', '.next', 'tools',
])
const EXCLUDED_FILES = new Set([
  'thumbs.db', 'desktop.ini', '.ds_store', '.gitkeep', 'vault.json',
  '_how_to_add_a_vault.txt',
])
const SKIP_EXTENSIONS = new Set(['.excalidraw', '.canvas', '.tmp', '.log', '.exe', '.dll', '.so', '.pyc'])
const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico',
  '.pdf', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.m4a',
  '.txt', '.mdx', '.docx', '.xlsx', '.pptx',
])

const isAttachment = name => ASSET_EXTENSIONS.has(path.extname(name).toLowerCase())

function walk(dir, relative = '') {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
    const absolute = path.join(dir, entry.name)
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      results.push(...walk(absolute, rel))
    } else if (entry.isFile()) {
      if (EXCLUDED_FILES.has(entry.name.toLowerCase())) continue
      if (SKIP_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      results.push({ absolute, relative: rel })
    }
  }
  return results
}

/** Keep private notes out of the generated payload too, not just out of the UI. */
function isPrivate(raw) {
  const match = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return false
  return /(^|\n)(publish|published)\s*:\s*false\s*(#.*)?$/mi.test(match[1])
}

const files = walk(source)
const notes = {}
const assets = []
let unpublished = 0

for (const file of files) {
  if (/\.md$/i.test(file.relative)) {
    const raw = fs.readFileSync(file.absolute, 'utf8')
    if (isPrivate(raw)) {
      unpublished++
      continue
    }
    notes[file.relative] = raw
  } else if (isAttachment(file.relative)) {
    assets.push(file.relative)
  }
}

const notePaths = Object.keys(notes).sort((a, b) => a.localeCompare(b))
const assetPaths = assets.sort((a, b) => a.localeCompare(b))
const orderedNotes = Object.fromEntries(notePaths.map(item => [item, notes[item]]))

console.log(`Scanned ${files.length} files in ${source}`)
console.log(`Notes:      ${notePaths.length}${unpublished ? ` (${unpublished} hidden by publish: false)` : ''}`)
console.log(`Attachments: ${assetPaths.length}`)

if (dryRun) {
  console.log('\nDry run — nothing was written.')
  process.exit(0)
}

if (!indexOnly) {
  fs.mkdirSync(out, { recursive: true })
  for (const item of notePaths) {
    copy(fileFor(item), path.join(out, item))
  }
  for (const item of assetPaths) {
    copy(fileFor(item), path.join(out, item))
  }
}

fs.mkdirSync(out, { recursive: true })
const manifest = {
  version: 1,
  name: path.basename(source),
  generatedAt: new Date().toISOString(),
  notes: orderedNotes,
  assets: assetPaths,
}
const manifestPath = path.join(out, 'vault.json')
fs.writeFileSync(manifestPath, JSON.stringify(manifest) + '\n')

console.log(`\nWrote ${manifestPath}`)
console.log(indexOnly
  ? 'Vault indexed in place — reload the site to see it.'
  : `Vault copied to ${out}`)

function fileFor(relative) {
  return files.find(file => file.relative === relative)
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  if (from === to) return
  fs.copyFileSync(from.absolute, to)
  if (verbose) console.log(`  ${path.relative(out, to)}`)
}
