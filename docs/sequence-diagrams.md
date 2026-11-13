# Sequence Diagrams

This document describes the runtime behavior of flux.pub through sequence diagrams.

## Initialization Sequence

When a FluxBot is created with a list of source actors:

```mermaid
sequenceDiagram
    participant App as Application
    participant FluxBot as FluxBot
    participant BotContext as BotContext
    participant ActorStorage as ActorStorage
    participant RemoteActor as Remote Actor

    App->>FluxBot: new FluxBot(username, {sources})
    FluxBot->>FluxBot: initialize(context)

    note over FluxBot, BotContext: Sync following collection with sources

    loop For each source in sources
        FluxBot->>BotContext: isFollower(source)
        alt Not following
            FluxBot->>BotContext: isPendingFollower(source)
            alt Not following and not pending
                FluxBot->>BotContext: followActor(source)
                BotContext->>RemoteActor: Follow activity
                BotContext->>ActorStorage: addToCollection('pendingFollowing')
            else Already pending
                FluxBot->>FluxBot: Skip (already pending)
            end
        else Already following
            FluxBot->>FluxBot: Skip (already following)
        end
    end

    FluxBot->>BotContext: following()

    loop For each actor in following()
        alt actor not in sources
            FluxBot->>BotContext: unfollowActor(actor)
            BotContext->>RemoteActor: Undo(Follow) activity
            BotContext->>ActorStorage: removeFromCollection('following')
        end
    end


    FluxBot->>BotContext: pendingFollowing()

    loop For each activity in pendingFollowing()
        alt activity.object not in sources
            FluxBot->>BotContext: unfollowActor(activity.object)
            BotContext->>RemoteActor: Undo(Follow) activity
            BotContext->>ActorStorage: removeFromCollection('pendingFollowing')
        end
    end

    FluxBot-->>App: FluxBot instance ready
```

## Follow Activity Handling

When someone follows the FluxBot:

```mermaid
sequenceDiagram
    participant RemoteUser as Remote User
    participant App as App
    participant ActivityHandler as ActivityHandler
    participant ActorStorage as ActorStorage

    RemoteUser->>App: Follow activity
    App->>ActivityHandler: handleActivity(Follow activity)
    ActivityHandler->>ActivityHandler: handleFollow(Follow activity)
    ActivityHandler->>ActorStorage: addToCollection('followers')
    ActivityHandler->>RemoteUser: Accept Follow activity
```

## Public Activity Aggregation

When a public Create activity arrives from a followed actor:

```mermaid
sequenceDiagram
    participant RemoteServer as Remote Server
    participant App as App
    participant FluxBot as FluxBot
    participant BotContext as BotContext
    participant Follower as Follower

    RemoteServer->>App: Public Create activity
    App->>FluxBot: onPublic(activity)

    FluxBot->>BotContext: isFollowing(activity.actor)

    alt Activity is Create from followed actor
        FluxBot->>BotContext: announceObject(activity.object)
        loop for each follower
            BotContext->>Follower: Announce activity
        end
    else Activity not from followed actor
        FluxBot->>FluxBot: Skip (not announcing)
    else Activity is not Create
        FluxBot->>FluxBot: Default processing
    end
```
