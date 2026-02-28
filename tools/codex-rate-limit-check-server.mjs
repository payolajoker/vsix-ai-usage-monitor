import { spawn } from 'child_process';
import http from 'http';

const PORT = Number(process.env.PORT || 47931);
const HOST = '127.0.0.1';
const TIMEOUT_MS = 7000;

const HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codex Rate Limit Check</title>
  <style>
    :root {
      --bg: #f3f6fb;
      --card: #ffffff;
      --text: #152033;
      --muted: #5f6b80;
      --ok: #0a8f4d;
      --warn: #b97800;
      --err: #b42318;
      --line: #dde4ee;
      --btn: #0f62fe;
      --btn-hover: #0043ce;
    }
    body {
      margin: 0;
      font-family: "Segoe UI", "Noto Sans KR", sans-serif;
      background: linear-gradient(160deg, #eef3ff 0%, var(--bg) 60%);
      color: var(--text);
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 20px;
    }
    .card {
      width: min(860px, 100%);
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 10px 30px rgba(15, 34, 68, 0.08);
      padding: 20px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
    }
    p {
      margin: 0 0 14px;
      color: var(--muted);
    }
    .row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    button {
      border: 0;
      border-radius: 10px;
      padding: 10px 14px;
      color: white;
      background: var(--btn);
      cursor: pointer;
      font-weight: 600;
    }
    button:hover { background: var(--btn-hover); }
    .chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 10px;
      color: var(--muted);
      background: #f7f9fd;
      font-size: 12px;
    }
    .status {
      margin: 8px 0 14px;
      padding: 10px 12px;
      border-radius: 10px;
      font-weight: 600;
      border: 1px solid var(--line);
      background: #f9fbff;
      color: var(--muted);
    }
    .status.ok { color: var(--ok); border-color: #b8e3ca; background: #ecfaf2; }
    .status.warn { color: var(--warn); border-color: #f2ddb0; background: #fff8e8; }
    .status.err { color: var(--err); border-color: #f2c1c1; background: #fff1f1; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 8px;
      text-align: left;
      font-size: 13px;
    }
    th { background: #f7f9fd; }
    pre {
      margin: 0;
      padding: 12px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #0f1728;
      color: #d7e3ff;
      max-height: 320px;
      overflow: auto;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Codex Rate Limit Check</h1>
    <p>Extension 적용 전에 <code>codex app-server</code> 조회가 되는지 확인하는 페이지입니다.</p>

    <div class="row">
      <button id="checkBtn">지금 확인</button>
      <span class="chip">Endpoint: <code>/api/rate-limits</code></span>
      <span class="chip">Timeout: 7s</span>
    </div>

    <div id="status" class="status">대기 중</div>

    <table>
      <thead>
        <tr>
          <th>Window</th>
          <th>Used %</th>
          <th>Resets At</th>
          <th>Limit Id</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Primary (5h)</td>
          <td id="pUsed">-</td>
          <td id="pReset">-</td>
          <td id="limitId" rowspan="2">-</td>
        </tr>
        <tr>
          <td>Secondary (7d)</td>
          <td id="sUsed">-</td>
          <td id="sReset">-</td>
        </tr>
      </tbody>
    </table>

    <pre id="raw">-</pre>
  </div>

  <script>
    const statusEl = document.getElementById('status');
    const pUsed = document.getElementById('pUsed');
    const pReset = document.getElementById('pReset');
    const sUsed = document.getElementById('sUsed');
    const sReset = document.getElementById('sReset');
    const limitId = document.getElementById('limitId');
    const raw = document.getElementById('raw');

    function setStatus(text, cls) {
      statusEl.className = 'status ' + cls;
      statusEl.textContent = text;
    }

    async function check() {
      setStatus('조회 중...', 'warn');
      try {
        const res = await fetch('/api/rate-limits');
        const data = await res.json();
        raw.textContent = JSON.stringify(data, null, 2);

        if (!res.ok || !data.ok) {
          pUsed.textContent = '-';
          pReset.textContent = '-';
          sUsed.textContent = '-';
          sReset.textContent = '-';
          limitId.textContent = '-';
          setStatus('실패: ' + (data.error || res.statusText), 'err');
          return;
        }

        const snap = data.snapshot || {};
        const primary = snap.primary || {};
        const secondary = snap.secondary || {};

        pUsed.textContent = Number.isFinite(primary.usedPercent) ? primary.usedPercent + '%' : '-';
        pReset.textContent = primary.resetsAtIso || '-';
        sUsed.textContent = Number.isFinite(secondary.usedPercent) ? secondary.usedPercent + '%' : '-';
        sReset.textContent = secondary.resetsAtIso || '-';
        limitId.textContent = snap.limitId || '-';

        setStatus('성공: app-server 조회 가능', 'ok');
      } catch (err) {
        setStatus('실패: ' + err.message, 'err');
      }
    }

    document.getElementById('checkBtn').addEventListener('click', check);
  </script>
</body>
</html>`;

function unixToIso(ts) {
  if (!ts) {
    return '';
  }
  const ms = ts > 9999999999 ? ts : ts * 1000;
  return new Date(ms).toISOString();
}

function normalizeSnapshot(result) {
  const byLimitId = result?.rateLimitsByLimitId;
  let snap = null;

  if (byLimitId && typeof byLimitId === 'object') {
    if (byLimitId.codex) {
      snap = byLimitId.codex;
    } else {
      for (const [k, v] of Object.entries(byLimitId)) {
        const label = `${k} ${v?.limitId || ''} ${v?.limitName || ''}`.toLowerCase();
        if (label.includes('codex')) {
          snap = v;
          break;
        }
      }
      if (!snap) {
        const first = Object.values(byLimitId)[0];
        if (first) {
          snap = first;
        }
      }
    }
  }

  if (!snap && result?.rateLimits) {
    snap = result.rateLimits;
  }

  if (!snap) {
    return null;
  }

  return {
    limitId: snap.limitId || null,
    limitName: snap.limitName || null,
    primary: snap.primary
      ? {
          usedPercent: snap.primary.usedPercent,
          resetsAt: snap.primary.resetsAt ?? null,
          resetsAtIso: unixToIso(snap.primary.resetsAt),
          windowDurationMins: snap.primary.windowDurationMins ?? null,
        }
      : null,
    secondary: snap.secondary
      ? {
          usedPercent: snap.secondary.usedPercent,
          resetsAt: snap.secondary.resetsAt ?? null,
          resetsAtIso: unixToIso(snap.secondary.resetsAt),
          windowDurationMins: snap.secondary.windowDurationMins ?? null,
        }
      : null,
  };
}

function spawnCodexAppServer() {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', 'codex app-server --listen stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }
  return spawn('codex', ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function readRateLimitsOnce() {
  return new Promise((resolve, reject) => {
    const child = spawnCodexAppServer();
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const cleanup = () => {
      clearTimeout(timeout);
      try { child.stdin.end(); } catch {}
      try { child.kill(); } catch {}
    };

    const finishOk = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const finishErr = (message) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    child.on('error', (err) => {
      finishErr(`Failed to start codex app-server: ${err.message}`);
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      if (stderrBuffer.length > 8000) {
        stderrBuffer = stderrBuffer.slice(-8000);
      }
    });

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const t = line.trim();
        if (!t) {
          continue;
        }
        let msg;
        try {
          msg = JSON.parse(t);
        } catch {
          continue;
        }

        if (msg.id !== 2) {
          continue;
        }

        if (msg.error) {
          finishErr(`account/rateLimits/read failed: ${msg.error.message || 'Unknown error'}`);
          return;
        }

        finishOk(msg.result || {});
        return;
      }
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }
      const detail = stderrBuffer.trim() ? ` stderr=${stderrBuffer.trim()}` : '';
      finishErr(`codex app-server exited early (code=${code}, signal=${signal}).${detail}`);
    });

    const timeout = setTimeout(() => {
      finishErr('Timed out while waiting for account/rateLimits/read response');
    }, TIMEOUT_MS);

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'codex-rate-limit-check', version: '0.1.0' },
          capabilities: { experimentalApi: true },
        },
      })}\n`
    );
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: null })}\n`
    );
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.url === '/api/rate-limits') {
    try {
      const result = await readRateLimitsOnce();
      const snapshot = normalizeSnapshot(result);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify(
          {
            ok: true,
            snapshot,
            raw: result,
          },
          null,
          2
        )
      );
      return;
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }, null, 2));
      return;
    }
  }

  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`Codex rate-limit check page: http://${HOST}:${PORT}`);
});
