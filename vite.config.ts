import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * The requirement ledger contains the text of the confidential master specification.
 * It is served ONLY by the local development server, straight from docs/.
 * It is never copied into a production build and never committed.
 */
function ledgerDevOnly(): Plugin {
  return {
    name: 'numero-ledger-dev-only',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/requirements.json', (_req, res) => {
        const file = path.join(root, 'docs', 'requirements.json')
        if (!fs.existsSync(file)) { res.statusCode = 404; res.end('{}'); return }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

/** The service worker of the installable app, written into the build with a version of its own, so that each release replaces the files kept by the last. */
function serviceWorker(): Plugin {
  return {
    name: 'numero-service-worker',
    apply: 'build',
    generateBundle() {
      const source = fs.readFileSync(path.join(root, 'src', 'pwa', 'sw.template.js'), 'utf8')
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: source.replace('__NUMERO_BUILD__', Date.now().toString(36)) })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ledgerDevOnly(), serviceWorker()],
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  server: { port: 5177, strictPort: false },
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never)
