# Third-Party Notices

Memsphere depends on the third-party packages listed below. Versions are
resolved from `package-lock.json` for Memsphere 0.1.5.

These packages are installed as separate npm dependencies and retain their own
license files and copyright notices. This document is provided as a convenient
summary; the license distributed with each package is authoritative.

## Direct Runtime Dependencies

| Package | Version | License | Upstream |
| --- | ---: | --- | --- |
| `@agentclientprotocol/sdk` | 1.2.1 | Apache-2.0 | [agentclientprotocol/typescript-sdk](https://github.com/agentclientprotocol/typescript-sdk) |
| `@phosphor-icons/core` | 2.1.1 | MIT | [phosphor-icons/phosphor-core](https://github.com/phosphor-icons/phosphor-core) |
| `ajv` | 8.20.0 | MIT | [ajv-validator/ajv](https://github.com/ajv-validator/ajv) |
| `commander` | 12.1.0 | MIT | [tj/commander.js](https://github.com/tj/commander.js) |
| `cross-spawn` | 7.0.6 | MIT | [moxystudio/node-cross-spawn](https://github.com/moxystudio/node-cross-spawn) |
| `fs-native-extensions` | 1.5.1 | Apache-2.0 | [holepunchto/fs-native-extensions](https://github.com/holepunchto/fs-native-extensions) |
| `handlebars` | 4.7.9 | MIT | [handlebars-lang/handlebars.js](https://github.com/handlebars-lang/handlebars.js) |
| `jsonpath-rfc9535` | 1.3.0 | Apache-2.0 | [P0lip/jsonpath-rfc9535](https://github.com/P0lip/jsonpath-rfc9535) |
| `markdown-it` | 14.3.0 | MIT | [markdown-it/markdown-it](https://github.com/markdown-it/markdown-it) |
| `postcss` | 8.5.28 | MIT | [postcss/postcss](https://github.com/postcss/postcss) |
| `semver` | 7.8.5 | ISC | [npm/node-semver](https://github.com/npm/node-semver) |
| `yaml` | 2.9.0 | ISC | [eemeli/yaml](https://github.com/eemeli/yaml) |
| `zod` | 3.25.76 | MIT | [colinhacks/zod](https://github.com/colinhacks/zod) |

## Transitive Runtime Dependencies

| Package | Version | License | Introduced by | Upstream |
| --- | ---: | --- | --- | --- |
| `require-addon` | 1.3.0 | Apache-2.0 | `fs-native-extensions` | [holepunchto/require-addon](https://github.com/holepunchto/require-addon) |
| `which-runtime` | 1.4.0 | Apache-2.0 | `fs-native-extensions` | [holepunchto/which-runtime](https://github.com/holepunchto/which-runtime) |
| `bare-addon-resolve` | 1.10.1 | Apache-2.0 | `require-addon` | [holepunchto/bare-addon-resolve](https://github.com/holepunchto/bare-addon-resolve) |
| `bare-module-resolve` | 1.12.5 | Apache-2.0 | `bare-addon-resolve` | [holepunchto/bare-module-resolve](https://github.com/holepunchto/bare-module-resolve) |
| `bare-semver` | 1.1.0 | Apache-2.0 | `bare-addon-resolve`, `bare-module-resolve` | [holepunchto/bare-semver](https://github.com/holepunchto/bare-semver) |
| `nanoid` | 3.3.18 | MIT | `postcss` | [ai/nanoid](https://github.com/ai/nanoid) |
| `picocolors` | 1.1.1 | ISC | `postcss` | [alexeyraspopov/picocolors](https://github.com/alexeyraspopov/picocolors) |
| `source-map-js` | 1.2.1 | BSD-3-Clause | `postcss` | [7rulnik/source-map-js](https://github.com/7rulnik/source-map-js) |
| `fast-deep-equal` | 3.1.3 | MIT | `ajv` | [epoberezkin/fast-deep-equal](https://github.com/epoberezkin/fast-deep-equal) |
| `fast-uri` | 3.1.8 | BSD-3-Clause | `ajv` | [fastify/fast-uri](https://github.com/fastify/fast-uri) |
| `json-schema-traverse` | 1.0.0 | MIT | `ajv` | [epoberezkin/json-schema-traverse](https://github.com/epoberezkin/json-schema-traverse) |
| `require-from-string` | 2.0.2 | MIT | `ajv` | [floatdrop/require-from-string](https://github.com/floatdrop/require-from-string) |
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

The installed `jsonpath-rfc9535` package also contains the
`jsonpath-compliance-test-suite` test fixtures, copyright 2020 VMware, Inc.,
under BSD-2-Clause. Its separate LICENSE and NOTICE files remain in that
package's `src/__tests__/jsonpath-compliance-test-suite/` directory.

## Development Dependencies

Development-only packages are not installed as dependencies of the published
Memsphere package. Their versions and licenses remain recorded in
`package-lock.json`, and each installed package includes its authoritative
license file.
