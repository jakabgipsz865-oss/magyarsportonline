# @magyarsportonline/config

Megosztott TypeScript / ESLint / Prettier presetek a monorepo összes csomagához és alkalmazásához.

- `eslint/base.js` — keretrendszer-független ESLint flat config (TypeScript-recommended + Prettier-kompatibilitás)
- `eslint/nextjs.js` — a fenti kiegészítve React Hooks szabályokkal, `apps/web`-hez
- `tsconfig/base.json` — szigorú TypeScript alapbeállítások (`strict`, `noUncheckedIndexedAccess`, stb.)
- `tsconfig/library.json` — `base.json` könyvtár-csomagokhoz (`composite: false`); az `outDir`/`rootDir` relatív útvonalak miatt csomagonként, a saját `tsconfig.json`-ban állítandók, nem itt (TypeScript az `extends`-ben megadott relatív útvonalakat a bázis-fájl helyéhez képest oldja fel)
- `tsconfig/nextjs.json` — `base.json` + Next.js App Router beállítások
- `prettier.js` — megosztott Prettier-konfiguráció

Ez a csomag maga nem tartalmaz futtatható üzleti kódot, ezért nincs `build`/`test` scriptje — a Turborepo pipeline ezt a csomagot automatikusan kihagyja azoknál a lépéseknél, amikhez nincs megfelelő `package.json` script definiálva.
