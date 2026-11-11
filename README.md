# Mangayomi personal extensions

Personal JavaScript extensions for [Mangayomi](https://github.com/kodjodevf/mangayomi).

## Layout

```
javascript/{manga,anime,novel}/src/<lang>/<source>.js   extensions
templates/                                              starting points per type
scripts/                                                dev tooling (Node, dev only)
index.json, manga_index.json, anime_index.json, novel_index.json   generated
```

`itemType`: manga = 0, anime = 1, novel = 2. Extensions are plain JS, no build step.

## Workflow

```sh
npm install                                   # once (installs test deps)
npm run new -- manga en "My Source" https://example.com
npm run test -- manga/src/en/my_source.js popular    # popular|latest|search <q>|detail <url>|pages <url>|videos <url>|html <url>
npm run gen                                   # regenerate index files, then commit them
npm run check                                 # validate only
```

Bump `version` in `mangayomiSources` whenever you change an extension, or the app won't offer an update.

## Install in the app

Mangayomi → More → Settings → Browse → Extension repositories → add:

- Manga: `https://raw.githubusercontent.com/Personal-Git-Projects/Mangayomi-personal-extensions/main/manga_index.json`
- Anime: `https://raw.githubusercontent.com/Personal-Git-Projects/Mangayomi-personal-extensions/main/anime_index.json`
- Novel: `https://raw.githubusercontent.com/Personal-Git-Projects/Mangayomi-personal-extensions/main/novel_index.json`
