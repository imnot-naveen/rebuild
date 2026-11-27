import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const publicShellFiles = ['manifest.webmanifest', 'icons/rebuild-192.png', 'icons/rebuild-512.png'];

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'rebuild-app-shell',
      apply: 'build',
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          const worker = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
          const version = createHash('sha256').update(worker);
          const files = [...publicShellFiles];
          for (const file of publicShellFiles) {
            version.update(readFileSync(new URL(`./public/${file}`, import.meta.url)));
          }
          for (const name of Object.keys(bundle).sort()) {
            if (!/\.(html|js|css)$/.test(name)) continue;
            const output = bundle[name];
            files.push(name);
            version.update(name).update(output.type === 'chunk' ? output.code : output.source);
          }
          this.emitFile({
            type: 'asset',
            fileName: 'sw.js',
            source: worker
              .replace('__SHELL_VERSION__', JSON.stringify(version.digest('hex').slice(0, 16)))
              .replace('__SHELL_FILES__', JSON.stringify(files.map((name) => `/${name}`))),
          });
        },
      },
    },
  ],
  server: {
    proxy: { '/v1': 'http://127.0.0.1:3000' },
  },
});
