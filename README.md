# flux.pub

A server to consolidate all your ActivityPub accounts.

## Table of Contents

- [Description](#description)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [FluxBot interface](#fluxbot-interface)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)

## Description

flux.pub is an ActivityPub aggregation and remix service that helps users manage multiple ActivityPub accounts from a single interface. It aggregates content from various federated social networks and provides a unified experience.

## Features

- ActivityPub protocol support
- Multi-account aggregation
- Channel-based content remixing
- Federated social network integration

## Installation

```bash
# Clone the repository
git clone https://github.com/social-web-foundation/flux.pub.git
cd flux.pub

# Install dependencies
npm install

# Run tests
npm test
```

## Usage

```bash
# Start the server
npm start
```

For detailed usage instructions, please refer to the documentation.

### Docker

Build the image with `docker build --tag flux.pub .`. It uses
`ghcr.io/evanp/activitypub-bot:0.56.2` and inherits the base image's
`activitypub-bot` startup command.

Mount a `bots.js` ES module at `/etc/bots.js`. Its default export must be the
framework's bot map, with each instance registered under its username. In this
module, import `FluxBot` from `/opt/flux.pub/fluxbot.js`.

For example, run the image with a mounted configuration and a persistent SQLite
database:

```sh
docker run --rm --publish 9000:9000 \
  --mount type=bind,src="$(pwd)/bots.js",dst=/etc/bots.js,readonly \
  --mount type=volume,src=flux-pub-data,dst=/data \
  --env ORIGIN=https://flux.example \
  --env DATABASE_URL=sqlite:/data/flux.sqlite \
  flux.pub
```

The default configuration path is set by `BOTS_CONFIG_FILE`; override that
environment variable to use a different path. The framework also accepts `PORT`,
`LOG_LEVEL`, and its other environment settings.

## FluxBot interface

`FluxBot` is a named export from [lib/fluxbot.js](lib/fluxbot.js). It extends
`Bot` from `@evanp/activitypub-bot` and announces public activities from configured
source actors to its followers.

### Constructor

`new FluxBot(username, options = {})`

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `username` | `string` | Required | The bot's local username. Register the instance under the same username in the activitypub-bot app's `bots` option. |
| `options` | `object` | `{}` | Source configuration and options passed to the base `Bot` constructor. |

The constructor accepts these options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `sources` | `string` or `string[]` | `[]` | One source actor or an array of source actors, using any of the formats below. |
| `fullname` | `string` | `'Bot'` | The bot's display name. |
| `description` | `string` | `'Default bot'` | The bot's profile description. |
| `icon` | `URL` or `null` | `null` | The bot's avatar image URL. |
| `image` | `URL` or `null` | `null` | The bot's header image URL. |
| `checkSignature` | `boolean` | `true` | Whether the framework requires valid HTTP signatures on incoming activities. |

All options except `sources` are handled by the base `Bot` class.

### Source formats

Each source can use one of these formats. An array can mix formats.

| Format | Example |
| --- | --- |
| WebFinger address | `user1@example.social` |
| WebFinger address with an `acct:` scheme | `acct:user1@example.social` |
| HTTPS ActivityPub actor ID | `https://example.social/users/user1` |

Use an actor ID for the HTTPS form. WebFinger addresses are resolved to actor IDs
during initialization.

### Initialization and source changes

The constructor stores configuration. The framework calls the asynchronous
`initialize(context)` method with a `BotContext` for the same username to establish
the bot's follows.

On each initialization, FluxBot follows new sources, retains existing accepted or
pending follows for configured sources, and sends `Undo` activities for accepted
or pending follows whose actors are no longer configured. To change sources,
create a new instance with the updated configuration and restart the app using
the same database. Omitting `sources`, or supplying an empty array, removes all
previous source follows during initialization.

A source must accept the bot's Follow before its activities are announced.

### Announcements

The framework calls `onPublic(activity)` with an Activity Streams activity.
FluxBot announces public activities from followed sources, including `Create`,
`Update`, `Delete`, `Announce`, and `Like`. The outgoing `Announce` references the
incoming activity's ID; for a `Create` activity, it references the `Create` rather
than the contained object.

FluxBot skips followers-only activities and quiet public activities. An activity
is quiet public when `Public` appears in `cc` but in neither `to` nor `audience`.
It also skips activities it has already announced and `Announce` chains that
contain one of its own announcements.

## Configuration

Configuration options can be set via environment variables or configuration files. See the configuration documentation for available options.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## Credits

- Author: [Evan Prodromou](https://evanp.me/)
- Organization: [Social Web Foundation](https://socialwebfoundation.org/)
