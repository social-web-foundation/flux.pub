import { describe, it } from 'node:test'
import assert from 'node:assert'

describe('FluxBot', async () => {
  it('can import FluxBot', async () => {
    const { FluxBot } = await import('../lib/fluxbot.js')
    assert.ok(FluxBot)
    assert.strictEqual(typeof FluxBot, 'function')
  })
})
