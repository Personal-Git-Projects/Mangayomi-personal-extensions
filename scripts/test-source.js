#!/usr/bin/env node
// Local harness: runs an extension in Node with a minimal mock of the Mangayomi runtime.
// Usage: node scripts/test-source.js <pkgPath> <popular|latest|search|detail|pages|videos|html> [arg]
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const cheerio = require("cheerio");

const [pkgPath, action = "popular", arg] = process.argv.slice(2);
if (!pkgPath) { console.error("Usage: npm run test -- <pkgPath> <action> [arg]"); process.exit(1); }
const file = path.join(__dirname, "..", "javascript", pkgPath);
const code = fs.readFileSync(file, "utf8");

class Element {
  constructor($, el, base) { this.$ = $; this.el = el; this.base = base; }
  get _q() { return this.$(this.el); }
  get text() { return this._q.text().trim(); }
  get innerHtml() { return this._q.html(); }
  get outerHtml() { return this.$.html(this.el); }
  get getHref() { return this._abs(this._q.attr("href")); }
  get getSrc() { return this._abs(this._q.attr("data-src") || this._q.attr("src")); }
  attr(n) { return this._q.attr(n); }
  selectFirst(s) { const e = this._q.find(s).first(); return e.length ? new Element(this.$, e[0], this.base) : null; }
  select(s) { return this._q.find(s).toArray().map((e) => new Element(this.$, e, this.base)); }
  _abs(u) { try { return u ? new URL(u, this.base).href : u; } catch { return u; } }
}
class Document extends Element {
  constructor(html) { const $ = cheerio.load(html); super($, $.root()[0], ""); }
}
class Client {
  async _do(method, url, headers, body) {
    const r = await fetch(url, { method, headers: { "User-Agent": "Mozilla/5.0", ...(headers || {}) }, body });
    return { body: await r.text(), statusCode: r.status, headers: Object.fromEntries(r.headers) };
  }
  get(url, headers) { return this._do("GET", url, headers); }
  post(url, headers, body) { return this._do("POST", url, headers, typeof body === "string" ? body : JSON.stringify(body)); }
}
class SharedPreferences { get() { return null; } getString(k, d) { return d; } }
const ctx = vm.createContext({
  MProvider: class { constructor() {} },
  Client, Document, SharedPreferences, console, URL, encodeURIComponent, setTimeout,
});
vm.runInContext(code + "\n;this.__ext = new DefaultExtension(); this.__src = mangayomiSources[0];", ctx, { filename: pkgPath });
const ext = ctx.__ext;
ext.source = ctx.__src;

(async () => {
  const actions = {
    popular: () => ext.getPopular(1),
    latest: () => ext.getLatestUpdates(1),
    search: () => ext.search(arg || "", 1, ext.getFilterList()),
    detail: () => ext.getDetail(arg),
    pages: () => ext.getPageList(arg),
    videos: () => ext.getVideoList(arg),
    html: () => ext.getHtmlContent("", arg),
  };
  if (!actions[action]) throw new Error(`Unknown action "${action}"`);
  console.log(JSON.stringify(await actions[action](), null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
