const mangayomiSources = [{
    "name": "Asura Scans Novels (Personal)",
    "lang": "en",
    "baseUrl": "https://asurascans.com",
    "apiUrl": "https://api.asurascans.com/api",
    "iconUrl": "https://asurascans.com/apple-touch-icon.png",
    "typeSource": "single",
    "itemType": 2,
    "isNsfw": false,
    "version": "0.0.4",
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
        return {
            "Accept": "application/json",
            "Referer": `${this.source.baseUrl}/`,
        };
    }

    async api(path) {
        const res = await this.client.get(`${this.apiUrl}${path}`, this.getHeaders());
        if (res.statusCode && res.statusCode >= 400) {
            throw new Error(`Asura API ${res.statusCode} for ${path}`);
        }
        return JSON.parse(res.body);
    }

    unwrap(json) {
        return json && json.data && !Array.isArray(json.data) ? json.data : json;
    }

    // ---- listings -------------------------------------------------------
    // /novels returns every novel in one response (page/offset/limit are ignored),
    // so there is only ever one page.

    async allNovels() {
        const json = await this.api("/novels");
        return (json.data || []).map((n) => ({
            name: n.title,
            link: n.slug,
            imageUrl: n.cover_url,
            _rating: n.rating || 0,
            _updated: n.updated_at || "",
        }));
    }

    strip(list) {
        return list.map(({ name, link, imageUrl }) => ({ name, link, imageUrl }));
    }

    async getPopular(page) {
        if (page > 1) return { list: [], hasNextPage: false };
        const list = await this.allNovels();
        list.sort((a, b) => b._rating - a._rating);
        return { list: this.strip(list), hasNextPage: false };
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        if (page > 1) return { list: [], hasNextPage: false };
        const list = await this.allNovels();
        list.sort((a, b) => b._updated.localeCompare(a._updated));
        return { list: this.strip(list), hasNextPage: false };
    }

    async search(query, page, filters) {
        if (page > 1) return { list: [], hasNextPage: false };
        const q = (query || "").toLowerCase();
        const list = (await this.allNovels()).filter((n) => n.name.toLowerCase().includes(q));
        return { list: this.strip(list), hasNextPage: false };
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

    async getDetail(url) {
        const n = this.unwrap(await this.api(`/novels/${url}`));
        return {
            name: n.title,
            imageUrl: n.cover_url,
            description: n.description || "",
            author: n.author || "",
            status: this.mapStatus(n.status),
            genre: n.genres || [],
            chapters: this.buildChapters(url, n),
        };
    }

    // No chapter-list endpoint is known. Chapter pages are /novels/<slug>/chapter/<n>,
    // so list 1..count (count read from whichever field the API provides).
    chapterCount(n) {
        const keys = ["chapter_count", "chapters_count", "total_chapters", "chapterCount", "latest_chapter_number"];
        for (const k of keys) {
            if (Number(n[k]) > 0) return Number(n[k]);
        }
        const latest = n.latest_chapters || n.chapters;
        if (Array.isArray(latest) && latest.length) {
            return Math.max(...latest.map((c) => Number(c.number) || 0));
        }
        return 0;
    }

    buildChapters(slug, n) {
        const count = this.chapterCount(n);
        const out = [];
        for (let i = count; i >= 1; i--) {
            out.push({ name: `Chapter ${i}`, url: `${slug}/${i}`, dateUpload: null, scanlator: null });
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
        const tag = html.match(/<astro-island[^>]*NovelReader[^>]*>/);
        if (!tag) return null;
        const m = tag[0].match(/\sprops="([^"]*)"/);
        if (!m) return null;
        const raw = JSON.parse(this.decodeAttr(m[1]));
        const out = {};
        for (const k of Object.keys(raw)) out[k] = this.astroValue(raw[k]);
        return out;
    }

    async getHtmlContent(name, url) {
        // url = "<novel-slug>/<chapter-number>"
        const [slug, num] = url.split("/");
        const res = await this.client.get(`${this.source.baseUrl}/novels/${slug}/chapter/${num}`, {
            "Accept": "text/html",
            "Referer": `${this.source.baseUrl}/novels/${slug}`,
        });
        if (res.statusCode && res.statusCode >= 400) {
            throw new Error(`Asura page ${res.statusCode} (Cloudflare may be blocking the page).`);
        }
        const props = this.parseReaderProps(res.body);
        if (!props) {
            const body = res.body || "";
            const t = (body.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
            throw new Error(`No chapter data in page. status=${res.statusCode} len=${body.length} title="${t}" island=${body.includes("astro-island")} reader=${body.includes("NovelReader")}`);
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
