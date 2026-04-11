import 'dotenv/config'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
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

function buildBotPage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prospect Bot — Auto Mode</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .subtitle { color: #888; margin-bottom: 24px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; }
    .stat-card .label { color: #888; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-card .value { font-size: 1.8rem; font-weight: 700; margin-top: 4px; }
    .stat-card .value.green { color: #4ade80; }
    .stat-card .value.yellow { color: #facc15; }
    .stat-card .value.blue { color: #60a5fa; }
    .stat-card .value.red { color: #f87171; }
    .queue-section { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .queue-section h2 { font-size: 1.1rem; margin-bottom: 12px; }
    .queue-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .queue-table th { text-align: left; color: #888; padding: 8px 12px; border-bottom: 1px solid #333; }
    .queue-table td { padding: 8px 12px; border-bottom: 1px solid #222; }
    .queue-table tr:hover { background: #222; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .badge.br { background: #065f46; color: #6ee7b7; }
    .badge.us { background: #1e3a5f; color: #93c5fd; }
    .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 24px; }
    .controls label { font-size: 0.85rem; color: #aaa; }
    .controls input[type=number] { background: #222; border: 1px solid #444; color: #fff; padding: 6px 10px; border-radius: 6px; width: 70px; }
    .controls input[type=checkbox] { accent-color: #4ade80; }
    .btn { padding: 10px 24px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9rem; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.85; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-green { background: #16a34a; color: white; }
    .btn-yellow { background: #ca8a04; color: white; }
    .log-box { background: #111; border: 1px solid #333; border-radius: 8px; padding: 16px; max-height: 400px; overflow-y: auto; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.8rem; line-height: 1.6; white-space: pre-wrap; display: none; }
    .log-box.active { display: block; }
    .loading { color: #888; font-style: italic; }
    .empty { color: #666; padding: 24px; text-align: center; }
  </style>
</head>
<body>
  <h1>Prospect Bot</h1>
  <p class="subtitle">Autonomous Mode Dashboard</p>

  <div class="stats-grid" id="stats">
    <div class="stat-card"><div class="label">Loading...</div><div class="value">-</div></div>
  </div>

  <div class="controls">
    <label>Limit/item: <input type="number" id="limit" value="20" min="1" max="60"></label>
    <label>Min score: <input type="number" id="minScore" value="4" min="0" max="10"></label>
    <label><input type="checkbox" id="sendCheck"> Send outreach</label>
    <button class="btn btn-yellow" id="btnDry" onclick="runAuto(true)">Dry Run</button>
    <button class="btn btn-green" id="btnRun" onclick="runAuto(false)">Run Auto Mode</button>
  </div>

  <div class="queue-section">
    <h2>Queue Preview</h2>
    <div id="queueBody"><p class="loading">Loading queue...</p></div>
  </div>

  <div class="log-box" id="logBox"></div>

  <script>
    const API_BASE = location.origin;

    async function loadQueue() {
      try {
        const res = await fetch(API_BASE + '/api/bot/queue');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        renderStats(data.stats, data.summary);
        renderQueue(data.queue);
      } catch (err) {
        document.getElementById('stats').innerHTML = '<div class="stat-card"><div class="label">Error</div><div class="value red">' + err.message + '</div></div>';
      }
    }

    function renderStats(s, summary) {
      document.getElementById('stats').innerHTML = \`
        <div class="stat-card"><div class="label">Total Combos</div><div class="value blue">\${s.total.toLocaleString()}</div></div>
        <div class="stat-card"><div class="label">Already Prospected</div><div class="value green">\${s.prospected.toLocaleString()}</div></div>
        <div class="stat-card"><div class="label">Remaining Queue</div><div class="value yellow">\${s.remaining.toLocaleString()}</div></div>
        <div class="stat-card"><div class="label">Est. Leads</div><div class="value blue">~\${summary.estimatedLeads.toLocaleString()}</div></div>
        <div class="stat-card"><div class="label">WA Sent Today</div><div class="value">\${s.whatsappSentToday}/50</div></div>
        <div class="stat-card"><div class="label">WA Slots Left</div><div class="value \${s.whatsappSlotsLeft > 0 ? 'green' : 'red'}">\${s.whatsappSlotsLeft}</div></div>
        <div class="stat-card"><div class="label">BR Queue</div><div class="value">\${summary.br.toLocaleString()}</div></div>
        <div class="stat-card"><div class="label">US Queue</div><div class="value">\${summary.us.toLocaleString()}</div></div>
      \`;
    }

    function renderQueue(queue) {
      if (!queue.length) {
        document.getElementById('queueBody').innerHTML = '<p class="empty">Queue is empty — all combos prospected!</p>';
        return;
      }
      let html = '<table class="queue-table"><thead><tr><th>#</th><th>Niche</th><th>City</th><th>Market</th><th>Lang</th></tr></thead><tbody>';
      queue.forEach((item, i) => {
        html += \`<tr>
          <td>\${i + 1}</td>
          <td>\${item.niche}</td>
          <td>\${item.searchCity}</td>
          <td><span class="badge \${item.country.toLowerCase()}">\${item.country}</span></td>
          <td>\${item.lang}</td>
        </tr>\`;
      });
      html += '</tbody></table>';
      if (queue.length >= 100) html += '<p style="color:#888;margin-top:8px;font-size:0.8rem;">Showing first 100 items</p>';
      document.getElementById('queueBody').innerHTML = html;
    }

    function runAuto(dry) {
      const logBox = document.getElementById('logBox');
      logBox.classList.add('active');
      logBox.textContent = '';

      const btnDry = document.getElementById('btnDry');
      const btnRun = document.getElementById('btnRun');
      btnDry.disabled = true;
      btnRun.disabled = true;

      const body = {
        limit: parseInt(document.getElementById('limit').value) || 20,
        min_score: parseInt(document.getElementById('minScore').value) || 4,
        dry_run: dry,
        send: !dry && document.getElementById('sendCheck').checked,
      };

      const es = new EventSource(API_BASE + '/run-auto?' + new URLSearchParams({ _body: JSON.stringify(body) }));

      // EventSource only does GET, so use fetch with SSE parsing instead
      es.close();

      fetch(API_BASE + '/run-auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (res) => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const payload = line.slice(6);
              if (payload === '[DONE]') {
                btnDry.disabled = false;
                btnRun.disabled = false;
                loadQueue(); // refresh stats
                return;
              }
              try {
                const { line: text } = JSON.parse(payload);
                logBox.textContent += text + '\\n';
                logBox.scrollTop = logBox.scrollHeight;
              } catch {}
            }
          }
        }
        btnDry.disabled = false;
        btnRun.disabled = false;
      }).catch(err => {
        logBox.textContent += '\\nError: ' + err.message;
        btnDry.disabled = false;
        btnRun.disabled = false;
      });
    }

    loadQueue();
  </script>
</body>
</html>`;
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
  if (req.method === 'GET' && req.url === '/api/bot/queue') {
    const auth = req.headers['authorization'] || ''
    if (BOT_SECRET && auth !== `Bearer ${BOT_SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Unauthorized' }))
    }

    try {
      const { queue, stats } = await generateQueue()
      // Group queue by country for the UI
      const brItems = queue.filter(i => i.country === 'BR')
      const usItems = queue.filter(i => i.country === 'US')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({
        stats,
        queue: queue.slice(0, 100), // first 100 for preview
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

  // Auto mode UI
  if (req.method === 'GET' && req.url === '/bot') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(buildBotPage())
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

    const args = [
      prospectPath,
      '--auto',
      '--limit', String(limit),
      '--min-score', String(minScore),
      '--export', 'supabase',
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
      sendEvent(code === 0 ? '✅ Modo autônomo finalizado' : `❌ Encerrou com código ${code}`)
      res.write('data: [DONE]\n\n')
      res.end()
    })

    req.on('close', () => { if (!child.killed) child.kill() })
    return
  }

  // Run bot (manual)
  if (req.method === 'POST' && req.url === '/run') {
    // Auth
    const auth = req.headers['authorization'] || ''
    if (BOT_SECRET && auth !== `Bearer ${BOT_SECRET}`) {
      res.writeHead(401)
      return res.end('Unauthorized')
    }

    const body = await parseBody(req)
    // Accept both camelCase and snake_case (dashboard sends snake_case)
    const niche       = body.niche
    const city        = body.city
    const limit       = body.limit ?? body.limit_count ?? '20'
    const minScore    = body.min_score ?? body.minScore ?? '4'
    const lang        = body.lang ?? 'pt'
    const exportTarget = body.export_target ?? body.exportTarget ?? 'both'
    const dryRun      = body.dry_run ?? body.dryRun ?? false
    const send        = body.send ?? false

    if (!niche || !city) {
      res.writeHead(400)
      return res.end('niche and city are required')
    }

    // Build args
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

    // SSE headers
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

    // Handle client disconnect
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
