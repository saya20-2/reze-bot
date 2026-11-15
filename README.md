# reze-bot

A Discord bot built with Node.js and discord.js. It combines music
playback, a ModMail ticket system and image-based spam moderation.

## Features

-   **Music** through a Lavalink server: play songs and playlists from
    YouTube, search with a pick list, YouTube-mix "radio", a per-server
    queue, skip, jump, shuffle and clear. Audio is downloaded with
    yt-dlp first and falls back to Lavalink's YouTube plugin.
-   **Lyrics** shown under the now playing message, with optional
    romanized (romaji) lyrics for Japanese songs.
-   **ModMail**: users DM the bot to open a ticket channel for staff,
    and staff can start a ticket with a user.
-   **AutoMod**: detects scam-style spam in dark screenshots with OCR
    (Tesseract), mass mentions from new accounts and identical links
    cross-posted across channels, and bans repeat offenders.
-   **Status**: shows the song that is currently playing, or an idle
    message when nothing is playing.

## Tech stack

  ------------------ ------------------------------------------------
  Runtime            Node.js (CommonJS)
  Discord            discord.js `^14.25.1`
  Music              Shoukaku `^4.3.0` client for a Lavalink server
  Audio download     yt-dlp (external binary)
  Audio playback     Lavalink v4 / Lavaplayer
  Image processing   sharp `^0.35.5`
  OCR                The native `tesseract` command-line program
  Lyrics parsing     cheerio `^1.2.0`
  Config             dotenv `^17.3.1`

## Requirements

-   **Node.js** and npm. Node.js v26 is strongly recommended. Node.js
    v26 is the version used to run the bot.
-   **A Lavalink v4 server** with the YouTube source plugin and local
    file playback enabled (see [Lavalink](#4-set-up-lavalink)).
-   **Java 17 or newer** for Lavalink.
-   **yt-dlp** with a JavaScript runtime (the bot passes Node.js by
    default).
-   **A PO token provider for yt-dlp**: this deployment uses the bgutil
    provider in HTTP mode.
-   **Tesseract OCR** with the English language data (`eng`), for
    AutoMod.
-   A Discord application with a bot user.

FFmpeg is not required by the current music implementation. yt-dlp
downloads the selected audio stream in its original format, and Lavalink
handles playback. FFmpeg may become necessary if yt-dlp is later
configured to extract, convert, or merge media.

## Installation

### 1. Create the Discord application

1.  Create an application at the [Discord Developer
    Portal](https://discord.com/developers/applications) and add a bot
    user.
2.  Under **Bot**, enable these **privileged gateway intents**, because
    the bot requests them:
    -   Presence Intent
    -   Server Members Intent
    -   Message Content Intent
3.  Copy the bot token and the Application ID for your env file.
4.  Invite the bot to your server with the `bot` and
    `applications.commands` scopes. Based on what the code does, it
    needs these permissions: View Channels, Send Messages, Embed Links,
    Attach Files, Read Message History, Connect, Speak, Manage Channels
    (creates ticket channels) and Ban Members (AutoMod bans).

### 2. Get the code and install dependencies

``` bash
git clone -b prod https://github.com/saya20-2/reze-bot.git
cd reze-bot
npm install
```

### 3. Configure

The bot reads `.env.prod` when `NODE_ENV` is `prod` or `production`, and
`.env.poc` otherwise. Both live in the project root and are git-ignored.

``` bash
cp .env.example .env.prod
```

Fill in every value; `.env.example` explains what each one needs. See
[Configuration](#configuration) for the full list.

### 4. Set up Lavalink

Lavalink is a standalone Java application distributed as `Lavalink.jar`.
Install Java 17 or newer, download the Lavalink v4 JAR from the
[official releases](https://github.com/lavalink-devs/Lavalink/releases),
and place an `application.yml` beside it. Start it from that directory:

``` bash
java -jar Lavalink.jar
```

The bot connects to the Lavalink node at `LAVALINK_URL` using
`LAVALINK_PASSWORD`. The maintainer's configuration uses the YouTube
source plugin and enables local file playback because yt-dlp downloads
are passed to Lavalink as file paths.

The following is a redacted example of the relevant configuration.
Replace the password and OAuth refresh token with your own values; do
not commit credentials.

``` yaml
server:
  port: 2333
  address: 0.0.0.0

lavalink:
  plugins:
    - dependency: "dev.lavalink.youtube:youtube-plugin:b33460b38ad13b5cd07da75e46444397cf0ea2df"
      repository: "https://maven.lavalink.dev/snapshots"
      snapshot: true
  server:
    password: "CHANGE_ME"
    sources:
      youtube: false
      bandcamp: true
      soundcloud: true
      twitch: true
      http: true
      local: true
    bufferDurationMs: 400
    frameBufferDurationMs: 15000
    opusEncodingQuality: 10
    resamplingQuality: LOW
    trackStuckThresholdMs: 10000
    useSeekGhosting: true
    playerUpdateInterval: 5
    gc-warnings: true

plugins:
  youtube:
    remoteCipher:
      url: "https://cipher.kikkia.dev/"
      userAgent: "reze-bot"
    enabled: true
    allowSearch: true
    allowDirectVideoIds: true
    allowDirectPlaylistIds: true
    clients:
      - TV
      - TVHTML5EMBEDDED
      - ANDROID_VR
      - WEB
      - ANDROID_MUSIC
      - WEBEMBEDDED
    oauth:
      enabled: true
      refreshToken: "YOUR_YOUTUBE_OAUTH_REFRESH_TOKEN"
      skipInitialization: true

logging:
  file:
    max-history: 30
    max-size: 1GB
  level:
    root: INFO
    lavalink: INFO
```

Configuration notes:

-   The built-in YouTube source must remain disabled
    (`sources.youtube: false`) when using the YouTube source plugin.
-   The YouTube plugin is loaded from the Lavalink snapshot repository.
    The dependency above pins the snapshot commit used by the
    maintainer; plugin releases and configuration can change.
-   The remote cipher service is hosted at
    [cipher.kikkia.dev](https://cipher.kikkia.dev/). It is an external
    dependency and is not hosted by this project.
-   YouTube OAuth is enabled in the maintainer's configuration. Supply
    your own refresh token if you use this option; never reuse or
    publish the maintainer's token.
-   Local file playback must be enabled (`sources.local`), because audio
    downloaded by yt-dlp is handed to Lavalink as a file path.
-   **Shared filesystem:** the folder in `YTDLP_CACHE_DIR` must exist
    and be readable by the Lavalink process. Running Lavalink on the
    same host as the bot is the simplest arrangement; otherwise, share
    the cache directory between them.

For more information, see the [Lavalink configuration
documentation](https://lavalink.dev/configuration/) and the [YouTube
source plugin
documentation](https://github.com/lavalink-devs/youtube-source).

### 5. Install yt-dlp

Install yt-dlp and keep it current; YouTube changes often and older
builds can fail with HTTP 403 errors.

The maintainer's current installation uses pipx:

``` bash
pipx install "yt-dlp[default]"
```

For a pipx-managed installation, upgrade to the nightly channel with:

``` bash
pipx upgrade yt-dlp --pip-args="--pre"
```

Alternatively, if using the standalone release binary:

``` bash
yt-dlp --update-to nightly
```

The nightly channel is recommended when the stable release encounters
YouTube compatibility problems. See the [official yt-dlp installation
guide](https://github.com/yt-dlp/yt-dlp/wiki/Installation) and [nightly
releases](https://github.com/yt-dlp/yt-dlp-nightly-builds/releases).

Set `YTDLP_PATH` to the absolute path of the binary (find it with
`command -v yt-dlp`) if the bot runs with a different `PATH` than your
shell. Create the cache folder and make it writable by the bot:

``` bash
sudo mkdir -p /var/cache/reze-audio
```

yt-dlp also needs a **PO token provider**. The maintainer's deployment
uses the [bgutil PO-token
provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) in
HTTP mode:

-   The provider service is managed separately from the Node.js bot.
-   In the maintainer's deployment, its HTTP port is exposed on
    `127.0.0.1:4416` through Docker.
-   The bot and Lavalink run directly in a Proxmox LXC; the presence of
    Docker for this provider does not mean the bot itself is deployed in
    Docker.
-   The provider must be running and reachable by yt-dlp when YouTube
    downloads are requested.

The host's port listener indicates that the HTTP service is exposed on
the default bgutil port. The `python3 -m pip show` check is not a
reliable way to verify the provider plugin in this setup:
`/usr/bin/python3` may not be the Python environment used by yt-dlp, and
the HTTP provider runs separately.

To verify that yt-dlp is loading and using the provider, run a verbose
test with the same yt-dlp executable configured in `YTDLP_PATH`:

``` bash
yt-dlp -v --simulate "https://www.youtube.com/watch?v=VIDEO_ID"
```

Inspect the debug output for the bgutil PO-token provider. The
provider's installation and container configuration are
deployment-specific; consult the upstream bgutil documentation for setup
and updates.

### 6. Install Tesseract

The currently documented and tested installation target is
Debian/Ubuntu:

``` bash
sudo apt update
sudo apt install tesseract-ocr tesseract-ocr-eng
```

The English language data must be available to Tesseract. Other
distributions and platforms have not been documented here.

### 7. Register the slash commands

Commands are registered to the single server in `GUILD_ID`, not
globally. Run this again whenever commands or their options change. It
reads the env file from the current directory, so run it from the
project root:

``` bash
NODE_ENV=prod node src/deployCommands.js
```

### 8. Start the bot

``` bash
NODE_ENV=prod node src/index.js
```

The bot has been run directly with Node.js in a Proxmox LXC. There are
currently no npm start scripts.

## Deployment

The verified deployment is a Debian-based Proxmox LXC running the bot
directly through Node.js. Lavalink runs as a Java JAR.

Docker deployment of the bot and Lavalink has not been verified and
should be considered experimental. The bgutil HTTP provider in the
maintainer's setup is separately managed through Docker; this does not
constitute a Docker deployment of the bot.

No specific process manager or service unit is prescribed by this
project. Configure your own process supervision if you need automatic
startup and restart after host or container reboots.

## Configuration

All settings live in the env file. Required values are marked; the rest
have defaults.

  -----------------------------------------------------------------------------------------------
  Variable                    Required     Default                             What it is
  --------------------------- ------------ ----------------------------------- ------------------
  `DISCORD_TOKEN`             yes                                              Bot token

  `CLIENT_ID`                 yes                                              Application ID,
                                                                               used to register
                                                                               commands

  `GUILD_ID`                  yes                                              The server the bot
                                                                               serves

  `MODMAIL_CATEGORY_ID`       yes                                              Category for
                                                                               ticket channels

  `MOD_CHAT_CHANNEL_ID`       yes                                              Only channel where
                                                                               `/contact` works

  `INCUBATOR_ROLE_ID`,        yes                                              Staff roles pinged
  `SMALL_INC_ROLE_ID`                                                          on new tickets

  `AUTOMOD_LOG_CHANNEL_ID`    no           logging off                         Channel for
                                                                               AutoMod logs

  `GENERAL_CHAT_ID`           no           announcement off                    Channel where bans
                                                                               are announced

  `AUTOMOD_EXEMPT_ROLE_IDS`   no           none                                Comma-separated
                                                                               roles AutoMod
                                                                               ignores

  `AUTOMOD_DEBUG`             no           `false`                             Verbose OCR
                                                                               logging

  `AUTOMOD_OCR_CONCURRENCY`   no           `2`                                 Parallel OCR jobs
                                                                               (1 to 4)

  `TESSERACT_BINARY`          no           `tesseract`                         Tesseract command
                                                                               or path

  `LAVALINK_NAME`             no           `MainNode`                          Node label

  `LAVALINK_URL`              no           `localhost:2333`                    Lavalink
                                                                               `host:port`

  `LAVALINK_PASSWORD`         yes                                              Lavalink password

  `YTDLP_PATH`                no           `yt-dlp`                            yt-dlp binary

  `YTDLP_CACHE_DIR`           no           OS temp folder                      Audio cache,
                                                                               readable by
                                                                               Lavalink

  `YTDLP_MAX_FILESIZE`        no           `200M`                              Largest download

  `YTDLP_TIMEOUT_SECONDS`     no           `600`                               Download timeout

  `YTDLP_CACHE_HOURS`         no           `12`                                Cache lifetime

  `YTDLP_JS_RUNTIME`          no           the bot's Node.js                   JS runtime for
                                                                               yt-dlp

  `YTDLP_COOKIES`             no           none                                Cookies file (see
                                                                               Troubleshooting)

  `YTDLP_DISABLED`            no           `false`                             Skip yt-dlp, use
                                                                               the plugin only

  `RADIO_MAX_MINUTES`         no           `12`                                Longest song
                                                                               `/radio` queues

  `LYRICS_PROVIDERS`          no           `lyricfind,lrclib,vocaloidlyrics`   Lyrics source
                                                                               order

  `LYRICS_USER_AGENT`         no           `reze-discord-bot/1.0`              User-Agent for
                                                                               lyrics sites

  `LYRICFIND_API_KEY`         no           none                                Reserved for the
                                                                               LyricFind provider
                                                                               (not implemented)
  -----------------------------------------------------------------------------------------------

## Commands

  ---------------------------------------------------------------------
  Command                            What it does
  ---------------------------------- ----------------------------------
  `/play`                            Play a song, URL or playlist.
                                     Optional `lyrics` and `romanized`

  `/search`                          Search and pick one of 10 results.
                                     Optional `lyrics` and `romanized`

  `/radio`                           Queue related songs picked by
                                     YouTube. Options: `count`,
                                     `replace`, `lyrics`, `romanized`

  `/queue`                           Show the queue (`page`)

  `/select`                          Jump to a queue position

  `/skip`                            Skip the current song

  `/shuffle`                         Shuffle the queue

  `/clear`                           Clear the queue; `stop: true` also
                                     stops playback and leaves voice

  `/toggle-lyrics`                   Turn lyrics on or off; `romanized`
                                     switches the script and turns
                                     lyrics on

  `/contact`                         Staff: open a ModMail ticket with
                                     a user (only in the mod chat
                                     channel)

  `/reply`                           Staff: reply to a ticket, with an
                                     optional file

  `/close`                           Staff: close a ticket and delete
                                     its channel
  ---------------------------------------------------------------------

The bot disconnects from voice after 30 minutes of inactivity or of
being alone in the channel.

## Lyrics

Lyrics come from the first provider in `LYRICS_PROVIDERS` that finds the
song:

1.  **LRCLIB**, a free community lyrics database.
2.  **Vocaloid Lyrics Wiki**, which also provides romanized lyrics for
    many Japanese songs. When `romanized` is requested, the wiki is
    asked first.

LyricFind needs a paid licence and its provider is not implemented, so
it stays disabled. Check the sources from your own machine with:

``` bash
node scripts/probe-lyrics.js "Song title" "Artist" --romaji
```

## AutoMod debugging utilities

`data/automod-stats.json` and `src/managers/autoModStats.js` are legacy
debugging utilities retained from an earlier logging-only development
phase of AutoMod.

They are not required for normal bot operation and do not participate in
the current moderation or ban decision logic. The files are retained for
debugging/reference purposes.

## Development and tests

``` bash
node --test test/*.test.js
```

## Troubleshooting

-   **Songs end early or yt-dlp falls back to the plugin with
    `HTTP Error 403`:** update yt-dlp to nightly, set `YTDLP_PATH` to
    the binary you tested manually, and unset `YTDLP_COOKIES` if the
    cookies file is old.
-   **yt-dlp works in your shell but not in the bot:** the bot may have
    a different `PATH`. Use an absolute `YTDLP_PATH`.
-   **yt-dlp downloads but Lavalink cannot play the file:** enable
    `sources.local` in Lavalink and make `YTDLP_CACHE_DIR` readable by
    it.
-   **PO-token errors:** check that the bgutil HTTP provider is running
    and reachable on the configured local endpoint, and inspect yt-dlp's
    verbose output to confirm the provider is loaded.
-   **OCR timeouts or CPU spikes:** lower `AUTOMOD_OCR_CONCURRENCY`.

## Project layout

``` text
src/
  index.js              entry point, loads the env file and starts the bot
  Bot.js                client setup, event handlers, status
  deployCommands.js     registers slash commands to GUILD_ID
  commands/             one file per slash command
  managers/
    lavalinkManager.js  queues, playback, now playing, lyrics posting
    Ytdlp.js            yt-dlp downloads and radio lookups
    autoMod.js          OCR and spam detection
    modMail.js          ticket system
    radio.js            radio queue building
    lyrics/             lyric providers and track-title cleanup
scripts/probe-lyrics.js lyrics source check
test/                   unit and flow tests
data/automod-stats.json  legacy AutoMod debugging output
```

## License

MIT
