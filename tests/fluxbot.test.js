import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import as2 from 'activitystrea.ms'
import { nockSetup, nockFormat, postInbox, getBody, resetInbox, resetBodies } from '@evanp/activitypub-nock'
import { getTestDatabaseUrl, cleanupTestDatabase } from './utils/db.js'
import { sendActivity } from './utils/activities.js'
import { makeApp } from '@evanp/activitypub-bot'
import { FluxBot } from '../lib/fluxbot.js'

describe('FluxBot initialization', async () => {
  const host = 'flux.test'
  const origin = `https://${host}`
  const databaseUrl = getTestDatabaseUrl()

  const remote1 = 'remote1.test'
  const remote2 = 'remote2.test'
  const remote3 = 'remote3.test'
  const remote4 = 'remote4.test'
  const actor1 = 'actor1'
  const actor2 = 'actor2'
  const actor3 = 'actor3'
  const actor4 = 'actor4'

  before(async () => {
    await cleanupTestDatabase()
    resetInbox()
    resetBodies()
    nockSetup(remote1)
    nockSetup(remote2)
    nockSetup(remote3)
    nockSetup(remote4)
  })

  after(async () => {
    await cleanupTestDatabase()
  })

  it('can initialize, accept follows, unfollow on re-initialization, and accept a remote follower', async (t) => {
    let app = null
    try {
      // Create app with 3 sources
      const sources = [
        'https://remote1.test/user/actor1',
        'https://remote2.test/user/actor2',
        'https://remote3.test/user/actor3'
      ]
      const testBots = {
        flux: new FluxBot('flux', { sources })
      }

      app = await makeApp({
        databaseUrl,
        origin,
        bots: testBots,
        logLevel: 'info',
        allowPrivateNetworkRequests: true,
        deliveryWorkerCount: databaseUrl === 'sqlite::memory:' ? 1 : undefined
      })
      assert.ok(app)

      await app.onIdle()

      // Verify that Follow activities were sent to all 3 remote actors
      assert.ok(postInbox[actor1] > 0, `Expected Follow to be sent to ${actor1}, got ${postInbox[actor1] || 0}`)
      assert.ok(postInbox[actor2] > 0, `Expected Follow to be sent to ${actor2}, got ${postInbox[actor2] || 0}`)
      assert.ok(postInbox[actor3] > 0, `Expected Follow to be sent to ${actor3}, got ${postInbox[actor3] || 0}`)

      // Get the Follow activity IDs from the remote inboxes using getBody
      const actor1Inbox = 'https://remote1.test/user/actor1/inbox'
      const actor2Inbox = 'https://remote2.test/user/actor2/inbox'
      const actor3Inbox = 'https://remote3.test/user/actor3/inbox'

      const follow1Activity = JSON.parse(getBody(actor1Inbox))
      const follow2Activity = JSON.parse(getBody(actor2Inbox))
      const follow3Activity = JSON.parse(getBody(actor3Inbox))
      for (const follow of [follow1Activity, follow2Activity, follow3Activity]) {
        assert.strictEqual(follow.type, 'Follow')
        assert.ok(follow.id)
      }

      // Send Accept for actor1 and actor2, leave actor3 pending
      const accept1 = await sendActivity(app, actor1, remote1, {
        type: 'Accept',
        object: follow1Activity.id
      })
      const accept2 = await sendActivity(app, actor2, remote2, {
        type: 'Accept',
        object: follow2Activity.id
      })

      assert.strictEqual(accept1.status, 202, `Accept for actor1: ${accept1.text}`)
      assert.strictEqual(accept2.status, 202, `Accept for actor2: ${accept2.text}`)

      // Wait for Accept activities to be processed
      await app.onIdle()

      const context = testBots.flux._context
      const [source1, source2, source3] = await Promise.all(
        sources.map(id => as2.import({ id }))
      )
      assert.strictEqual(await context.isFollowing(source1), true)
      assert.strictEqual(await context.isFollowing(source2), true)
      assert.strictEqual(await context.isPendingFollowing(source1), false)
      assert.strictEqual(await context.isPendingFollowing(source2), false)
      assert.strictEqual(await context.isFollowing(source3), false)
      assert.strictEqual(await context.isPendingFollowing(source3), true)

      const inboxCounts = { ...postInbox }

      // Re-initialize with only actor1 - this should unfollow actor2 and actor3
      const newSources = ['https://remote1.test/user/actor1']
      const newFluxBot = new FluxBot('flux', { sources: newSources })
      await newFluxBot.initialize(context)

      await app.onIdle()

      // Verify that Undo activities were sent to actor2 and actor3
      assert.strictEqual(postInbox[actor1], inboxCounts[actor1], 'Retained source should receive no new activity')
      for (const [actor, inbox, follow] of [
        [actor2, actor2Inbox, follow2Activity],
        [actor3, actor3Inbox, follow3Activity]
      ]) {
        assert.strictEqual(postInbox[actor], inboxCounts[actor] + 1, `Expected a new Undo to be sent to ${actor}`)
        const undo = JSON.parse(getBody(inbox))
        assert.strictEqual(undo.type, 'Undo')
        assert.strictEqual(undo.actor, `${origin}/user/flux`)
        assert.strictEqual(undo.object.type, 'Follow')
        assert.strictEqual(undo.object.id, follow.id)
      }
      assert.strictEqual(await context.isFollowing(source1), true)
      assert.strictEqual(await context.isFollowing(source2), false)
      assert.strictEqual(await context.isFollowing(source3), false)
      assert.strictEqual(await context.isPendingFollowing(source1), false)
      assert.strictEqual(await context.isPendingFollowing(source2), false)
      assert.strictEqual(await context.isPendingFollowing(source3), false)

      // Receive a Follow from a fourth actor that is not a configured source.
      const followerId = nockFormat({ username: actor4, domain: remote4 })
      const follower = await as2.import({ id: followerId })
      const actor4Inbox = nockFormat({ username: actor4, domain: remote4, collection: 'inbox' })
      const follow4Id = nockFormat({ username: actor4, domain: remote4, type: 'Follow', num: Date.now() })
      assert.strictEqual(await context.isFollower(follower), false)
      const deliveries = t.mock.method(app.locals.client, 'post')

      const follow4 = await sendActivity(app, actor4, remote4, {
        id: follow4Id,
        type: 'Follow',
        object: context.botActorId,
        to: context.botActorId
      })
      assert.strictEqual(follow4.status, 202, `Follow from actor4: ${follow4.text}`)
      await app.onIdle()

      assert.strictEqual(await context.isFollower(follower), true)
      assert.strictEqual(await context.isFollowing(follower), false)
      assert.strictEqual(await context.isPendingFollowing(follower), false)

      // The spy preserves real delivery to the mock remote inbox.
      const replies = await Promise.all(deliveries.mock.calls
        .filter(call => call.arguments[0] === actor4Inbox)
        .map(async call => {
          await call.result
          return call.arguments[1].export()
        }))
      const accept4 = replies.find(activity => activity.type === 'Accept' && activity.object === follow4Id)
      assert.ok(accept4, 'Expected an Accept referencing actor4\'s Follow to be delivered to actor4')
      assert.strictEqual(accept4.actor, context.botActorId)
    } finally {
      if (app) {
        await app.cleanup()
      }
    }
  })
})
