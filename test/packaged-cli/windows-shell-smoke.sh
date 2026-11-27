#!/usr/bin/env bash
set -e

./.ci-install/node_modules/.bin/memsphere --version
./.ci-install/node_modules/.bin/memsphere --help
cd ".ci windows project"
../.ci-install/node_modules/.bin/memsphere view status
