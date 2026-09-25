// YouTube: channel RSS feed at build time (no CORS, so never from the browser), with an optional
// Data API fallback when YOUTUBE_API_KEY is set. Skipped until site.youtube.channelId is set.
import { parseYouTubeFeed, normalizePlaylistItems, uploadsPlaylistId } from '../../../src/lib/normalize/youtube.mjs'
import { skip } from '../run-source.mjs'

const channelUrlOf = (channelId) => `https://www.youtube.com/channel/${channelId}`

/**
 * The fallback shape for youtube.json. Once a channel is configured, even a failed first fetch
 * reports configured:true with its channelUrl; configured:false is only for skipped:not-configured.
 */
export function youtubeDefaults(site, def) {
  const channelId = site.youtube?.channelId
  return channelId ? { ...def, configured: true, channelUrl: channelUrlOf(channelId) } : def
}

export async function fetchYouTube({ http, site, env = {}, raw = () => {} }) {
  const channelId = site.youtube?.channelId
  if (!channelId) skip('not-configured')
  const max = site.youtube.maxVideos ?? 12
  const channelUrl = channelUrlOf(channelId)

  let videos
  try {
    const xml = await http.fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`)
    raw('youtube-feed', xml)
    videos = parseYouTubeFeed(xml, { limit: max })
  } catch (feedError) {
    const key = env.YOUTUBE_API_KEY?.trim()
    if (!key) throw feedError
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId(channelId),
      maxResults: String(Math.min(max, 50)),
      key,
    })
    const json = await http.fetchJson(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`)
    raw('youtube-api', json)
    videos = normalizePlaylistItems(json, { limit: max })
  }

  return { configured: true, channelUrl, videos }
}
