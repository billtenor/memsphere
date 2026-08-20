#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  console.log("fake-cli 1.0.0");
} else {
  console.log(JSON.stringify(args));
}
