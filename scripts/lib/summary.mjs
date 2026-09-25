// Human-readable reporting for fetch-data: console table, GitHub step summary, ::warning:: lines.

export const TWITCH_PARTS = ['user', 'live', 'schedule', 'videos', 'clips']
export const SOURCES = ['twitch', 'discord', 'bluesky', 'youtube', 'x']

/** ok and skipped:* are expected outcomes; stale and empty are problems. */
export const isAcceptable = (status) => status === 'ok' || String(status ?? '').startsWith('skipped')

const n = (v) => (Array.isArray(v) ? v.length : 0)

function twitchDetail(t, part) {
  switch (part) {
    case 'user': return t.user?.followers != null ? `${t.user.followers} followers` : ''
    case 'live': return t.live?.isLive ? `LIVE${t.live.game ? ` (${t.live.game})` : ''}` : 'offline'
    case 'schedule': return `${n(t.schedule?.segments)} segments (${t.schedule?.source ?? 'none'})`
    case 'videos': return `${n(t.videos)} videos`
    case 'clips': return `${n(t.clips)} clips`
    default: return ''
  }
}

function fileDetail(name, f) {
  switch (name) {
    case 'discord': return f.members != null ? `${f.members} members, ${f.online ?? '?'} online` : ''
    case 'bluesky': return `${n(f.posts)} posts`
    case 'youtube': return `${n(f.videos)} videos`
    case 'x': return `source ${f.source ?? 'none'}, ${n(f.posts)} posts, ${n(f.featured)} featured`
    default: return ''
  }
}

/** One row per part: { source, part, status, detail, error? }. `errors` is keyed 'twitch.user', 'discord', ... */
export function collectRows(files, errors = {}) {
  const rows = []
  for (const name of SOURCES) {
    const f = files[name]
    if (!f) continue
    if (name === 'twitch') {
      for (const part of TWITCH_PARTS) {
        rows.push({ source: name, part, status: f.status?.[part] ?? 'empty', detail: twitchDetail(f, part), error: errors[`twitch.${part}`] })
      }
    } else {
      rows.push({ source: name, part: '', status: f.status ?? 'empty', detail: fileDetail(name, f), error: errors[name] })
    }
  }
  return rows
}

/** meta.json `sources`: one status string per file ('ok', or the non-ok twitch parts listed). */
export function sourceSummaries(files) {
  const out = {}
  for (const name of SOURCES) {
    const f = files[name]
    if (!f) continue
    if (name === 'twitch') {
      const parts = TWITCH_PARTS.map((p) => [p, f.status?.[p] ?? 'empty'])
      out.twitch = parts.every(([, s]) => s === 'ok') ? 'ok' : parts.map(([p, s]) => `${p}=${s}`).join(' ')
    } else {
      out[name] = f.status ?? 'empty'
    }
  }
  return out
}

const label = (r) => (r.part ? `${r.source}/${r.part}` : r.source)
const note = (r) => [r.detail, r.error ? `error: ${r.error}` : ''].filter(Boolean).join(' | ')

export function formatTable(rows) {
  const header = ['source', 'status', 'detail']
  const body = rows.map((r) => [label(r), r.status, note(r)])
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)))
  const line = (cells) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd()
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n')
}

const mdCell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function markdownSummary(rows, meta = {}) {
  const icon = (s) => (s === 'ok' ? '✅' : s.startsWith('skipped') ? '⏭️' : s === 'stale' ? '⚠️' : '❌')
  return [
    '### Social data',
    '',
    '| Source | Status | Detail |',
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${mdCell(label(r))} | ${icon(r.status)} ${mdCell(r.status)} | ${mdCell(note(r))} |`),
    '',
    meta.hash ? `Data hash \`${meta.hash.slice(0, 12)}\`, posts hash \`${String(meta.postsHash).slice(0, 12)}\`, built ${meta.builtAt}.` : '',
    '',
  ].join('\n')
}

const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

/**
 * GitHub Actions workflow commands for every part that is not ok: ::warning:: for stale/empty,
 * ::notice:: for skipped:*. Skipped parts are expected configuration states (no credentials,
 * source not configured) that repeat on every run, so they are annotated at notice level instead
 * of warning level to keep real failures visible. Any ok part that still carried an error note
 * (e.g. X API failed and fell back to curated posts) gets a notice too.
 */
export function warningLines(rows) {
  const text = (r) => escapeData(`${label(r)} is ${r.status}${r.error ? ` (${r.error})` : ''}`)
  return rows
    .filter((r) => r.status !== 'ok' || r.error)
    .map((r) => `::${isAcceptable(r.status) ? 'notice' : 'warning'} title=fetch-data ${label(r)}::${text(r)}`)
}
