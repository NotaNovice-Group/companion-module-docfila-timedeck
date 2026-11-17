# companion-module-docfila-timedeck

Bitfocus Companion module for [DocFila TimeDeck](https://timedeck.docfila.com),
built on `@companion-module/base` 2.x (ESM, default-exported instance class,
`UpgradeScripts` named export). User documentation: [companion/HELP.md](companion/HELP.md).

```sh
npm install
npm test            # actions -> requests with a mock fetch, inside a fake host context
npm run check       # node --check on every file
npm run package     # companion-module-build: validates the manifest and writes a .tgz to import into Companion
```

Files: `main.js` (instance), `config.js`, `actions.js`, `feedbacks.js`,
`variables.js`, `presets.js`, `upgrades.js`, `companion/manifest.json`,
`lib/` (the shared TimeDeck client and timer engine, synced by
`integrations/timedeck/sync.mjs`).
