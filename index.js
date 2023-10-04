import superagent from 'superagent';
import fs from 'node:fs';
import path from 'node:path';
import {WebsocketShard} from 'tiny-discord';

const {
    'Tautulli Host': apiHost,
    'Tautulli Key': apiKey,
    'Plex Username': plexUsername,
    'Discord Token': token
} = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf-8')
);

let previousSong = {};

const clientId = '1056711409817362452';
const websocket = new WebsocketShard({
    token,
    intents: 0,
})

const print = (...args) => console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const getPlexActivies = () => new Promise(resolve => {
    superagent('GET', `${apiHost}/api/v2`)
        .set('content-type', 'application/json')
        .query({
            apikey: apiKey,
            cmd: 'get_activity'
        })
        .then(resp => {
            return resolve(
                resp.body?.response?.data);
        })
        .catch(error => {
            print('Failed to fetch activities from Tautulli',
                error.response ? error.response.text : error);

            return resolve();
        })
});
const getImageURL = (url) => `${apiHost}/pms_image_proxy?img=${encodeURIComponent(url)}`;

const fetchDiscordThumbnail = url => new Promise(resolve => {
    superagent('POST', `https://discord.com/api/v9/applications/${clientId}/external-assets`)
        .set('user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/117.0')
        .set('content-type', 'application/json')
        .set('authorization', token)
        .send({
            urls: [url]
        })
        .then(resp => {
            return resolve(resp.body[0].external_asset_path);
        })
        .catch(error => {
            print('Failed to fetch presence thumbnail from Discord',
                error.response ? error.response.text : error);

            return resolve();
        })
})
const setDiscordStatus = async (status) => {
    try {
        // https://github.com/Vendicated/Vencord/blob/main/src/plugins/lastfm/index.tsx
        const body = {
            op: 3,
            d: {
                status: 'idle',
                since: 0,
                activities: [{
                    application_id: clientId,

                    ...status,

                    type: 2,
                    flags: 1
                }],
                afk: false
            }
        }

        await websocket.send(body);
    } catch (error) {
        print('Failed to set Discord status:', error);
    }
};
const clearDiscordStatus = async () => {
    try {
        await websocket.send({
            op: 3,
            d: {
                status: 'idle',
                since: 0,
                activities: [],
                afk: false
            }
        })
    } catch (error) {
        print('Failed to clear Discord status:', error);
    }
}

const fetchActivitiesAndUpdate = async () => {
    const activies = await getPlexActivies();
    if (!activies || !activies.sessions) return;

    const session = activies.sessions.find(session => session.user === plexUsername);
    if (!session) return;

    const {
        state, // playing, paused
        title, // name of song
        parent_title, // name of album
        grandparent_title, // name of artist
        year, // year of album

        media_type, // track
        thumb,

        duration, // length of song in ms
        progress_percent, // progress of song in percent
    } = session;

    if (media_type !== 'track') return;

    if (
        previousSong.title === title &&
        previousSong.parent_title === parent_title &&
        previousSong.state === state &&
        Math.abs(previousSong.progress_percent - progress_percent) < 25
    ) {
        previousSong.progress_percent = progress_percent;
        return;
    }

    if (progress_percent === 100)
        return await clearDiscordStatus();

    previousSong = session;

    const listeningDuration = duration * (progress_percent / 100);
    const rawThumbnailURL = getImageURL(thumb);
    const formattedThumbnail = await fetchDiscordThumbnail(rawThumbnailURL);

    print(`${state} ${title} on ${parent_title} (${year}) by ${grandparent_title}`);

    await setDiscordStatus({
        name: 'Plexamp',
        details: `${title.trim()}`,
        state: `by ${grandparent_title.trim()}`,

        timestamps: {
            end:
                state === 'playing' ?
                    Math.floor((Date.now() + (duration - listeningDuration))) :
                    null,
        },

        assets: {
            large_image: `mp:${formattedThumbnail}`,
            large_text: `${parent_title.trim()} (${year})`,
            small_image:
                state === 'playing' ? null : '1155215268277129297',
            small_text:
                state === 'playing' ? 'Playing' : 'Paused',
        },
    })
};

websocket.on('ready', async ready => {
    const {user} = ready.data;
    print(`Connected to Discord RPC successfully as @${user.username}`);

    for (; ;) {
        await fetchActivitiesAndUpdate();
        await sleep(5000);
    }
});

websocket.on('close', error => {
    print('Disconnected from Discord RPC:', error);
    process.exit(1);
});

websocket
    .connect()
    .catch(console.error);
