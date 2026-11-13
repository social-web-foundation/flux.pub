import { Bot } from '@evanp/activitypub-bot'

export class FluxBot extends Bot {
  constructor (username, options = {}) {
    super(username, options)
  }
}
