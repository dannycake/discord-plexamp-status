import express from 'express';
import superagent from 'superagent';

const {
    CLIENT_ID,
    CLIENT_SECRET
} = process.env;

const authentication = {
    clientBasic: Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
    token: null,
}

const getBearerToken = () => new Promise(resolve => {
    superagent
        .post('https://accounts.spotify.com/api/token')
        .set('Authorization', `Basic ${authentication.clientBasic}`)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .type('form')
        .send({
            grant_type: 'client_credentials'
        })
        .then(resp => {
            authentication.token = resp.body.access_token;

            console.log(
                'current token:',
                authentication.token.substring(0, 10).padEnd(authentication.token.length, '*'))

            resolve();
        })
        .catch(err => {
            console.log('Error getting bearer token from spotify:', err);
            resolve();
        });
});
const preformSearch = (query) => new Promise(resolve => {
    superagent
        .get('https://api.spotify.com/v1/search')
        .set('Authorization', `Bearer ${authentication.token}`)
        .query({
            q: query,
            type: 'track'
        })
        .then(resp => {
            resolve(resp.body);
        })
        .catch(error => {
            if (!error.response) {
                console.log('Error searching spotify:', error);
                resolve();
            }

            if (error.response.text.includes('Token expired')) {
                return getBearerToken()
                    .then(() => preformSearch(query))
                    .then(resolve);
            }

            console.log('Error searching Spotify:', error.response.text);
            resolve();
        });
});

const app = express();

app.get('/search', (req, resp) => {
    const {
        q: query
    } = req.query;

    preformSearch(query)
        .then(results => {
            resp.send(results);
        });
});

app.get('*', (req, resp) =>
    resp.redirect('https://danny.ink/'));

await getBearerToken();

app.listen(3000, () => {
    console.log('Listening on port 3000');
});