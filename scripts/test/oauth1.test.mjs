import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  percentEncode, encodeQuery, baseStringUri, signatureBaseString, hmacSha1Signature, oauth1Header,
} from '../lib/oauth1.mjs'

// The "Creating a signature" example from the Twitter/X developer docs.
const DOC = {
  method: 'POST',
  url: 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true',
  bodyParams: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
  consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
  consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
  token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
  tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
  timestamp: 1318622958,
}

const DOC_BASE_STRING = 'POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521'

test('percentEncode follows RFC 3986', () => {
  assert.equal(percentEncode('Ladies + Gentlemen'), 'Ladies%20%2B%20Gentlemen')
  assert.equal(percentEncode("!*'()"), '%21%2A%27%28%29')
  assert.equal(percentEncode('-._~'), '-._~')
  assert.equal(percentEncode('☃'), '%E2%98%83')
  assert.equal(encodeQuery({ exclude: 'replies,retweets', 'tweet.fields': 'created_at' }), 'exclude=replies%2Cretweets&tweet.fields=created_at')
})

test('base string URI drops query and default port, lower-cases host', () => {
  assert.equal(baseStringUri('HTTPS://API.X.com:443/2/users?x=1#f'), 'https://api.x.com/2/users')
  assert.equal(baseStringUri('http://example.com:8080/p'), 'http://example.com:8080/p')
})

test('known-answer: Twitter docs "Creating a signature" example', () => {
  const oauth = {
    oauth_consumer_key: DOC.consumerKey,
    oauth_nonce: DOC.nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(DOC.timestamp),
    oauth_token: DOC.token,
    oauth_version: '1.0',
  }
  const params = [...new URL(DOC.url).searchParams, ...Object.entries(DOC.bodyParams), ...Object.entries(oauth)]
  const base = signatureBaseString(DOC.method, DOC.url, params)
  assert.equal(base, DOC_BASE_STRING)
  assert.equal(hmacSha1Signature(base, DOC.consumerSecret, DOC.tokenSecret), 'hCtSmYh+iHYCEqBWrE7C7hYmtUk=')
})

test('oauth1Header produces the documented signature in a well-formed header', () => {
  const header = oauth1Header(DOC)
  assert.match(header, /^OAuth /)
  assert.ok(header.includes('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"'))
  const names = [...header.matchAll(/(\w+)="/g)].map((m) => m[1])
  assert.deepEqual(names, [...names].sort())
  assert.deepEqual(names, ['oauth_consumer_key', 'oauth_nonce', 'oauth_signature', 'oauth_signature_method', 'oauth_timestamp', 'oauth_token', 'oauth_version'])
})

test('oauth1Header uses a fresh nonce by default', () => {
  const opts = { method: 'GET', url: 'https://api.x.com/2/users/1/tweets?max_results=5', consumerKey: 'k', consumerSecret: 's', token: 't', tokenSecret: 'ts' }
  assert.notEqual(oauth1Header(opts), oauth1Header(opts))
})
