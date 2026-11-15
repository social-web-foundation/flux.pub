import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import as2 from 'activitystrea.ms'
import { nockSetup, nockFormat, postInbox, getBody, resetInbox, resetBodies } from '@evanp/activitypub-nock'
import { getTestDatabaseUrl, cleanupTestDatabase, removeTestDatabase } from './utils/db.js'
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
    try {
      await cleanupTestDatabase()
    } finally {
      await removeTestDatabase()
    }
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

  it('accepts WebFinger addresses and HTTPS actor IDs in the same source list', async (t) => {
    const { app, context } = await makeTestApp(t, [
      `${actor1}@${remote1}`,
      sources[1]
    ])
    const actors = await Promise.all(
      sources.slice(0, 2).map(id => as2.import({ id }))
    )

    for (const [actor, inbox, source] of [
      [actor1, actor1Inbox, actors[0]],
      [actor2, actor2Inbox, actors[1]]
    ]) {
      assert.strictEqual(postInbox[actor], 1, `Expected a Follow to be sent to ${actor}`)
      const follow = JSON.parse(getBody(inbox))
      assert.strictEqual(follow.type, 'Follow')
      assert.strictEqual(follow.actor, context.botActorId)
      assert.strictEqual(follow.object, source.id)
      assert.strictEqual(await context.isFollowing(source), false)
      assert.strictEqual(await context.isPendingFollowing(source), true)
    }

    await acceptSourceFollows(app)

    for (const source of actors) {
      assert.strictEqual(await context.isFollowing(source), true)
      assert.strictEqual(await context.isPendingFollowing(source), false)
    }
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

  it('ignores a public Create with no object without throwing', async (t) => {
    const { app, context } = await makeTestApp(t, sources.slice(0, 2))
    await acceptSourceFollows(app)
    const handler = t.mock.method(app.locals.bots.flux, 'onPublic')
    const announcements = t.mock.method(context, 'announceObject')

    const response = await sendActivity(app, actor1, remote1, {
      id: nockFormat({ username: actor1, domain: remote1, type: 'Create', num: 1 }),
      type: 'Create',
      to: 'https://www.w3.org/ns/activitystreams#Public'
    })
    assert.strictEqual(response.status, 202, `Create without an object: ${response.text}`)
    await app.onIdle()

    assert.strictEqual(handler.mock.callCount(), 1)
    await assert.doesNotReject(handler.mock.calls[0].result)
    assert.strictEqual(announcements.mock.callCount(), 0)
  })

  it('announces the Note rather than its Create activity to followers', async (t) => {
    const { app, context } = await makeTestApp(t, sources.slice(0, 2))
    await acceptSourceFollows(app)

    const follow = await sendActivity(app, actor3, remote3, {
      type: 'Follow',
      object: context.botActorId,
      to: context.botActorId
    })
    assert.strictEqual(follow.status, 202, `Follow from actor3: ${follow.text}`)
    await app.onIdle()

    const publicAudience = 'https://www.w3.org/ns/activitystreams#Public'
    const createId = nockFormat({ username: actor1, domain: remote1, type: 'Create', num: 1 })
    const noteId = nockFormat({ username: actor1, domain: remote1, type: 'Note', num: 1 })
    const inboxCount = postInbox[actor3]
    const response = await sendActivity(app, actor1, remote1, {
      id: createId,
      type: 'Create',
      to: publicAudience,
      object: {
        id: noteId,
        type: 'Note',
        attributedTo: sources[0],
        content: 'A public note from a source',
        to: publicAudience
      }
    })
    assert.strictEqual(response.status, 202, `Create from actor1: ${response.text}`)
    await app.onIdle()

    assert.strictEqual(postInbox[actor3], inboxCount + 1)
    const announcement = JSON.parse(getBody(actor3Inbox))
    assert.strictEqual(announcement.type, 'Announce')
    assert.strictEqual(announcement.actor, context.botActorId)
    assert.strictEqual(announcement.object, noteId, 'The Announce must target the Note rather than the Create')
  })

  it('announces public Create, Delete, Update, Announce, and Like activities from sources without announcing followers-only activities', async (t) => {
    const { app, context } = await makeTestApp(t, sources.slice(0, 2))
    await acceptSourceFollows(app)
    const [source1, source2, follower] = await Promise.all(
      sources.map(id => as2.import({ id }))
    )
    assert.strictEqual(await context.isFollowing(source1), true)
    assert.strictEqual(await context.isFollowing(source2), true)

    const follow = await sendActivity(app, actor3, remote3, {
      type: 'Follow',
      object: context.botActorId,
      to: context.botActorId
    })
    assert.strictEqual(follow.status, 202, `Follow from actor3: ${follow.text}`)
    await app.onIdle()
    assert.strictEqual(await context.isFollower(follower), true)

    const publicAudience = 'https://www.w3.org/ns/activitystreams#Public'
    const firstSourceFollowers = nockFormat({ username: actor1, domain: remote1, collection: 'followers' })
    const secondSourceFollowers = nockFormat({ username: actor2, domain: remote2, collection: 'followers' })
    const deliveries = t.mock.method(app.locals.client, 'post')
    const receivedAnnouncements = []
    const expectedAnnouncements = []

    for (const [username, domain, num, to, cc] of [
      [actor1, remote1, 1, publicAudience, [firstSourceFollowers]],
      [actor2, remote2, 2, publicAudience, [secondSourceFollowers]],
      [actor1, remote1, 3, firstSourceFollowers, []]
    ]) {
      const note = {
        id: nockFormat({ username, domain, type: 'Note', num }),
        type: 'Note',
        attributedTo: nockFormat({ username, domain }),
        content: `Note ${num} from ${username}`,
        to,
        cc
      }

      for (const activity of [
        { type: 'Create', object: note },
        { type: 'Update', object: { ...note, content: `Updated note ${num} from ${username}` } },
        { type: 'Announce', object: note.id },
        { type: 'Like', object: note.id },
        { type: 'Delete', object: { id: note.id, type: 'Tombstone', formerType: 'Note' } }
      ]) {
        const activityId = nockFormat({ username, domain, type: activity.type, num })
        const previousCalls = deliveries.mock.callCount()
        const inboxCount = postInbox[actor3]
        const response = await sendActivity(app, username, domain, {
          ...activity,
          id: activityId,
          to,
          cc
        })
        assert.strictEqual(response.status, 202, `${activity.type} from ${username}: ${response.text}`)
        await app.onIdle()

        const replies = await Promise.all(deliveries.mock.calls
          .slice(previousCalls)
          .filter(call => call.arguments[0] === actor3Inbox)
          .map(async call => {
            await call.result
            return call.arguments[1].export()
          }))
        receivedAnnouncements.push({
          activity: activityId,
          announcements: replies
            .filter(reply => reply.type === 'Announce')
            .map(reply => ({ actor: reply.actor, object: reply.object }))
        })
        expectedAnnouncements.push({
          activity: activityId,
          announcements: to === publicAudience
            ? [{ actor: context.botActorId, object: activity.type === 'Create' ? note.id : activityId }]
            : []
        })

        if (to !== publicAudience) {
          assert.strictEqual(postInbox[actor3], inboxCount, `Followers-only ${activity.type} should cause no delivery to actor3`)
        }
      }
    }

    assert.deepStrictEqual(receivedAnnouncements, expectedAnnouncements,
      'Public Creates should announce their Notes, other public activities should announce their own IDs, and followers-only activities should not be announced')
  })

  it('does not announce a quiet public Create Note activity', async (t) => {
    const { app, context } = await makeTestApp(t, sources.slice(0, 2))
    await acceptSourceFollows(app)
    const source = await as2.import({ id: sources[0] })
    const follower = await as2.import({ id: sources[2] })
    assert.strictEqual(await context.isFollowing(source), true)

    const follow = await sendActivity(app, actor3, remote3, {
      type: 'Follow',
      object: context.botActorId,
      to: context.botActorId
    })
    assert.strictEqual(follow.status, 202, `Follow from actor3: ${follow.text}`)
    await app.onIdle()
    assert.strictEqual(await context.isFollower(follower), true)

    const activityId = nockFormat({ username: actor1, domain: remote1, type: 'Create', num: 1 })
    const to = [nockFormat({ username: actor1, domain: remote1, collection: 'followers' })]
    const cc = ['https://www.w3.org/ns/activitystreams#Public']
    const inboxCount = postInbox[actor3]
    const response = await sendActivity(app, actor1, remote1, {
      id: activityId,
      type: 'Create',
      to,
      cc,
      object: {
        id: nockFormat({ username: actor1, domain: remote1, type: 'Note', num: 1 }),
        type: 'Note',
        attributedTo: source.id,
        content: 'Quiet public note',
        to,
        cc
      }
    })
    assert.strictEqual(response.status, 202, `Quiet public Create: ${response.text}`)
    await app.onIdle()

    const activity = await as2.import({ id: activityId })
    assert.strictEqual(await context.getLastActivity('Announce', activity), null,
      'Quiet public Create should not generate an Announce')
    assert.strictEqual(postInbox[actor3], inboxCount,
      'Quiet public Create should cause no delivery to actor3')
  })

  it('does not announce a source announcement wrapping its own Announce', async (t) => {
    const { app, context } = await makeTestApp(t, [sources[0]])
    const peer = await as2.import({ id: sources[0] })
    const initialFollow = JSON.parse(getBody(actor1Inbox))
    const accept = await sendActivity(app, actor1, remote1, {
      type: 'Accept',
      object: initialFollow.id
    })
    assert.strictEqual(accept.status, 202, `Accept from peer: ${accept.text}`)

    const follow = await sendActivity(app, actor1, remote1, {
      type: 'Follow',
      object: context.botActorId,
      to: context.botActorId
    })
    assert.strictEqual(follow.status, 202, `Follow from peer: ${follow.text}`)
    await app.onIdle()
    assert.strictEqual(await context.isFollowing(peer), true)
    assert.strictEqual(await context.isFollower(peer), true)

    const publicAudience = 'https://www.w3.org/ns/activitystreams#Public'
    const firstAnnounceId = nockFormat({ username: actor1, domain: remote1, type: 'Announce', num: 1 })
    const firstAnnounce = await sendActivity(app, actor1, remote1, {
      id: firstAnnounceId,
      type: 'Announce',
      to: publicAudience,
      object: {
        id: nockFormat({ username: actor1, domain: remote1, type: 'Note', num: 1 }),
        type: 'Note',
        attributedTo: peer.id,
        content: 'Original note',
        to: publicAudience
      }
    })
    assert.strictEqual(firstAnnounce.status, 202, `First Announce from peer: ${firstAnnounce.text}`)
    await app.onIdle()

    const ownAnnounce = JSON.parse(getBody(actor1Inbox))
    assert.strictEqual(ownAnnounce.type, 'Announce')
    assert.strictEqual(ownAnnounce.actor, context.botActorId)
    assert.strictEqual(ownAnnounce.object, firstAnnounceId)
    assert.ok(ownAnnounce.id)

    const deliveries = t.mock.method(app.locals.client, 'post')
    const returningAnnounceId = nockFormat({ username: actor1, domain: remote1, type: 'Announce', num: 2 })
    const returningAnnounce = await sendActivity(app, actor1, remote1, {
      id: returningAnnounceId,
      type: 'Announce',
      to: publicAudience,
      object: ownAnnounce
    })
    assert.strictEqual(returningAnnounce.status, 202, `Returning Announce from peer: ${returningAnnounce.text}`)
    await app.onIdle()

    const replies = await Promise.all(deliveries.mock.calls
      .filter(call => call.arguments[0] === actor1Inbox)
      .map(async call => {
        await call.result
        return call.arguments[1].export()
      }))
    assert.deepStrictEqual(replies.filter(activity => activity.type === 'Announce'), [],
      'An announcement wrapping the bot\'s own Announce must not be announced back to the peer')
    const activity = await as2.import({ id: returningAnnounceId })
    assert.strictEqual(await context.getLastActivity('Announce', activity), null,
      'The returning announcement must not generate another Announce')
  })
})
