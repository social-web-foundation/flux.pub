import { Bot } from '@evanp/activitypub-bot'
import as2 from 'activitystrea.ms'

const AS2 = 'https://www.w3.org/ns/activitystreams#'
const CREATE = `${AS2}Create`

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

    const types = (Array.isArray(activity.type))
      ? activity.type
      : [activity.type]

    if (!types.includes(CREATE)) {
      return
    }

    if (!await this._context.isFollowing(activity.actor.first)) {
      return
    }

    const obj = activity.object.first

    this._context.logger.info(
      { object: obj.id },
      'Announcing public object from followed actor'
    )

    await this._context.announceObject(obj)
  }
}
