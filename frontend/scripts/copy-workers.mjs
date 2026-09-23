import {copyFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const source=resolve('node_modules/maplibre-gl/dist');
const target=resolve('public/assets');
mkdirSync(target,{recursive:true});
for(const name of ['maplibre-gl-worker.mjs','maplibre-gl-shared.mjs'])copyFileSync(resolve(source,name),resolve(target,name));
