// Renders the app icons of the installable NUMERO (public/icons) from the logo mark, with a headless Chrome.
// usage: node scripts/make_app_icons.mjs            (Chrome at its usual Windows place, or CHROME=<path>)
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const mark = readFileSync('public/logo-mark.svg', 'utf8')
const defs = mark.match(/<defs>[\s\S]*?<\/defs>/)[0]
const art = mark.slice(mark.indexOf('</defs>') + 7, mark.lastIndexOf('</svg>')).replace(/<rect[^>]*\/>/, '')

// "any": the rounded tile of the logo on a clear ground; "full": the tile fills the square, for masks and for iOS
const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}<rect x="1" y="1" width="62" height="62" rx="16" fill="url(#t)" stroke="#d8b56f" stroke-opacity=".35"/>${art}</svg>`
const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}<rect width="64" height="64" fill="url(#t)"/>${art}</svg>`
const icons = [
  ['icon-192.png', 192, any], ['icon-512.png', 512, any],
  ['icon-maskable-512.png', 512, full], ['apple-touch-icon.png', 180, full],
]

const port = 9361
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'numero-icons-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page') } catch { /* not up */ } }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const waiting = new Map()
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id) } })
const send = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })

mkdirSync('public/icons', { recursive: true })
await send('Page.enable')
for (const [name, size, svg] of icons) {
  await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
  const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`
  await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') })
  await sleep(500)
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } })
  writeFileSync(join('public/icons', name), Buffer.from(shot.result.data, 'base64'))
  console.log(name, size)
}
ws.close(); proc.kill(); process.exit(0)
