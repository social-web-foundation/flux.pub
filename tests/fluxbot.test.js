import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import as2 from 'activitystrea.ms'
import { nockSetup, nockFormat, postInbox, getBody, resetInbox, resetBodies } from '@evanp/activitypub-nock'
import { getTestDatabaseUrl, cleanupTestDatabase } from './utils/db.js'
import { sendActivity } from './utils/activities.js'
import { makeApp } from '@evanp/activitypub-bot'
import { FluxBot } from '../lib/fluxbot.js'

describe('FluxBot', () => {
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
  const sources = [
    'https://remote1.test/user/actor1',
    'https://remote2.test/user/actor2',
    'https://remote3.test/user/actor3'
  ]
  const actor1Inbox = 'https://remote1.test/user/actor1/inbox'
  const actor2Inbox = 'https://remote2.test/user/actor2/inbox'
  const actor3Inbox = 'https://remote3.test/user/actor3/inbox'

  before(() => {
    nockSetup(remote1)
    nockSetup(remote2)
    nockSetup(remote3)
    nockSetup(remote4)
  })

  beforeEach(async () => {
    await cleanupTestDatabase()
    resetInbox()
    resetBodies()
  })

  after(async () => {
    await cleanupTestDatabase()
  })

  const makeTestApp = async (t, configuredSources = sources, testDatabaseUrl = databaseUrl) => {
    const fluxBot = new FluxBot('flux', { sources: configuredSources })
    const app = await makeApp({
      databaseUrl: testDatabaseUrl,
      origin,
      bots: { flux: fluxBot },
      logLevel: 'info',
      allowPrivateNetworkRequests: true,
      deliveryWorkerCount: testDatabaseUrl.startsWith('sqlite:') ? 1 : undefined
    })
    let cleanupPromise
    const close = () => {
      cleanupPromise ??= app.cleanup()
      return cleanupPromise
    }
    t.after(close)
    await app.onIdle()
    return { app, context: fluxBot._context, close }
  }

  const acceptSourceFollows = async (app) => {
    for (const [actor, domain, inbox] of [
      [actor1, remote1, actor1Inbox],
      [actor2, remote2, actor2Inbox]
    ]) {
      const follow = JSON.parse(getBody(inbox))
      const response = await sendActivity(app, actor, domain, {
        type: 'Accept',
        object: follow.id
      })
      assert.strictEqual(response.status, 202, `Accept for ${actor}: ${response.text}`)
    }
    await app.onIdle()
  }

  it('initializes configured sources and processes their Accepts', async (t) => {
    const { app, context } = await makeTestApp(t)
    assert.ok(app)

    for (const [actor, inbox] of [
      [actor1, actor1Inbox],
      [actor2, actor2Inbox],
      [actor3, actor3Inbox]
    ]) {
      assert.strictEqual(postInbox[actor], 1, `Expected a Follow to be sent to ${actor}`)
      const follow = JSON.parse(getBody(inbox))
      assert.strictEqual(follow.type, 'Follow')
      assert.ok(follow.id)
    }

    const [source1, source2, source3] = await Promise.all(
      sources.map(id => as2.import({ id }))
    )
    for (const source of [source1, source2, source3]) {
      assert.strictEqual(await context.isFollowing(source), false)
      assert.strictEqual(await context.isPendingFollowing(source), true)
    }

    await acceptSourceFollows(app)

    assert.strictEqual(await context.isFollowing(source1), true)
    assert.strictEqual(await context.isFollowing(source2), true)
    assert.strictEqual(await context.isPendingFollowing(source1), false)
    assert.strictEqual(await context.isPendingFollowing(source2), false)
    assert.strictEqual(await context.isFollowing(source3), false)
    assert.strictEqual(await context.isPendingFollowing(source3), true)
  })

  it('restarts the app with the same database and undoes removed accepted and pending Follows', async (t) => {
    const databaseDirectory = databaseUrl === 'sqlite::memory:'
      ? await mkdtemp(join(tmpdir(), 'flux-reinitialize-'))
      : null
    const restartDatabaseUrl = databaseDirectory
      ? `sqlite:${join(databaseDirectory, 'flux.sqlite')}`
      : databaseUrl
    let initialApp
    let restartedApp

    try {
      initialApp = await makeTestApp(t, sources, restartDatabaseUrl)
      const { app, context } = initialApp
      const follow2Activity = JSON.parse(getBody(actor2Inbox))
      const follow3Activity = JSON.parse(getBody(actor3Inbox))
      await acceptSourceFollows(app)

      const [source1, source2, source3] = await Promise.all(
        sources.map(id => as2.import({ id }))
      )
      assert.strictEqual(await context.isFollowing(source1), true)
      assert.strictEqual(await context.isFollowing(source2), true)
      assert.strictEqual(await context.isPendingFollowing(source2), false)
      assert.strictEqual(await context.isFollowing(source3), false)
      assert.strictEqual(await context.isPendingFollowing(source3), true)
      const inboxCounts = { ...postInbox }

      await initialApp.close()
      restartedApp = await makeTestApp(t, [sources[0]], restartDatabaseUrl)
      const restartedContext = restartedApp.context

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
      assert.strictEqual(await restartedContext.isFollowing(source1), true)
      assert.strictEqual(await restartedContext.isFollowing(source2), false)
      assert.strictEqual(await restartedContext.isFollowing(source3), false)
      assert.strictEqual(await restartedContext.isPendingFollowing(source1), false)
      assert.strictEqual(await restartedContext.isPendingFollowing(source2), false)
      assert.strictEqual(await restartedContext.isPendingFollowing(source3), false)
    } finally {
      try {
        await restartedApp?.close()
        await initialApp?.close()
      } finally {
        if (databaseDirectory) {
          await rm(databaseDirectory, { recursive: true, force: true })
        }
      }
    }
  })

  it('accepts an external Follow and registers the remote follower', async (t) => {
    const { app, context } = await makeTestApp(t, [])
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
  })
})
