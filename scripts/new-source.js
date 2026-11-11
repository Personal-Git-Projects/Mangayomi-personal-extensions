#!/usr/bin/env node
// Usage: npm run new -- <manga|anime|novel> <lang> <Name> <baseUrl>
const fs = require("fs");
const path = require("path");
const { types } = require("./config");
const [type, lang, name, baseUrl] = process.argv.slice(2);
if (!types.hasOwnProperty(type) || !lang || !name || !baseUrl) {
  console.error("Usage: npm run new -- <manga|anime|novel> <lang> <Name> <baseUrl>");
  process.exit(1);
}
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const pkgPath = `${type}/src/${lang}/${slug}.js`;
const out = path.join(__dirname, "..", "javascript", pkgPath);
if (fs.existsSync(out)) { console.error(`${pkgPath} already exists`); process.exit(1); }
const tpl = fs.readFileSync(path.join(__dirname, "..", "templates", `${type}.js`), "utf8")
  .replaceAll("__NAME__", name).replaceAll("__LANG__", lang)
  .replaceAll("__BASEURL__", baseUrl).replaceAll("__PKGPATH__", pkgPath);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, tpl);
console.log(`Created javascript/${pkgPath}`);
