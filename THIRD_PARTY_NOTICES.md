# Third-Party Notices

Memsphere depends on the third-party packages listed below. Versions are
resolved from `package-lock.json` for Memsphere 0.1.2.

These packages are installed as separate npm dependencies and retain their own
license files and copyright notices. This document is provided as a convenient
summary; the license distributed with each package is authoritative.

## Direct Runtime Dependencies

| Package | Version | License | Upstream |
| --- | ---: | --- | --- |
| `@agentclientprotocol/sdk` | 1.2.1 | Apache-2.0 | [agentclientprotocol/typescript-sdk](https://github.com/agentclientprotocol/typescript-sdk) |
| `commander` | 12.1.0 | MIT | [tj/commander.js](https://github.com/tj/commander.js) |
| `cross-spawn` | 7.0.6 | MIT | [moxystudio/node-cross-spawn](https://github.com/moxystudio/node-cross-spawn) |
| `handlebars` | 4.7.9 | MIT | [handlebars-lang/handlebars.js](https://github.com/handlebars-lang/handlebars.js) |
| `markdown-it` | 14.3.0 | MIT | [markdown-it/markdown-it](https://github.com/markdown-it/markdown-it) |
| `semver` | 7.8.5 | ISC | [npm/node-semver](https://github.com/npm/node-semver) |
| `yaml` | 2.9.0 | ISC | [eemeli/yaml](https://github.com/eemeli/yaml) |
| `zod` | 3.25.76 | MIT | [colinhacks/zod](https://github.com/colinhacks/zod) |

## Transitive Runtime Dependencies

| Package | Version | License | Introduced by | Upstream |
| --- | ---: | --- | --- | --- |
| `minimist` | 1.2.8 | MIT | `handlebars` | [minimistjs/minimist](https://github.com/minimistjs/minimist) |
| `neo-async` | 2.6.2 | MIT | `handlebars` | [suguru03/neo-async](https://github.com/suguru03/neo-async) |
| `source-map` | 0.6.1 | BSD-3-Clause | `handlebars` | [mozilla/source-map](https://github.com/mozilla/source-map) |
| `uglify-js` | 3.19.3 | BSD-2-Clause | `handlebars` | [mishoo/UglifyJS](https://github.com/mishoo/UglifyJS) |
| `wordwrap` | 1.0.0 | MIT | `handlebars` | [substack/node-wordwrap](https://github.com/substack/node-wordwrap) |
| `argparse` | 2.0.1 | Python-2.0 | `markdown-it` | [nodeca/argparse](https://github.com/nodeca/argparse) |
| `entities` | 4.5.0 | BSD-2-Clause | `markdown-it` | [fb55/entities](https://github.com/fb55/entities) |
| `linkify-it` | 5.0.2 | MIT | `markdown-it` | [markdown-it/linkify-it](https://github.com/markdown-it/linkify-it) |
| `path-key` | 3.1.1 | MIT | `cross-spawn` | [sindresorhus/path-key](https://github.com/sindresorhus/path-key) |
| `shebang-command` | 2.0.0 | MIT | `cross-spawn` | [kevva/shebang-command](https://github.com/kevva/shebang-command) |
| `shebang-regex` | 3.0.0 | MIT | `shebang-command` | [sindresorhus/shebang-regex](https://github.com/sindresorhus/shebang-regex) |
| `which` | 2.0.2 | ISC | `cross-spawn` | [npm/node-which](https://github.com/npm/node-which) |
| `isexe` | 2.0.0 | ISC | `which` | [isaacs/isexe](https://github.com/isaacs/isexe) |
| `mdurl` | 2.0.0 | MIT | `markdown-it` | [markdown-it/mdurl](https://github.com/markdown-it/mdurl) |
| `punycode.js` | 2.3.1 | MIT | `markdown-it` | [mathiasbynens/punycode.js](https://github.com/mathiasbynens/punycode.js) |
| `uc.micro` | 2.1.0 | MIT | `markdown-it` | [markdown-it/uc.micro](https://github.com/markdown-it/uc.micro) |

## Development Dependencies

Development-only packages are not installed as dependencies of the published
Memsphere package. Their versions and licenses remain recorded in
`package-lock.json`, and each installed package includes its authoritative
license file.
