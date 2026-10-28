import { readFile, writeFile, realpath, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const local = createRequire(import.meta.url);
let esbuild;
try { esbuild = local('esbuild'); }
catch {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const binary = join(directory, 'memsphere');
    try { await access(binary); esbuild = createRequire(await realpath(binary))('esbuild'); break; }
    catch { /* Try the next installed CLI location. */ }
  }
  if (!esbuild) throw Error('Install project dependencies to build the prototype');
}
const result = await esbuild.build({
  entryPoints:[fileURLToPath(new URL('./src/index.js',import.meta.url))],
  bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,
  external:['@memsphere/view-sdk'],legalComments:'none'
});
const file=new URL('./index.js',import.meta.url), output=result.outputFiles[0].text;
if(process.argv.includes('--check')) {
  if(await readFile(file,'utf8')!==output)throw Error('Prototype bundle differs: run node build.mjs');
  console.log('Prototype bundle is current');
} else { await writeFile(file,output); console.log('Built prototype Module'); }
