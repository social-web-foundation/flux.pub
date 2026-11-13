import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import request from 'supertest'
import { nockSetup, nockFormat, postInbox } from '@evanp/activitypub-nock'
import { getTestDatabaseUrl, cleanupTestDatabase } from './utils/db.js'
import bots from './utils/bots.js'
import { makeApp } from '@evanp/activitypub-bot'

describe('FluxBot initialization', async () => {
  const host = 'flux.test'
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()
  
  const remote1 = 'remote1.test'
  const remote2 = 'remote2.test'
  const actor1 = 'actor1'
  const actor2 = 'actor2'

  before(async () => {
    await cleanupTestDatabase()
    nockSetup(remote1)
    nockSetup(remote2)
  })

  after(async () => {
    await cleanupTestDatabase()
  })

  it('can initialize the app and follows configured sources', async () => {
    let app = null
    try {
      app = await makeApp({ 
        databaseUrl, 
        origin, 
        bots, 
        logLevel: 'info', 
        allowPrivateNetworkRequests: true,
        deliveryWorkerCount: databaseUrl === 'sqlite::memory:' ? 1 : undefined 
      })
      assert.ok(app)
      
      await app.onIdle()
      
      // Verify that Follow activities were sent to both remote actors
      // by checking their mock inboxes
      const actor1Inbox = nockFormat({ username: actor1, domain: remote1 })
      const actor2Inbox = nockFormat({ username: actor2, domain: remote2 })
      
      // postInbox counts how many POSTs each username received
      assert.ok(postInbox[actor1] > 0, `Expected Follow to be sent to ${actor1}, got ${postInbox[actor1] || 0}`)
      assert.ok(postInbox[actor2] > 0, `Expected Follow to be sent to ${actor2}, got ${postInbox[actor2] || 0}`)
    } finally {
      if (app) {
        await app.cleanup()
      }
    }
  })
})
