# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Upgrade `@evanp/activitypub-bot` to deal with some signature errors.

## [0.1.0] - 2026-11-15

### Added

- `FluxBot`, built on `@evanp/activitypub-bot`, with configurable source actors and delivery of announcements to followers.
- Source reconciliation on initialization and restart: retain configured accepted and pending follows, follow new sources, and undo follows for removed sources.
- Support for WebFinger addresses, including the optional `acct:` scheme, and HTTPS ActivityPub actor IDs in the same source list.
- Integration tests covering initialization, restart with the same database, external follows, activity delivery, source formats, quiet public activities, and announcement loops, using RFC 9421 message signatures.
- README documentation for the `FluxBot` interface, milestone user stories, and Mermaid class and sequence diagrams.
- Docker image based on `activitypub-bot`, with `FluxBot` available at `/opt/flux.pub/fluxbot.js` and a mountable bots configuration at `/etc/bots.js`.
- GitHub Actions workflow that tests `main` and version-tag pushes, builds multi-platform images in GHCR tagged by commit SHA, smoke tests `/readyz`, and promotes the tested image to semantic version tags.

### Changed

- Announce incoming public activities by their activity IDs, including `Create`, `Update`, `Delete`, `Announce`, and `Like` activities.
- Use temporary SQLite files by default in integration tests.

### Fixed

- Skip quiet public activities with `Public` in `cc` and absent from both `to` and `audience`.
- Skip activities the bot has already announced.
- Prevent announcement loops whose `Announce` chain contains one of the bot's own announcements.

[Unreleased]: https://github.com/social-web-foundation/flux.pub/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/social-web-foundation/flux.pub/releases/tag/v0.1.0
