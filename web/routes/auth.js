const { Router } = require('express');
const axios = require('axios');
const crypto = require('crypto');

const router = Router();

const DISCORD_API = 'https://discord.com/api/v10';
const SCOPES = 'identify guilds';
const AXIOS_TIMEOUT = 5000;

router.get('/login', (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    redirect_uri: process.env.REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  res.redirect(`${DISCORD_API}/oauth2/authorize?${params}`);
});

router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) return res.redirect('/auth/login');

  // CSRF state validation
  if (!state || state !== req.session.oauthState) {
    return res.status(403).send('Invalid state — possible CSRF attack');
  }
  delete req.session.oauthState;

  try {
    const tokenRes = await axios.post(
      `${DISCORD_API}/oauth2/token`,
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: AXIOS_TIMEOUT,
      }
    );

    const { access_token } = tokenRes.data;
    if (!access_token) {
      console.error('OAuth: no access_token in response');
      return res.redirect('/auth/login');
    }

    const [userRes, guildsRes] = await Promise.all([
      axios.get(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: AXIOS_TIMEOUT,
      }),
      axios.get(`${DISCORD_API}/users/@me/guilds`, {
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: AXIOS_TIMEOUT,
      }),
    ]);

    req.session.user = {
      id: userRes.data.id,
      username: userRes.data.username,
      avatar: userRes.data.avatar
        ? `https://cdn.discordapp.com/avatars/${userRes.data.id}/${userRes.data.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
      guilds: guildsRes.data,
    };

    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback failed:', err.code ?? err.message);
    res.redirect('/auth/login');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/auth/login');
});

module.exports = router;
