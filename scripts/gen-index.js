#!/usr/bin/env node
// Scans javascript/<type>/src/<lang>/*.js, reads each `mangayomiSources`
// array and writes index.json, manga_index.json, anime_index.json, novel_index.json.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { owner, repo, branch, types } = require("./config");

const root = path.join(__dirname, "..");
const jsRoot = path.join(root, "javascript");
const check = process.argv.includes("--check");
const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".js")) yield p;
  }
}

const errors = [];
const all = [];
for (const file of walk(jsRoot)) {
  const rel = path.relative(jsRoot, file).split(path.sep).join("/");
  const code = fs.readFileSync(file, "utf8");
  let sources;
  try {
    const ctx = vm.createContext({});
    vm.runInContext(code + "\n;this.__s = typeof mangayomiSources !== 'undefined' ? mangayomiSources : undefined;", ctx, { filename: rel });
    sources = ctx.__s;
  } catch (e) {
    // Extensions extend MProvider, which only exists in the app; stub it.
    try {
      const ctx = vm.createContext({ MProvider: class {} });
      vm.runInContext(code + "\n;this.__s = mangayomiSources;", ctx, { filename: rel });
      sources = ctx.__s;
    } catch (e2) {
      errors.push(`${rel}: ${e2.message}`);
      continue;
    }
  }
  if (!Array.isArray(sources)) { errors.push(`${rel}: missing mangayomiSources array`); continue; }
  for (const s of sources) {
    for (const k of ["name", "lang", "baseUrl", "version", "itemType", "pkgPath"]) {
      if (s[k] === undefined || s[k] === "") errors.push(`${rel}: "${s.name}" missing ${k}`);
    }
    if (s.pkgPath !== rel) errors.push(`${rel}: pkgPath "${s.pkgPath}" should be "${rel}"`);
    const folderType = rel.split("/")[0];
    if (types[folderType] !== s.itemType) errors.push(`${rel}: itemType ${s.itemType} does not match folder "${folderType}"`);
    all.push({
      ...s,
      id: s.id ?? hash(`${s.name}.${s.lang}.${s.itemType}`),
      typeSource: s.typeSource ?? "single",
      sourceCodeLanguage: 1, // 0 = Dart, 1 = JavaScript
      sourceCodeUrl: `${rawBase}/javascript/${rel}`,
    });
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
if (check) { console.log(`OK: ${all.length} source(s)`); process.exit(0); }

function hash(str) {
  let h = 0;
  for (const c of str) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
const write = (name, list) =>
  fs.writeFileSync(path.join(root, name), JSON.stringify(list, null, 2) + "\n");
write("index.json", all);
for (const [name, t] of Object.entries(types)) write(`${name}_index.json`, all.filter((s) => s.itemType === t));
console.log(`Wrote index files for ${all.length} source(s)`);
