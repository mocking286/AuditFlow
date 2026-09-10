#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] || process.cwd());
const manifestPath = join(root, 'manifest.json');
const errors = [];

function fail(message) {
  errors.push(message);
}

function walk(directory) {
  const files = [];
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['.git', '.idea', 'dist', 'docs', 'node_modules'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function normalize(value) {
  return value.split(sep).join('/');
}

function matchesEntry(value, entry) {
  if (entry.endsWith('/')) return value === entry.slice(0, -1) || value.startsWith(entry);
  if (!entry.includes('*')) return value === entry;
  const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function assertAsset(value, field) {
  if (typeof value !== 'string') return;
  const path = join(root, value);
  if (!existsSync(path) || !statSync(path).isFile()) fail(`${field} references missing file: ${value}`);
}

if (!existsSync(manifestPath)) {
  fail('manifest.json is missing');
} else {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`manifest.json is not valid JSON: ${error.message}`);
  }
  if (manifest) {
    if (manifest.manifest_version !== 3) fail(`manifest_version must be 3, got ${manifest.manifest_version}`);
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) fail(`invalid extension version: ${manifest.version}`);
    assertAsset(manifest.action?.default_popup, 'action.default_popup');
    assertAsset(manifest.background?.service_worker, 'background.service_worker');
    for (const [size, value] of Object.entries(manifest.icons || {})) assertAsset(value, `icons.${size}`);
    for (const contentScript of manifest.content_scripts || []) {
      for (const value of contentScript.js || []) assertAsset(value, 'content_scripts.js');
      for (const value of contentScript.css || []) assertAsset(value, 'content_scripts.css');
    }
    for (const value of manifest.web_accessible_resources || []) {
      for (const resource of value.resources || []) {
        if (resource.includes('*')) continue;
        assertAsset(resource, 'web_accessible_resources');
      }
    }
  }
}

const forbiddenPattern = /(^|\/)(node_modules|dist|\.git|\.idea|\.env(?:\.|$)|credentials?|secrets?|browser-data|workspace-data)(\/|$)|\.(?:sqlite|db|pem|key|p12)$/i;
const sourceFiles = walk(root).filter((path) => ['.js', '.mjs'].includes(extname(path)));
for (const path of sourceFiles) {
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  } catch (error) {
    const detail = (error.stderr || error.stdout || '').toString().trim().split('\n')[0];
    fail(`JavaScript syntax check failed for ${normalize(relative(root, path))}${detail ? `: ${detail}` : ''}`);
  }
}

for (const htmlPath of walk(root).filter((path) => extname(path) === '.html')) {
  const html = readFileSync(htmlPath, 'utf8');
  for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const reference = match[1];
    if (/^(?:[a-z]+:|\/\/|#|data:|mailto:|javascript:|\$\{|\{\{|\/)/i.test(reference)) continue;
    const localReference = reference.split(/[?#]/, 1)[0];
    if (!localReference || localReference.includes('{{') || localReference.includes('${')) continue;
    const path = resolve(join(root, relative(root, htmlPath), '..'), localReference);
    if (!existsSync(path) || !statSync(path).isFile()) fail(`${normalize(relative(root, htmlPath))} reference references missing file: ${reference}`);
  }
}

const releaseManifestPath = join(root, '.release-manifest');
if (!existsSync(releaseManifestPath)) {
  fail('.release-manifest is missing');
} else {
  const entries = readFileSync(releaseManifestPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  for (const entry of entries) {
    const candidates = walk(root).map((path) => normalize(relative(root, path))).filter((value) => matchesEntry(value, entry));
    if (!candidates.length) fail(`release manifest entry is missing: ${entry}`);
    if (forbiddenPattern.test(entry)) fail(`release manifest contains forbidden path: ${entry}`);
  }
  if (!entries.includes('manifest.json')) fail('.release-manifest must include manifest.json');
  for (const path of walk(root)) {
    const value = normalize(relative(root, path));
    if (forbiddenPattern.test(value) && entries.some((entry) => matchesEntry(value, entry))) {
      fail(`forbidden file would enter release package: ${value}`);
    }
  }
}

try {
  const remote = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  if (remote !== 'https://github.com/mocking286/AuditFlow.git') fail(`origin must target mocking286/AuditFlow.git, got ${remote}`);
} catch {
  fail('Git origin is not configured');
}

if (errors.length) {
  console.error('AuditFlow web release verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
console.log(`AuditFlow web release checks passed (version ${manifest.version}, ${sourceFiles.length} JS/MJS files checked).`);
