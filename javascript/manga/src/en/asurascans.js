const mangayomiSources = [{
    "name": "Asura Scans (Personal)",
    "lang": "en",
    "baseUrl": "https://asurascans.com",
    "apiUrl": "https://api.asurascans.com/api",
    "iconUrl": "https://asuracomic.net/images/logo.webp",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": false,
    "version": "0.1.2",
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
    async findAnyChapterSlug(slug) {
        for (const guess of ["chapter-1", "chapter-0"]) {
            try {
                await this.api(`/series/${slug}/chapters/${guess}`);
                return guess;
            } catch (e) { /* try next */ }
        }
        // Fall back to the latest chapter reported by the listing/search endpoint.
        const found = await this.api(`/series?search=${encodeURIComponent(slug.replace(/-/g, " "))}`);
        const hit = (found.data || []).find((s) => s.slug === slug);
        if (hit && hit.latest_chapters && hit.latest_chapters.length) {
            return hit.latest_chapters[0].slug;
        }
        return null;
    }

    async getChapters(slug) {
        const first = await this.findAnyChapterSlug(slug);
        if (!first) return [];
        const data = (await this.api(`/series/${slug}/chapters/${first}`)).data;
        return (data.chapter_list || [])
            .slice()
            .sort((a, b) => b.number - a.number)
            .map((c) => ({
                name: c.title ? `Chapter ${c.number} - ${c.title}` : `Chapter ${c.number}`,
                url: `${slug}/${c.slug}`,
                dateUpload: c.published_at ? String(Date.parse(c.published_at)) : null,
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
