import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({build:{rollupOptions:{input:{main:resolve(import.meta.dirname,'index.html'),launchpad:resolve(import.meta.dirname,'launchpad.html')}}}});
