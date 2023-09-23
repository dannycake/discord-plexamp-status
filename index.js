import superagent from 'superagent';
import RPC from 'discord-rpc';
import fs from 'node:fs';
import path from 'node:path';

const {
    'Tautulli Host': apiHost,
    'Tautulli Key': apiKey,
    'Plex Username': plexUsername,
} = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf-8')
);

let previousSong = {};

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

const setDiscordStatus = async (status) => {
    try {
        await rpc.setActivity(status);
    } catch (error) {
        print('Failed to set Discord status:', error);
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
        Math.abs(previousSong.progress_percent - progress_percent) < 10
    ) {
        previousSong.progress_percent = progress_percent;
        return;
    }

    previousSong = session;

    const listeningDuration = duration * (progress_percent / 100);
    const formattedThumbnail = getImageURL(thumb);

    print(`${state} ${title} on ${parent_title} (${year}) by ${grandparent_title}`);

    await setDiscordStatus({
        details: `${title.trim()} (${year})`,
        state: `by ${grandparent_title.trim()}`,
        endTimestamp:
            state === 'playing' ?
                Math.floor((Date.now() + (duration - listeningDuration))) :
                null,
        largeImageKey: formattedThumbnail,
        largeImageText: `${parent_title.trim()} (${year})`,
        smallImageKey:
            state === 'playing' ? null : 'pause',
        smallImageText:
            state === 'playing' ? 'Playing' : 'Paused',
    })
};

const clientId = '1056711409817362452';
const rpc = new RPC.Client({ transport: 'ipc' });

rpc.on('ready', async () => {
    print(`Connected to Discord RPC successfully as ${rpc.user.username}#${rpc.user.discriminator}`);

    for (;;) {
        await fetchActivitiesAndUpdate();
        await sleep(1000);
    }
});

rpc.on('disconnected', () => {
    print('Disconnected from Discord RPC');
    process.exit(1);
});

rpc.login({
    clientId,
}).catch(console.error);
