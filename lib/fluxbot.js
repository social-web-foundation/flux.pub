import { Bot } from '@evanp/activitypub-bot'
import as2 from 'activitystrea.ms'

const AS2 = 'https://www.w3.org/ns/activitystreams#'
const PUBLIC = [
  `${AS2}Public`,
  'as:Public',
  'Public'
]
const ANNOUNCE = `${AS2}Announce`

export class FluxBot extends Bot {
  #sources
  constructor (username, options = {}) {
    super(username, options)
    this.#sources = ('sources' in options)
      ? Array.isArray(options.sources)
        ? options.sources
        : [options.sources]
      : []
  }

  async initialize (context) {
    await super.initialize(context)
    this._context.logger.info(
      'Initialising fluxbot'
    )
    for (const source of this.#sources) {
      const sourceObj = await as2.import({id: source})
      if (!(await this._context.isFollowing(sourceObj)) &&
          !(await this._context.isPendingFollowing(sourceObj))) {
        this._context.logger.info(
          { source },
          'Following source'
        )
        await this._context.followActor(sourceObj)
      }
    }
    for await (const following of this._context.following()) {
      if (!this.#sources.includes(following.id)) {
        this._context.logger.info(
          { following: following.id },
          'Unfollowing followed actor that is not a source'
        )
        await this._context.unfollowActor(following)
      }
    }
    for await (const pending of this._context.pendingFollowing()) {
      const activity = await this._context.getObject(pending.id)
      const actor = activity?.object?.first
      if (!actor) {
        continue
      }
      if (!this.#sources.includes(actor.id)) {
        this._context.logger.info(
          { pending: actor.id },
          'Unfollowing pending followed actor that is not a source'
        )
        await this._context.unfollowActor(actor)
      }
    }
  }

  async onPublic(activity) {

    this._context.logger.debug(
      { object: activity.id },
      'FluxBot.onPublic(activity)'
    )

    if (this.#isQuietPublic(activity)) {
      this._context.logger.debug(
        { object: activity.id },
        'Skipping quiet public activity'
      )
      return
    }

    if (!await this._context.isFollowing(activity.actor.first)) {
      this._context.logger.debug(
        { object: activity.id, actor: activity.actor.first.id },
        'Skipping activity since actor is not followed'
      )
      return
    }

    const prev = await this._context.getLastActivity(ANNOUNCE, activity)

    if (prev) {
      this._context.logger.debug(
        { object: activity.id, prev: prev },
        'Skipping activity since it was previously announced'
      )
      return
    }

    const loopId = await this.#detectLoop(activity)
    if (loopId) {
      this._context.logger.debug(
        { object: activity.id, loop: loopId },
        'Skipping announce loop'
      )
      return
    }

    this._context.logger.info(
      { object: activity.id },
      'Announcing public activity from followed actor'
    )

    await this._context.announceObject(activity)
  }

  #isQuietPublic (object) {
    return this.#isPublicInProp(object, 'cc') &&
      !this.#isPublicInProp(object, 'to') &&
      !this.#isPublicInProp(object, 'audience')
  }

  #isPublicInProp (object, prop) {
    const vals = object.get(prop)
    if (vals) {
      for (const val of vals) {
        if (PUBLIC.includes(val.id)) {
          return true
        }
      }
    }
    return false
  }

  async #detectLoop (activity) {

    let obj = activity

    const seen = new Set()
    seen.add(obj.id)

    while (obj && this.#isAnnounce(obj)) {
      if (this.#isOwn(obj)) {
        return obj.id
      } else {
        const objectId = obj.object?.first?.id
        if (seen.has(objectId)) {
          break
        }
        seen.add(objectId)
        obj = await this._context.getObject(objectId)
      }
    }

    return null
  }

  #isAnnounce(obj) {
    const types = Array.isArray(obj.type)
      ? obj.type
      : [obj.type]
    return types.includes(ANNOUNCE)
  }

  #isOwn(obj) {
    return this._context.isLocal(obj.id) &&
      obj.id.match(`/user/${this._context.botId}/`)
  }
}
