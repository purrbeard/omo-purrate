# Vendored DeepSeek Harness design system

Everything under `src/dsh/` is copied from the DeepSeek Harness repository (MIT, Copyright (c) 2026 DeepSeek) at commit `639ed015397290b3745d163aafe02ffee4aa3f84`. The copies are byte-for-byte except for the edits listed at the end of this file. Do not restyle or refactor these files; fix problems with compiler options or aliases first, and record any unavoidable edit here.

## Provenance

| Directory in this repo | DSH source path | Notes |
| --- | --- | --- |
| `src/dsh/theme/` | `packages/client/ui-theme/src/styles/` | All sheets, the three Montserrat woff2 files and `Montserrat-OFL.txt`. `src/main.tsx` imports the sheets in the order `packages/client/ui-theme/src/client/styles.ts` installs them (base, corner-shape, design-platform, focus, onboarding, scrollbar, gradient-shadow-text, shiki), preceded by `brand-font.css`. |
| `src/dsh/primitives/` | `packages/client/ui-primitives/src/` | Same relative layout. Tests were never part of `src/`. |
| `src/dsh/vendor/code-language/` | `packages/util/code-language/src/` | `index.ts` only. |
| `src/dsh/vendor/workspace-path/` | `packages/util/workspace-path/src/` | `index.ts`, `file-address.ts`. |
| `src/dsh/vendor/store/` | `packages/client/store/src/` | `index.ts`, `contract.ts` (used by `primitives/settings-form/form-model.ts`). |
| `src/dsh/vendor/client-build-environment.d.ts` | `scripts/types/client-build-environment/index.d.ts` | Ambient `process.env` typing the store engine relies on (`NODE_ENV`, replaced by Vite at build time). |

## Alias table

The original package specifiers stay in the copied files. `tsconfig.json` `compilerOptions.paths` and `vite.config.ts` `resolve.alias` map them to the copies; both tables must stay identical. Each DSH package exports `.` and `./src/*`, so both forms are mapped.

| Specifier | Resolves to |
| --- | --- |
| `@deepseek-ai/dsh-client-ui-primitives` | `src/dsh/primitives/index.ts` |
| `@deepseek-ai/dsh-client-ui-primitives/src/<file>` | `src/dsh/primitives/<file>` |
| `@deepseek-ai/dsh-util-code-language` | `src/dsh/vendor/code-language/index.ts` |
| `@deepseek-ai/dsh-util-code-language/src/<file>` | `src/dsh/vendor/code-language/<file>` |
| `@deepseek-ai/dsh-util-workspace-path` | `src/dsh/vendor/workspace-path/index.ts` |
| `@deepseek-ai/dsh-util-workspace-path/src/<file>` | `src/dsh/vendor/workspace-path/<file>` |
| `@deepseek-ai/dsh-client-store` | `src/dsh/vendor/store/index.ts` |
| `@deepseek-ai/dsh-client-store/src/<file>` | `src/dsh/vendor/store/<file>` |

Compiler options the copies depend on (set in `tsconfig.json`): `allowImportingTsExtensions`, `verbatimModuleSyntax: false` (the sources rely on elided type-only imports), `lib` including `ES2024` and `ESNext.Disposable`, `resolveJsonModule`.

External dependencies are declared in `package.json` `devDependencies` with the exact ranges from the DSH package manifests: `clsx ^2.0.0`, `diff ^9.0.0`, `anser ^2.3.5`, `katex ^0.16.47`, `shiki ^4.3.1`, `@shikijs/langs ^4.3.1`, `simple-icons 16.31.0`, `@types/mdast ^4.0.4`, `mdast-util-from-markdown ^2.0.3`, `mdast-util-gfm ^3.1.0`, `mdast-util-math ^3.0.0`, `micromark-core-commonmark ^2.0.3`, `micromark-extension-gfm ^3.0.0`, `micromark-extension-math ^3.1.0`, `micromark-factory-space ^2.0.1`, `micromark-util-character ^2.1.1`, `micromark-util-classify-character ^2.0.1`, `micromark-util-sanitize-uri ^2.0.1`, `micromark-util-symbol ^2.0.1`, `micromark-util-types ^2.0.2`, `zustand ~4.4.7`, `immer ^10.1.1`.

## Local edits and omissions

- `primitives/FishLogo.tsx` and `primitives/BrandWordmark.tsx` are NOT copied: they embed the DeepSeek whale mark and wordmark, which are trademarks. The app brand is the text wordmark "OmO".
- `primitives/index.ts`: the three export lines for `FishLogo`, `FISH_LOGO_PATH`, `FISH_LOGO_VIEWBOX`, `BrandWordmark` and `BrandWordmarkProps` are removed (lines 44-46 of the original). Nothing else changed.
- `primitives/css-modules.d.ts` is NOT copied: `vite/client` already declares `*.module.css`, and a second ambient declaration would duplicate its default export.
