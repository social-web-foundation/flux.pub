import { FluxBot } from '../../lib/fluxbot.js'

// Test-specific bot configuration with hard-coded sources
// These are mock remote actors we'll set up with activitypub-nock
const sources = [
  'https://remote1.test/user/actor1',
  'https://remote2.test/user/actor2'
]

const fluxBot = new FluxBot('flux', { sources })

export default {
  flux: fluxBot
}
