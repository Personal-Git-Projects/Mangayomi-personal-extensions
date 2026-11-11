const mangayomiSources = [{
    "name": "Asura Scans (Personal)",
    "lang": "en",
    "baseUrl": "https://asurascans.com",
    "apiUrl": "https://api.asurascans.com/api",
    "iconUrl": "https://asuracomic.net/images/logo.webp",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": false,
    "version": "0.1.3",
    "pkgPath": "manga/src/en/asurascans.js",
    "notes": "Uses the public JSON API (api.asurascans.com). The website itself is behind a Cloudflare challenge, the API is not."
}];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    get apiUrl() {
        return this.source.apiUrl || "https://api.asurascans.com/api";
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

    // ---- listings -------------------------------------------------------

    // The API ignores `page`; it pages with limit/offset.
    pageQuery(page) {
        const limit = 20;
        return `limit=${limit}&offset=${(Math.max(page, 1) - 1) * limit}`;
    }

    parseList(json) {
        const list = (json.data || []).map((s) => ({
            name: s.title,
            link: s.slug,
            imageUrl: s.cover,
        }));
        const hasNextPage = json.meta ? !!json.meta.has_more : list.length > 0;
        return { list, hasNextPage };
    }

    async getPopular(page) {
        // NOTE: `sort=popular` is not verified against the API yet.
        return this.parseList(await this.api(`/series?${this.pageQuery(page)}&sort=popular`));
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        return this.parseList(await this.api(`/series?${this.pageQuery(page)}`));
    }

    async search(query, page, filters) {
        return this.parseList(
            await this.api(`/series?${this.pageQuery(page)}&search=${encodeURIComponent(query)}`)
        );
    }

    // ---- detail ---------------------------------------------------------

    stripHtml(html) {
        return (html || "")
            .replace(/<\s*br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
            .trim();
    }

    mapStatus(status) {
        switch ((status || "").toLowerCase()) {
            case "ongoing": return 0;
            case "completed": return 1;
            case "hiatus": case "on hiatus": return 2;
            case "dropped": case "cancelled": case "canceled": return 3;
            default: return 5;
        }
    }

    // The series endpoint has no chapter list; the chapter endpoint returns the
    // full `chapter_list` of the series, so we need any one valid chapter slug.
    // `chapter_list` carries no dates. Real publish dates only exist on the
    // listing's `latest_chapters` (3 newest) and on the chapter we fetch, so we
    // return those as a slug -> epoch-ms map and leave the rest undated.
    async findEntryChapter(slug, dates) {
        let latest = [];
        try {
            const found = await this.api(`/series?search=${encodeURIComponent(slug.replace(/-/g, " "))}`);
            const hit = (found.data || []).find((s) => s.slug === slug);
            latest = hit && hit.latest_chapters ? hit.latest_chapters : [];
        } catch (e) { /* dates are best effort */ }
        for (const c of latest) {
            if (c.published_at) dates[c.slug] = Date.parse(c.published_at);
        }
        const guesses = ["chapter-1", "chapter-0"];
        if (latest.length) guesses.push(latest[0].slug);
        for (const guess of guesses) {
            try {
                const data = (await this.api(`/series/${slug}/chapters/${guess}`)).data;
                if (data.chapter && data.chapter.published_at) {
                    dates[guess] = Date.parse(data.chapter.published_at);
                }
                return data;
            } catch (e) { /* try next */ }
        }
        return null;
    }

    async getChapters(slug) {
        const dates = {};
        const data = await this.findEntryChapter(slug, dates);
        if (!data) return [];
        return (data.chapter_list || [])
            .slice()
            .sort((a, b) => b.number - a.number)
            .map((c) => ({
                name: c.title ? `Chapter ${c.number} - ${c.title}` : `Chapter ${c.number}`,
                url: `${slug}/${c.slug}`,
                dateUpload: dates[c.slug] ? String(dates[c.slug]) : null,
                scanlator: c.is_premium ? "Premium" : null,
            }));
    }

    async getDetail(url) {
        const slug = url;
        const s = (await this.api(`/series/${slug}`)).series;
        return {
            name: s.title,
            imageUrl: s.cover,
            description: this.stripHtml(s.description),
            author: s.author || "",
            artist: s.artist || "",
            status: this.mapStatus(s.status),
            genre: (s.genres || []).map((g) => g.name),
            chapters: await this.getChapters(slug),
        };
    }

    // ---- pages ----------------------------------------------------------

    async getPageList(url) {
        // url = "<series-slug>/<chapter-slug>"
        const [slug, chapterSlug] = url.split("/");
        const data = (await this.api(`/series/${slug}/chapters/${chapterSlug}`)).data;
        if (data.is_locked) throw new Error("This chapter is locked (early access / premium).");
        return (data.chapter.pages || []).map((p) => p.url);
    }

    getFilterList() {
        return [];
    }

    getSourcePreferences() {
        return [];
    }
}
