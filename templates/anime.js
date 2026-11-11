const mangayomiSources = [{
    "name": "__NAME__",
    "lang": "__LANG__",
    "baseUrl": "__BASEURL__",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.1",
    "pkgPath": "__PKGPATH__"
}];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    getHeaders(url) {
        return { "Referer": this.source.baseUrl };
    }

    async getPopular(page) {
        const res = await this.client.get(`${this.source.baseUrl}/popular?page=${page}`, this.getHeaders());
        const doc = new Document(res.body);
        const list = [];
        // TODO: adjust selectors
        for (const el of doc.select(".item")) {
            list.push({
                name: el.selectFirst("a").text,
                link: el.selectFirst("a").getHref,
                imageUrl: el.selectFirst("img").getSrc,
            });
        }
        return { list, hasNextPage: list.length > 0 };
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        return await this.getPopular(page);
    }

    async search(query, page, filters) {
        const res = await this.client.get(`${this.source.baseUrl}/search?q=${encodeURIComponent(query)}&page=${page}`, this.getHeaders());
        const doc = new Document(res.body);
        const list = [];
        for (const el of doc.select(".item")) {
            list.push({
                name: el.selectFirst("a").text,
                link: el.selectFirst("a").getHref,
                imageUrl: el.selectFirst("img").getSrc,
            });
        }
        return { list, hasNextPage: list.length > 0 };
    }

    async getDetail(url) {
        const res = await this.client.get(url, this.getHeaders());
        const doc = new Document(res.body);
        const chapters = [];
        for (const el of doc.select(".chapter a")) {
            chapters.push({
                name: el.text,
                url: el.getHref,
                dateUpload: String(Date.now()),
                scanlator: null,
            });
        }
        return {
            name: doc.selectFirst("h1").text,
            imageUrl: doc.selectFirst(".cover img").getSrc,
            description: doc.selectFirst(".description").text,
            author: "",
            status: 5, // 0 ongoing, 1 completed, 2 on hiatus, 3 canceled, 4 publishing finished, 5 unknown
            genre: [],
            chapters,
        };
    }

    // Return [{ url, originalUrl, quality, headers, subtitles? }]
    async getVideoList(url) {
        const res = await this.client.get(url, this.getHeaders());
        const doc = new Document(res.body);
        // TODO: extract the stream URLs
        return [{
            url: doc.selectFirst("video source").attr("src"),
            originalUrl: url,
            quality: "Default",
            headers: this.getHeaders(),
        }];
    }

    getFilterList() {
        return [];
    }

    getSourcePreferences() {
        return [];
    }
}
