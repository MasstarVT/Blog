import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { request, fetchJson, fetchText, HttpError, OfflineError, createHttp, redactUrl, USER_AGENT } from '../lib/http.mjs'

// Scripted local server: each path answers from a queue of responses; hits are counted.
let server
let base
const hits = new Map()
const lastHeaders = new Map()
const scripts = {
  '/flaky': [{ status: 503 }, { status: 200, body: '{"ok":true}' }],
  '/limited': [{ status: 429, headers: { 'Retry-After': '0' } }, { status: 200, body: 'fine' }],
  '/always-500': [{ status: 500 }, { status: 500 }, { status: 500 }],
  '/missing': [{ status: 404 }, { status: 200 }],
  '/bad-json': [{ status: 200, body: '<html>' }],
  '/echo': null,
  '/hang': 'hang',
}

before(async () => {
  server = createServer((req, res) => {
    const path = req.url.split('?')[0]
    hits.set(path, (hits.get(path) ?? 0) + 1)
    lastHeaders.set(path, req.headers)
    const script = scripts[path]
    if (script === 'hang') return // never answer
    if (script === null) {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ method: req.method, body, ua: req.headers['user-agent'], custom: req.headers['x-custom'] }))
      })
      return
    }
    const step = script?.[hits.get(path) - 1] ?? { status: 418 }
    res.writeHead(step.status, step.headers ?? {})
    res.end(step.body ?? '')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.closeAllConnections()
  server.close()
})

const fast = { backoffMs: 5 }

test('retries once on 5xx and succeeds', async () => {
  assert.deepEqual(await fetchJson(`${base}/flaky`, fast), { ok: true })
  assert.equal(hits.get('/flaky'), 2)
})

test('retries once on 429 (Retry-After honoured)', async () => {
  assert.equal(await fetchText(`${base}/limited`, fast), 'fine')
  assert.equal(hits.get('/limited'), 2)
})

test('gives up after the retry with HttpError', async () => {
  await assert.rejects(fetchText(`${base}/always-500`, fast), (err) => {
    assert.ok(err instanceof HttpError)
    assert.equal(err.status, 500)
    assert.equal(err.url, `${base}/always-500`)
    return true
  })
  assert.equal(hits.get('/always-500'), 2)
})

test('does not retry a 404', async () => {
  await assert.rejects(fetchText(`${base}/missing`, fast), (err) => err instanceof HttpError && err.status === 404)
  assert.equal(hits.get('/missing'), 1)
})

test('retries: 0 disables retrying', async () => {
  hits.delete('/flaky')
  await assert.rejects(fetchJson(`${base}/flaky`, { ...fast, retries: 0 }), (err) => err.status === 503)
  assert.equal(hits.get('/flaky'), 1)
})

test('invalid JSON is an error', async () => {
  await assert.rejects(fetchJson(`${base}/bad-json`, fast), /Invalid JSON/)
})

test('sends User-Agent, custom headers, method and body', async () => {
  const res = await fetchJson(`${base}/echo`, { method: 'POST', body: 'a=1&b=2', headers: { 'X-Custom': 'yes' } })
  assert.deepEqual(res, { method: 'POST', body: 'a=1&b=2', ua: USER_AGENT, custom: 'yes' })
})

test('timeouts are retried, then reported without the query string secrets', async () => {
  const started = Date.now()
  await assert.rejects(request(`${base}/hang?key=SECRET123`, { timeoutMs: 100, ...fast }), (err) => {
    assert.match(err.message, /timeout/)
    assert.ok(!err.message.includes('SECRET123'))
    return true
  })
  assert.equal(hits.get('/hang'), 2)
  assert.ok(Date.now() - started < 5000)
})

test('network errors are retried then thrown', async () => {
  const closed = createServer()
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve))
  const port = closed.address().port
  await new Promise((resolve) => closed.close(resolve))
  await assert.rejects(fetchText(`http://127.0.0.1:${port}/`, fast), /Network error/)
})

test('injectable fetch and offline client', async () => {
  let calls = 0
  const fake = async () => {
    calls++
    return new Response('{"a":1}', { status: 200 })
  }
  const http = createHttp({ fetch: fake })
  assert.deepEqual(await http.fetchJson('https://example.test/x'), { a: 1 })
  assert.equal(calls, 1)

  const offline = createHttp({ fetch: fake, offline: true })
  await assert.rejects(offline.fetchText('https://example.test/y?token=abc'), (err) => {
    assert.ok(err instanceof OfflineError)
    assert.ok(!err.message.includes('abc'))
    return true
  })
  assert.equal(calls, 1)
})

test('redactUrl hides secrets and credentials', () => {
  assert.equal(
    redactUrl('https://user:pw@api.example/x?key=1&client_secret=2&access_token=3&q=ok'),
    'https://api.example/x?key=REDACTED&client_secret=REDACTED&access_token=REDACTED&q=ok',
  )
  assert.equal(redactUrl('not a url'), '[invalid url]')
})
