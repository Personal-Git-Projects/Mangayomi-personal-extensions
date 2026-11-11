const mangayomiSources = [{
    "name": "Asura Scans Novels (Personal)",
    "lang": "en",
    "baseUrl": "https://asurascans.com",
    "apiUrl": "https://api.asurascans.com/api",
    "iconUrl": "https://asurascans.com/apple-touch-icon.png",
    "typeSource": "single",
    "itemType": 2,
    "isNsfw": false,
    "version": "0.0.10",
    "pkgPath": "novel/src/en/asurascans.js",
    "notes": "WORK IN PROGRESS: chapter text is read from the website reader page (may be blocked by Cloudflare); paid chapters are not supported yet. Optional paid access uses a session token set in the extension settings."
}];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    get apiUrl() {
        return this.source.apiUrl || "https://api.asurascans.com/api";
    }

    getPref(key) {
        try {
            return new SharedPreferences().get(key) || "";
        } catch (e) {
            return "";
        }
    }

    getHeaders() {
        // Mirror the browser's API requests; the API 403s the app's default client.
        return {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": `${this.source.baseUrl}/`,
            "Origin": this.source.baseUrl,
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
        };
    }

    async api(path) {
        const res = await this.client.get(`${this.apiUrl}${path}`, this.getHeaders());
        if (res.statusCode && res.statusCode >= 400) {
            const t = ((res.body || "").match(/<title>([^<]*)<\/title>/i) || [])[1] || (res.body || "").slice(0, 80);
            throw new Error(`Asura API ${res.statusCode} for ${path} [${t}]`);
        }
        return JSON.parse(res.body);
    }

    unwrap(json) {
        return json && json.data && !Array.isArray(json.data) ? json.data : json;
    }

    // ---- listings -------------------------------------------------------
    // The site's novel list is /novel-series (limit/offset paging;
    // sort=update | popular&period=week). /novels is only the paid-ebook catalog.

    async novelPage(page, extra) {
        const limit = 20;
        const offset = (Math.max(page, 1) - 1) * limit;
        const json = await this.api(`/novel-series?limit=${limit}&offset=${offset}${extra || ""}`);
        const raw = Array.isArray(json.data) ? json.data : (json.data && json.data.series) || json.series || [];
        const list = raw.map((n) => ({
            name: n.title,
            link: n.slug,
            imageUrl: n.cover || n.cover_url || n.thumbnail || "",
        }));
        const meta = json.meta || {};
        let hasNextPage;
        if (typeof meta.has_more === "boolean") hasNextPage = meta.has_more;
        else if (Number(meta.total) > 0) hasNextPage = offset + raw.length < Number(meta.total);
        else hasNextPage = raw.length >= limit;
        return { list, hasNextPage };
    }

    async getPopular(page) {
        // The API 403s some parameter combinations from the app; fall back.
        for (const extra of ["&sort=popular&period=week", "&sort=popular", "&sort=update"]) {
            try {
                return await this.novelPage(page, extra);
            } catch (e) { /* try next */ }
        }
        return this.novelPage(page, "&sort=update");
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        return this.novelPage(page, "&sort=update");
    }

    async search(query, page, filters) {
        const q = query ? `&search=${encodeURIComponent(query)}` : "";
        return this.novelPage(page, `&sort=update${q}`);
    }

    // ---- detail ---------------------------------------------------------

    mapStatus(status) {
        switch ((status || "").toLowerCase()) {
            case "ongoing": return 0;
            case "completed": return 1;
            case "hiatus": return 2;
            case "dropped": case "cancelled": return 3;
            default: return 5;
        }
    }

    stripHtml(html) {
        return (html || "")
            .replace(/<\s*br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    // No single-novel endpoint is confirmed, so try likely ones, then scan the list.
    async findNovel(slug) {
        for (const path of [`/novel-series/${slug}`, `/novels/${slug}`]) {
            try {
                const n = this.unwrap(await this.api(path));
                const x = (n && (n.series || n.novel)) || n;
                if (x && x.slug === slug) return x;
            } catch (e) { /* try next */ }
        }
        for (let offset = 0; offset < 200; offset += 20) {
            const json = await this.api(`/novel-series?sort=update&limit=20&offset=${offset}`);
            const raw = Array.isArray(json.data) ? json.data : [];
            const hit = raw.find((x) => x.slug === slug);
            if (hit) return hit;
            if (raw.length < 20) break;
        }
        throw new Error(`Novel not found: ${slug}`);
    }

    async getDetail(url) {
        const n = await this.findNovel(url);
        return {
            name: n.title,
            imageUrl: n.cover_url || n.cover || "",
            description: this.stripHtml(n.description),
            author: n.author || "",
            status: this.mapStatus(n.status),
            genre: n.genres || [],
            chapters: await this.pageChapters(url, n),
        };
    }

    // The series page embeds the full chapter list (number, title, free, shardCost)
    // in the NovelChapterList island. Fall back to a generated list if unavailable.
    async pageChapters(slug, n) {
        try {
            const res = await this.client.get(`${this.source.baseUrl}/novels/${slug}`, {
                "User-Agent": this.getHeaders()["User-Agent"],
                "Accept": "text/html",
                "Referer": `${this.source.baseUrl}/novels`,
            });
            const props = this.parseIsland(res.body, "NovelChapterList");
            const list = props && props.chapters;
            if (Array.isArray(list) && list.length) {
                return list.slice().sort((a, b) => b.number - a.number).map((c) => ({
                    name: c.title ? `Chapter ${c.number} - ${c.title}` : `Chapter ${c.number}`,
                    url: `${slug}/${c.number}`,
                    dateUpload: null,
                    scanlator: c.free === false ? (c.shardCost ? `Paid (${c.shardCost} shards)` : "Paid") : null,
                }));
            }
        } catch (e) { /* fall through */ }
        return this.buildChapters(slug, n);
    }

    // No chapter-list endpoint is known. Chapter pages are /novels/<slug>/chapter/<n>,
    // numbered first_chapter .. first_chapter+chapter_count-1. Titles/dates/lock
    // state exist only for the few `recent_chapters` the API returns.
    buildChapters(slug, n) {
        const count = Number(n.chapter_count) || 0;
        const first = Number(n.first_chapter) || 0;
        const recent = {};
        for (const c of n.recent_chapters || []) recent[c.number] = c;
        const out = [];
        for (let i = first + count - 1; i >= first; i--) {
            const r = recent[i];
            out.push({
                name: r && r.title ? `Chapter ${i} - ${r.title}` : `Chapter ${i}`,
                url: `${slug}/${i}`,
                dateUpload: r && r.published_at ? String(Date.parse(r.published_at)) : null,
                scanlator: r && r.is_locked ? "Paid" : null,
            });
        }
        return out;
    }

    // ---- chapter text ---------------------------------------------------
    // The reader page embeds the chapter in an <astro-island> "props" attribute
    // (HTML-escaped, Astro-serialised JSON): paragraphs, isLocked, shardCost.

    decodeAttr(v) {
        return v.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    }

    // Astro encodes values as [0, v] (plain) or [1, [..]] (array).
    astroValue(x) {
        if (!Array.isArray(x) || x.length !== 2) return x;
        if (x[0] === 1) return x[1].map((i) => this.astroValue(i));
        if (x[0] === 0) {
            const v = x[1];
            if (v && typeof v === "object" && !Array.isArray(v)) {
                const o = {};
                for (const k of Object.keys(v)) o[k] = this.astroValue(v[k]);
                return o;
            }
            return v;
        }
        return x;
    }

    parseReaderProps(html) {
        return this.parseIsland(html, "NovelReader");
    }

    parseIsland(html, name) {
        const tag = (html || "").match(new RegExp(`<astro-island[^>]*${name}[^>]*>`));
        if (!tag) return null;
        const m = tag[0].match(/\sprops="([^"]*)"/);
        if (!m) return null;
        const raw = JSON.parse(this.decodeAttr(m[1]));
        const out = {};
        for (const k of Object.keys(raw)) out[k] = this.astroValue(raw[k]);
        return out;
    }

    async getHtmlContent(name, url) {
        // url is "<slug>/<number>", but accept a full or relative reader URL too.
        const m = url.match(/novels\/([^\/?#]+)\/chapter\/(-?\d+)/) || url.match(/^\/?([^\/?#]+)\/(-?\d+)\/?$/);
        if (!m) throw new Error(`Unrecognised chapter url: ${url}`);
        const slug = m[1];
        const num = m[2];
        const pageUrl = `${this.source.baseUrl}/novels/${slug}/chapter/${num}`;
        const res = await this.client.get(pageUrl, {
            "User-Agent": this.getHeaders()["User-Agent"],
            "Accept": "text/html",
            "Referer": `${this.source.baseUrl}/novels/${slug}`,
        });
        if (res.statusCode && res.statusCode >= 400) {
            throw new Error(`Asura page ${res.statusCode} for ${pageUrl}`);
        }
        const props = this.parseReaderProps(res.body);
        if (!props) {
            const body = res.body || "";
            const t = (body.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
            throw new Error(`No chapter data in page ${pageUrl} (from "${url}"). status=${res.statusCode} len=${body.length} title="${t}" island=${body.includes("astro-island")} reader=${body.includes("NovelReader")}`);
        }
        if (props.isLocked) {
            throw new Error(`Paid chapter (costs ${props.shardCost || "?"} shards). Paid reading is not supported yet.`);
        }
        const title = `<h2>Chapter ${props.chapterNumber} - ${props.chapterTitle || ""}</h2>`;
        return title + (props.paragraphs || []).join("\n");
    }

    async cleanHtmlContent(html) {
        return html;
    }

    getFilterList() {
        return [];
    }

    // Optional paid access. Paste a session token copied from your own logged-in
    // browser (no password is stored). Empty = free chapters only. The app keeps
    // this value on-device; it is not encrypted by the extension.
    getSourcePreferences() {
        return [
            {
                key: "asura_token",
                editTextPreference: {
                    title: "Session token (optional)",
                    summary: "Paste your logged-in token to read paid chapters",
                    value: "",
                    dialogTitle: "Asura session token",
                    dialogMessage: "Copied from your own browser session. Never share it.",
                },
            },
        ];
    }
}
