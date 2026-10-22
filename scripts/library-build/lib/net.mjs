// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

import { createHash } from 'node:crypto'
import { remoteUrlProblem } from './keys.mjs'

/** H1's caps, counted while streaming, whatever size the API claimed. */
export const CAPS = Object.freeze({
  api: 1 * 1024 * 1024,
  gltf: 4 * 1024 * 1024,
  include: 32 * 1024 * 1024,
  modelTotal: 64 * 1024 * 1024,
  skySource: 96 * 1024 * 1024,
  thumbnail: 2 * 1024 * 1024,
})

export const USER_AGENT = 'atrium-library-build/1 (+https://ewwb.dev)'
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 60_000

export class FetchRefused extends Error {}

/**
 * The tool's only way onto the network.
 *
 * - every URL (and every redirect hop) must pass `remoteUrlProblem`;
 * - redirects are followed by hand, at most 3;
 * - the body is counted while it streams and aborted past `cap`;
 * - then the claimed `size` and `md5`, if given, must match;
 * - one retry on a 5xx; 60 s per request; one request at a time (callers
 *   await each call).
 *
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchFn]
 * @param {number} [opts.timeoutMs]
 */
export function createFetcher({ fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  let requests = 0

  async function once(url, cap) {
    let current = url
    for (let hop = 0; ; hop++) {
      const problem = remoteUrlProblem(current)
      if (problem) throw new FetchRefused(problem)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new FetchRefused(`timed out: ${current}`)), timeoutMs)
      try {
        requests++
        const response = await fetchFn(current, {
          method: 'GET',
          redirect: 'manual',
          headers: { 'user-agent': USER_AGENT, accept: '*/*' },
          signal: controller.signal,
        })
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel().catch(() => {})
          if (hop >= MAX_REDIRECTS) throw new FetchRefused(`too many redirects: ${url}`)
          const location = response.headers.get('location')
          if (!location) throw new FetchRefused(`redirect without location: ${current}`)
          current = new URL(location, current).href
          continue
        }
        if (response.status >= 500) {
          await response.body?.cancel().catch(() => {})
          return { retry: true, status: response.status }
        }
        if (response.status !== 200) {
          await response.body?.cancel().catch(() => {})
          throw new FetchRefused(`HTTP ${response.status}: ${current}`)
        }
        const declared = Number(response.headers.get('content-length'))
        if (Number.isFinite(declared) && declared > cap) {
          await response.body?.cancel().catch(() => {})
          throw new FetchRefused(`larger than ${cap} bytes (declared ${declared}): ${current}`)
        }
        const chunks = []
        let total = 0
        if (response.body) {
          const reader = response.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > cap) {
              await reader.cancel().catch(() => {})
              throw new FetchRefused(`larger than ${cap} bytes: ${current}`)
            }
            chunks.push(value)
          }
        }
        return { retry: false, bytes: Buffer.concat(chunks, total) }
      } catch (err) {
        if (err instanceof FetchRefused) throw err
        if (controller.signal.aborted && controller.signal.reason instanceof FetchRefused) throw controller.signal.reason
        throw new FetchRefused(`network error: ${current}: ${err?.message ?? err}`)
      } finally {
        clearTimeout(timer)
      }
    }
  }

  /**
   * @param {string} url
   * @param {object} opts
   * @param {number} opts.cap
   * @param {number} [opts.size]  claimed size: must match exactly
   * @param {string} [opts.md5]   claimed md5: must match
   * @returns {Promise<Buffer>}
   */
  async function get(url, { cap, size, md5 } = {}) {
    if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error('get() needs a cap')
    if (size !== undefined && size > cap) throw new FetchRefused(`claimed size ${size} is over the cap ${cap}: ${url}`)
    let result = await once(url, cap)
    if (result.retry) result = await once(url, cap)
    if (result.retry) throw new FetchRefused(`HTTP ${result.status} twice: ${url}`)
    const bytes = result.bytes
    if (size !== undefined && bytes.length !== size) {
      throw new FetchRefused(`size ${bytes.length} differs from the claimed ${size}: ${url}`)
    }
    if (md5 !== undefined && createHash('md5').update(bytes).digest('hex') !== md5) {
      throw new FetchRefused(`md5 differs from the claimed value: ${url}`)
    }
    return bytes
  }

  async function getJson(url) {
    const bytes = await get(url, { cap: CAPS.api })
    try { return JSON.parse(bytes.toString('utf8')) } catch { throw new FetchRefused(`not JSON: ${url}`) }
  }

  return { get, getJson, get requests() { return requests } }
}
