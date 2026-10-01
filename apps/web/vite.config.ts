import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// Build identity stamped by scripts/write-build-info.mjs (runs as part of
// `pnpm build`). Embedded into the bundle and shown in the dashboard footer.
function readBuildInfo(): { id: string; time: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'build-info.json'), 'utf8'));
    return { id: String(raw.id ?? 'dev'), time: String(raw.time ?? '') };
  } catch {
    return { id: 'dev', time: '' };
  }
}
const buildInfo = readBuildInfo();

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo)
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/healthz': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true }
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 4500,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ['monaco-editor', '@monaco-editor/react'],
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search']
        }
      }
    }
  }
});
