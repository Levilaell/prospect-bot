import 'dotenv/config'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { generateQueue } from '../lib/queue.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Resolve prospect.js path — on Railway __dirname may differ from project root
const prospectPath = existsSync(join(__dirname, '..', 'prospect.js'))
  ? join(__dirname, '..', 'prospect.js')
  : join(process.cwd(), 'prospect.js')

console.log('[bot-server] prospect.js path:', prospectPath)
console.log('[bot-server] __dirname:', __dirname)
console.log('[bot-server] cwd:', process.cwd())
const BOT_SECRET = process.env.BOT_SERVER_SECRET || ''
const PORT = process.env.PORT || 3001

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try { resolve(JSON.parse(body)) }
      catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, version: '1.0.0' }))
  }

  // Queue API — returns auto-mode queue as JSON
  // Accepts GET ?market=BR|US|all (legacy) or POST with { market, niches, cities, lang } from dashboard
  if ((req.method === 'GET' || req.method === 'POST') && (req.url === '/api/bot/queue' || req.url?.startsWith('/api/bot/queue?'))) {
    const auth = req.headers['authorization'] || ''
    if (BOT_SECRET && auth !== `Bearer ${BOT_SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Unauthorized' }))
    }

    try {
      let market = 'all'
      let externalConfig

      if (req.method === 'POST') {
        const body = await parseBody(req)
        market = body.market || 'all'
        if (body.niches && body.cities) {
          externalConfig = {
            niches: body.niches,
            cities: body.cities,
            country: body.market || 'BR',
            lang: body.lang || 'pt',
          }
        }
      } else {
        const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams
        market = urlParams.get('market') || 'all'
      }

      const { queue, stats } = await generateQueue({ market, externalConfig })
      const brItems = queue.filter(i => i.country === 'BR')
      const usItems = queue.filter(i => i.country === 'US')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({
        stats,
        queue: queue.slice(0, 100),
        summary: {
          br: brItems.length,
          us: usItems.length,
          estimatedLeads: queue.length * 20,
        },
      }))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: err.message }))
    }
  }

  // Run auto mode
  if (req.method === 'POST' && req.url === '/run-auto') {
    const auth = req.headers['authorization'] || ''
    if (BOT_SECRET && auth !== `Bearer ${BOT_SECRET}`) {
      res.writeHead(401)
      return res.end('Unauthorized')
    }

    const body = await parseBody(req)
    const limit    = body.limit ?? '20'
    const minScore = body.min_score ?? '4'
    const dryRun   = body.dry_run ?? false
    const send     = body.send ?? false
    const market   = body.market ?? 'all'

    const args = [
      prospectPath,
      '--auto',
      '--market', String(market),
      '--limit', String(limit),
      '--min-score', String(minScore),
      '--export', 'supabase',
    ]
    if (dryRun) args.push('--dry')
    if (send && !dryRun) args.push('--send')

    // If dashboard sent niches + cities, write to temp file for prospect.js
    let configTmpPath
    if (body.niches && body.cities) {
      try {
        const tmpDir = mkdtempSync(join(tmpdir(), 'bot-config-'))
        configTmpPath = join(tmpDir, 'config.json')
        writeFileSync(configTmpPath, JSON.stringify({
          niches: body.niches,
          cities: body.cities,
          country: body.market || 'BR',
          lang: body.lang || 'pt',
        }))
        args.push('--config', configTmpPath)
      } catch (err) {
        console.warn('[bot-server] failed to write temp config:', err.message)
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify({ line: data })}\n\n`)
    }

    sendEvent('🤖 Iniciando modo autônomo...')

    const child = spawn('node', args, {
      env: { ...process.env },
      cwd: join(__dirname, '..'),
    })

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim())
      lines.forEach(line => sendEvent(line))
    })

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim())
      lines.forEach(line => sendEvent(`⚠️ ${line}`))
    })

    child.on('close', (code) => {
      // Clean up temp config file
      if (configTmpPath) {
        try { unlinkSync(configTmpPath) } catch { /* ignore */ }
      }
      sendEvent(code === 0 ? '✅ Modo autônomo finalizado' : `❌ Encerrou com código ${code}`)
      res.write('data: [DONE]\n\n')
      res.end()
    })

    req.on('close', () => { if (!child.killed) child.kill() })
    return
  }

  // Run bot (manual)
  if (req.method === 'POST' && req.url === '/run') {
    const auth = req.headers['authorization'] || ''
    if (BOT_SECRET && auth !== `Bearer ${BOT_SECRET}`) {
      res.writeHead(401)
      return res.end('Unauthorized')
    }

    const body = await parseBody(req)
    const niche       = body.niche
    const city        = body.city
    const limit       = body.limit ?? body.limit_count ?? '20'
    const minScore    = body.min_score ?? body.minScore ?? '4'
    const lang        = body.lang ?? 'pt'
    const exportTarget = body.export_target ?? body.exportTarget ?? 'supabase'
    const dryRun      = body.dry_run ?? body.dryRun ?? false
    const send        = body.send ?? false

    if (!niche || !city) {
      res.writeHead(400)
      return res.end('niche and city are required')
    }

    const args = [
      prospectPath,
      '--niche', niche,
      '--city', city,
      '--limit', String(limit),
      '--min-score', String(minScore),
      '--lang', lang,
      '--export', exportTarget,
    ]
    if (dryRun) args.push('--dry')
    if (send && !dryRun) args.push('--send')

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify({ line: data })}\n\n`)
    }

    sendEvent(`🤖 Iniciando bot: ${niche} em ${city}`)
    sendEvent(`📋 Parâmetros: limit=${limit} min-score=${minScore} lang=${lang} export=${exportTarget}${dryRun ? ' --dry' : ''}${send ? ' --send' : ''}`)

    const child = spawn('node', args, {
      env: { ...process.env },
      cwd: join(__dirname, '..'),
    })

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim())
      lines.forEach(line => sendEvent(line))
    })

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim())
      lines.forEach(line => sendEvent(`⚠️ ${line}`))
    })

    child.on('close', (code) => {
      sendEvent(code === 0 ? '✅ Bot finalizado com sucesso' : `❌ Bot encerrou com código ${code}`)
      res.write('data: [DONE]\n\n')
      res.end()
    })

    req.on('close', () => {
      if (!child.killed) child.kill()
    })

    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`🚀 Bot server running on port ${PORT}`)
})
