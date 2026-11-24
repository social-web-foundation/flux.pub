FROM ghcr.io/evanp/activitypub-bot:0.58.1

COPY lib/fluxbot.js /usr/local/lib/node_modules/@evanp/activitypub-bot/lib/fluxbot.js

RUN mkdir -p /opt/flux.pub && \
    ln -s /usr/local/lib/node_modules/@evanp/activitypub-bot/lib/fluxbot.js /opt/flux.pub/fluxbot.js

ENV BOTS_CONFIG_FILE=/etc/bots.js
