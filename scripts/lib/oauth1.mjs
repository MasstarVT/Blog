// OAuth 1.0a request signing (RFC 5849, HMAC-SHA1) for the optional X API provider.
import { createHmac, randomBytes } from 'node:crypto'

/** RFC 3986 percent-encoding (encodeURIComponent leaves !'()* alone). */
export function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** Query string encoded the same way the signature sees it. */
export function encodeQuery(params) {
  return Object.entries(params).map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`).join('&')
}

/** scheme://host[:non-default-port]/path, lower-cased scheme and host, no query or fragment. */
export function baseStringUri(url) {
  const u = new URL(url)
  return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}`
}

const toPairs = (params) => (Array.isArray(params) ? params : Object.entries(params))

/** Signature base string: METHOD&uri&normalized-params (§3.4.1). */
export function signatureBaseString(method, url, params) {
  const pairs = toPairs(params)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)])
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
  const normalized = pairs.map(([k, v]) => `${k}=${v}`).join('&')
  return [method.toUpperCase(), percentEncode(baseStringUri(url)), percentEncode(normalized)].join('&')
}

export function hmacSha1Signature(baseString, consumerSecret, tokenSecret = '') {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret ?? '')}`
  return createHmac('sha1', key).update(baseString).digest('base64')
}

/**
 * Authorization header value for a request. Query parameters of `url` and form-encoded
 * `bodyParams` are part of the signature; `nonce`/`timestamp` are injectable for tests.
 */
export function oauth1Header({
  method = 'GET', url, consumerKey, consumerSecret, token, tokenSecret, bodyParams = {},
  nonce = randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000),
}) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp),
    ...(token ? { oauth_token: token } : {}),
    oauth_version: '1.0',
  }
  const params = [...new URL(url).searchParams, ...toPairs(bodyParams), ...Object.entries(oauth)]
  const signature = hmacSha1Signature(signatureBaseString(method, url, params), consumerSecret, tokenSecret)
  const header = Object.entries({ ...oauth, oauth_signature: signature })
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ')
  return `OAuth ${header}`
}
