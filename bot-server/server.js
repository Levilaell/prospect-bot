import 'dotenv/config'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
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

// ── Active runs — in-memory store for background processes ──────────────────

const activeRuns = new Map()
const MAX_COMPLETED_RUNS = 5

function cleanupOldRuns() {
  const completed = [...activeRuns.entries()]
    .filter(([, r]) => r.status !== 'running')
    .sort((a, b) => b[1].endedAt - a[1].endedAt)
  // Keep only the last MAX_COMPLETED_RUNS completed runs
  for (const [id] of completed.slice(MAX_COMPLETED_RUNS)) {
    activeRuns.delete(id)
  }
}

function extractStats(logs) {
  let collected = 0, qualified = 0, sent = 0
  for (const line of logs) {
    const cm = line.match(/(\d+)\s*collected/)
    if (cm) collected = parseInt(cm[1])
    const qm = line.match(/(\d+)\s*qualified/)
    if (qm) qualified = parseInt(qm[1])
    const sm = line.match(/(\d+)\s*sent/)
    if (sm) sent = parseInt(sm[1])
  }
  return { collected, qualified, sent }
}

// ── Auth helper ──────────────────────────────────────────────────────────────

function checkAuth(req, res) {
  const auth = req.headers['authorization'] || ''
  if (BOT_SECRET && auth !== `Bearer ${BOT_SECRET}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return false
  }
  return true
}

// ── Server ───────────────────────────────────────────────────────────────────

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
    return res.end(JSON.stringify({ ok: true, version: '2.0.0' }))
  }

  // Queue API — returns auto-mode queue as JSON
  if ((req.method === 'GET' || req.method === 'POST') && (req.url === '/api/bot/queue' || req.url?.startsWith('/api/bot/queue?'))) {
    if (!checkAuth(req, res)) return

    try {
      let market = 'all'
      let externalConfig

      if (req.method === 'POST') {
        const body = await parseBody(req)
        market = body.market || 'all'
        if (body.niches && body.cities) {
          // `market` is the campaign code (BR, US-EM, US-WA, US-SMS). The
          // admin sends `country` and `channel` explicitly now so we don't
          // have to reverse-engineer them from the code here.
          externalConfig = {
            niches: body.niches,
            cities: body.cities,
            country: body.country || (body.market === 'BR' ? 'BR' : 'US'),
            lang: body.lang || 'pt',
            channel: body.channel || (body.lang === 'pt' ? 'whatsapp' : 'email'),
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

  // ── Run auto mode (fire-and-forget) ──────────────────────────────────────

  if (req.method === 'POST' && req.url === '/run-auto') {
    if (!checkAuth(req, res)) return

    // Check if there's already a running process
    const alreadyRunning = [...activeRuns.values()].find(r => r.status === 'running')
    if (alreadyRunning) {
      res.writeHead(409, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'A run is already in progress', runId: alreadyRunning.id }))
    }

    const body = await parseBody(req)
    const limit       = body.limit ?? '20'
    const minScore    = body.min_score ?? '4'
    const dryRun      = body.dry_run ?? false
    const send        = body.send ?? false
    const market      = body.market ?? 'all'
    const maxSend     = body.max_send
    const maxProjects = body.max_projects

    const args = [
      prospectPath,
      '--auto',
      '--market', String(market),
      '--limit', String(limit),
      '--min-score', String(minScore),
    ]
    if (dryRun) args.push('--dry')
    if (send && !dryRun) args.push('--send')
    if (maxSend) args.push('--max-send', String(maxSend))
    if (maxProjects) args.push('--max-projects', String(maxProjects))

    // Write temp config file with niches, cities, and Evolution instances
    let configTmpPath
    if (body.niches && body.cities) {
      try {
        const tmpDir = mkdtempSync(join(tmpdir(), 'bot-config-'))
        configTmpPath = join(tmpDir, 'config.json')
        const configData = {
          niches: body.niches,
          cities: body.cities,
          country: body.country || (body.market === 'BR' ? 'BR' : 'US'),
          lang: body.lang || 'pt',
          channel: body.channel || (body.lang === 'pt' ? 'whatsapp' : 'email'),
        }
        if (body.evolutionInstances && body.evolutionApiUrl) {
          configData.evolutionInstances = body.evolutionInstances
          configData.evolutionApiUrl = body.evolutionApiUrl
        }
        writeFileSync(configTmpPath, JSON.stringify(configData))
        args.push('--config', configTmpPath)
      } catch (err) {
        console.warn('[bot-server] failed to write temp config:', err.message)
      }
    }

    const runId = randomUUID()
    const run = {
      id: runId,
      status: 'running',
      logs: ['🤖 Iniciando modo autônomo...'],
      startedAt: Date.now(),
      endedAt: null,
      configTmpPath,
    }
    activeRuns.set(runId, run)

    const child = spawn('node', args, {
      env: { ...process.env },
      cwd: join(__dirname, '..'),
    })
    run.process = child

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim())
      run.logs.push(...lines)
    })

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim())
      run.logs.push(...lines.map(l => `⚠️ ${l}`))
    })

    child.on('close', (code) => {
      if (configTmpPath) {
        try { unlinkSync(configTmpPath) } catch { /* ignore */ }
      }
      run.logs.push(code === 0 ? '✅ Modo autônomo finalizado' : `❌ Encerrou com código ${code}`)
      run.status = code === 0 ? 'completed' : 'failed'
      run.endedAt = Date.now()
      run.process = null
      console.log(`[bot-server] run ${runId} finished with code ${code}`)
      cleanupOldRuns()
    })

    console.log(`[bot-server] started run ${runId}`)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ runId }))
  }

  // ── Run status (polling) ─────────────────────────────────────────────────

  if (req.method === 'GET' && req.url?.startsWith('/run-status')) {
    if (!checkAuth(req, res)) return

    const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams
    const runId = urlParams.get('runId')
    const offset = parseInt(urlParams.get('offset') ?? '0', 10)

    // If no runId, check for any active run
    const run = runId
      ? activeRuns.get(runId)
      : [...activeRuns.values()].find(r => r.status === 'running')

    if (!run) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ status: 'not_found', logs: [], totalLines: 0, stats: {} }))
    }

    const newLogs = run.logs.slice(offset)
    const stats = extractStats(run.logs)
    const durationSeconds = run.endedAt
      ? Math.round((run.endedAt - run.startedAt) / 1000)
      : Math.round((Date.now() - run.startedAt) / 1000)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({
      runId: run.id,
      status: run.status,
      logs: newLogs,
      totalLines: run.logs.length,
      stats,
      durationSeconds,
    }))
  }

  // ── Cancel run ───────────────────────────────────────────────────────────

  if (req.method === 'POST' && req.url === '/cancel') {
    if (!checkAuth(req, res)) return

    const body = await parseBody(req)
    const runId = body.runId

    const run = runId
      ? activeRuns.get(runId)
      : [...activeRuns.values()].find(r => r.status === 'running')

    if (!run || run.status !== 'running') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'No running process found' }))
    }

    if (run.process && !run.process.killed) {
      run.process.kill()
    }
    run.status = 'cancelled'
    run.endedAt = Date.now()
    run.logs.push('🛑 Execução cancelada pelo usuário')
    run.process = null

    console.log(`[bot-server] run ${run.id} cancelled`)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true }))
  }

  // ── Run bot (manual) — keeps SSE for short runs ──────────────────────────


  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`🚀 Bot server running on port ${PORT}`)
})
