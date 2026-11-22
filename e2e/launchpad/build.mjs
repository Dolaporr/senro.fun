// Builds the preview and live-enabled pages with the test fee settings, for run.mjs.
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {E2E_TREASURY,E2E_LOOKUP_TABLE} from './fixture.mjs';
const env={...process.env,VITE_NUSH_TREASURY:E2E_TREASURY,VITE_NUSH_LOOKUP_TABLE:E2E_LOOKUP_TABLE};
const vite=path.join(import.meta.dirname,'../../node_modules/.bin/vite');
execFileSync(vite,['build'],{env,stdio:'inherit'});
execFileSync(vite,['build','--outDir',process.env.LIVE_DIST??path.join(os.tmpdir(),'nush-dist-live'),'--emptyOutDir'],{env:{...env,VITE_LAUNCH_ENABLED:'true'},stdio:'inherit'});
