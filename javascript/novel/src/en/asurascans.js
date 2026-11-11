const mangayomiSources = [{
    "name": "Asura Scans Novels (Personal)",
    "lang": "en",
    "baseUrl": "https://asurascans.com",
    "apiUrl": "https://api.asurascans.com/api",
    "iconUrl": "https://asurascans.com/apple-touch-icon.png",
    "typeSource": "single",
    "itemType": 2,
    "isNsfw": false,
    "version": "0.0.1",
    "pkgPath": "novel/src/en/asurascans.js",
    "notes": "WORK IN PROGRESS: browsing and details work; chapter list and chapter text are not implemented yet (endpoints unknown). Optional paid account login is set in the extension settings."
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
            // TODO: chapter list endpoint not found yet. Free sample chapters:
            // n.sample_chapter_count starting at n.sample_chapter_start.
            chapters: [],
        };
    }

    // TODO: needs the chapter-content endpoint (and login for paid chapters).
    async getHtmlContent(name, url) {
        throw new Error("Chapter text is not implemented yet.");
    }

    async cleanHtmlContent(html) {
        return html;
    }

    getFilterList() {
        return [];
    }

    // Optional paid-account login. Values are stored by the app on this device
    // in plain text; leave empty to read free chapters only.
    getSourcePreferences() {
        return [
            {
                key: "asura_username",
                editTextPreference: {
                    title: "Username / email (optional)",
                    summary: "Paid account, to also read paid chapters",
                    value: "",
                    dialogTitle: "Asura username or email",
                    dialogMessage: "",
                },
            },
            {
                key: "asura_password",
                editTextPreference: {
                    title: "Password (optional)",
                    summary: "Stored on this device only",
                    value: "",
                    dialogTitle: "Asura password",
                    dialogMessage: "",
                },
            },
        ];
    }
}
