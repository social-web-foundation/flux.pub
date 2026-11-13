import { createHash } from 'node:crypto'
import request from 'supertest'
import { nockFormat, nockMessageSignature } from '@evanp/activitypub-nock'

export async function sendActivity (app, username, domain, activity) {
  const inboxUrl = new URL('/user/flux/inbox', app.locals.origin)
  const body = JSON.stringify({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: nockFormat({ username, domain, type: activity.type, num: Date.now() }),
    actor: nockFormat({ username, domain }),
    ...activity
  })
  const digestValue = createHash('sha256').update(body).digest('base64')
  const contentDigest = `sha-256=:${digestValue}:`
  const signatureHeaders = await nockMessageSignature({
    method: 'POST',
    url: inboxUrl.href,
    username,
    domain,
    contentDigest
  })

  return request(app)
    .post(inboxUrl.pathname)
    .set('Host', inboxUrl.host)
    .set('Content-Type', 'application/activity+json')
    .set('Content-Digest', contentDigest)
    .set(signatureHeaders)
    .send(body)
}
