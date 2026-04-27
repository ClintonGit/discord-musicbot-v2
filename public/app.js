/* ── State ── */
let currentGuildId = null;
let sortable = null;
let isPaused = false;
let guildLoadId = 0;
let currentTrackData = null;
let suggestDebounce = null;
let autocompleteTimer = null;
let autocompleteResults = [];
let recentlyPlayed = [];
let isSeekDragging = false;
let currentDynColorUrl = null;

const socket = io();

/* ── Socket connection status ── */
socket.on('disconnect', () => document.getElementById('onlineDot')?.classList.add('offline'));
socket.on('connect', () => {
  document.getElementById('onlineDot')?.classList.remove('offline');
  if (currentGuildId) socket.emit('join:guild', currentGuildId);
});

/* ── Init ── */
(async () => {
  const guilds = await api('/guilds');
  renderGuilds(guilds);
  loadUser();
  initSeekBar();
})();

/* ── Autocomplete setup ── */
document.getElementById('searchInput').addEventListener('input', function() {
  clearTimeout(autocompleteTimer);
  const q = this.value.trim();
  if (!q || q.length < 2 || !currentGuildId) { hideAutocomplete(); return; }
  autocompleteTimer = setTimeout(() => fetchAutocomplete(q), 350);
});

document.getElementById('searchInput').addEventListener('blur', () => {
  setTimeout(hideAutocomplete, 200);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-input-wrap')) hideAutocomplete();
});

async function loadUser() {
  const meRes = await fetch('/api/me').catch(() => null);
  if (!meRes?.ok) return;
  const me = await meRes.json();
  document.getElementById('userName').textContent = me.username;
  if (me.avatar) document.getElementById('userAvatar').src = me.avatar;
}

/* ── Guild List ── */
function renderGuilds(guilds) {
  const list = document.getElementById('guildList');
  list.innerHTML = '';
  if (!guilds.length) {
    list.innerHTML = '<div style="padding:10px 12px;color:var(--muted);font-size:12px;">Bot ไม่ได้อยู่ใน server ไหนเลย</div>';
    return;
  }
  guilds.forEach(g => {
    const div = document.createElement('div');
    div.className = 'guild-item';
    div.dataset.id = g.id;
    const iconUrl = g.icon
      ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;
    div.innerHTML = `<img src="${iconUrl}" alt="" /><span>${esc(g.name)}</span>`;
    div.addEventListener('click', () => selectGuild(g.id, g.name));
    list.appendChild(div);
  });
}

/* ── Select Guild ── */
async function selectGuild(guildId, guildName) {
  const loadId = ++guildLoadId;
  currentGuildId = guildId;

  document.querySelectorAll('.guild-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === guildId));

  document.getElementById('noGuild').style.display = 'none';
  const gc = document.getElementById('guildContent');
  gc.style.display = 'flex';
  gc.style.flexDirection = 'column';
  gc.style.flex = '1';
  gc.style.overflow = 'hidden';
  document.getElementById('guildName').textContent = guildName;
  document.getElementById('onlineDot').classList.remove('offline');

  socket.emit('join:guild', guildId);

  const [queueData] = await Promise.all([
    api(`/guilds/${guildId}/queue`),
    refreshHistory(),
  ]);

  if (loadId !== guildLoadId) return;
  renderQueue(queueData);
}

/* ── Render Queue ── */
function renderQueue(data) {
  const { currentTrack, tracks = [], isPlaying, isPaused: paused, volume } = data;
  isPaused = paused;
  currentTrackData = currentTrack;

  const npEmpty = document.getElementById('npEmpty');
  const npContent = document.getElementById('npContent');
  const eqBars = document.getElementById('eqBars');

  if (currentTrack) {
    npEmpty.style.display = 'none';
    npContent.style.display = 'flex';
    document.getElementById('npArt').src = currentTrack.thumbnail || '';
    document.getElementById('npTitle').textContent = currentTrack.title;
    document.getElementById('npAuthor').textContent = currentTrack.author;
    document.getElementById('npTotal').textContent = currentTrack.duration;
    updatePauseBtn(paused);
    setArtBg(currentTrack.thumbnail);
    if (eqBars) eqBars.classList.toggle('paused', !!paused);
    updateDynamicTheme(currentTrack.thumbnail);
    setVinylSpin(!paused);
  } else {
    npEmpty.style.display = 'flex';
    npContent.style.display = 'none';
    setProgress(0, '0:00', '0:00');
    setArtBg(null);
    applyDynamicColor(null);
    clearVinylSpin();
    currentDynColorUrl = null;
  }

  if (volume !== undefined) {
    document.getElementById('volumeSlider').value = volume;
    document.getElementById('volumeLabel').textContent = volume;
  }

  renderQueueList(currentTrack, tracks);
}

function thumbWrap(url, onclick) {
  return `
    <div class="queue-thumb-wrap" ${onclick ? `onclick="${onclick}"` : ''}>
      <img class="queue-thumb" src="${esc(url || '')}" alt="" onerror="this.src=''" />
      ${onclick ? `<div class="queue-play-overlay"><svg viewBox="0 0 24 24" fill="white" width="16" height="16"><path d="M8 5v14l11-7z"/></svg></div>` : ''}
    </div>`;
}

function renderQueueList(currentTrack, tracks) {
  const list = document.getElementById('queueList');
  const total = tracks.length + (currentTrack ? 1 : 0);
  document.getElementById('queueCount').textContent = `${total} เพลง`;

  if (!total && !recentlyPlayed.length) {
    list.innerHTML = '<div class="queue-empty">Queue ว่างอยู่ เพิ่มเพลงได้เลย</div>';
    if (sortable) { sortable.destroy(); sortable = null; }
    return;
  }

  let html = '';

  // Current track
  if (currentTrack) {
    if (tracks.length || recentlyPlayed.length) html += `<div class="queue-section-label">กำลังเล่น</div>`;
    html += `
      <div class="queue-item now-playing-item">
        <span class="queue-pos playing-indicator">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </span>
        ${thumbWrap(currentTrack.thumbnail)}
        <div class="queue-meta">
          <div class="queue-title" title="${esc(currentTrack.title)}">${esc(currentTrack.title)}</div>
          <div class="queue-author">${esc(currentTrack.author)}</div>
        </div>
        <span class="now-playing-badge">▶ กำลังเล่น</span>
      </div>`;
  }

  // Upcoming tracks (draggable + hover play + click title to jump)
  if (tracks.length) {
    if (currentTrack) html += `<div class="queue-section-label">ถัดไป</div>`;
    html += tracks.map((t, i) => `
      <div class="queue-item" data-index="${i}">
        <span class="drag-handle">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>
        </span>
        <span class="queue-pos">${i + 1}</span>
        ${thumbWrap(t.thumbnail, `jumpToTrack(${i})`)}
        <div class="queue-meta queue-meta-jump" onclick="jumpToTrack(${i})" title="กดเพื่อข้ามมาเพลงนี้">
          <div class="queue-title" title="${esc(t.title)}">${esc(t.title)}</div>
          <div class="queue-author">${esc(t.author)}</div>
        </div>
        <span class="queue-dur">${esc(t.duration)}</span>
        <button class="queue-remove" onclick="removeTrack(${i})" title="ลบออก">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>`).join('');
  }

  // Recently played section (at the BOTTOM — click to play immediately)
  if (recentlyPlayed.length) {
    html += `<div class="queue-section-label">เพิ่งเล่น</div>`;
    html += recentlyPlayed.map(t => `
      <div class="queue-item queue-item-history" onclick="addTrackDirect('${esc(t.url)}', 'now')">
        ${thumbWrap(t.thumbnail)}
        <div class="queue-meta">
          <div class="queue-title" title="${esc(t.title)}">${esc(t.title)}</div>
          <div class="queue-author">${esc(t.author)}</div>
        </div>
        <span class="queue-dur">${esc(t.duration)}</span>
      </div>`).join('');
  }

  list.innerHTML = html;

  const draggableItems = [...list.querySelectorAll('.queue-item:not(.now-playing-item):not(.queue-item-history)')];
  if (!draggableItems.length) { if (sortable) { sortable.destroy(); sortable = null; } return; }

  if (sortable) sortable.destroy();
  sortable = Sortable.create(list, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    handle: '.drag-handle',
    filter: '.now-playing-item, .queue-item-history',
    onEnd: async evt => {
      const offset = currentTrack ? 1 : 0;
      const oldIdx = evt.oldIndex - offset;
      const newIdx = evt.newIndex - offset;
      if (oldIdx === newIdx || oldIdx < 0 || newIdx < 0) return;
      const items = [...list.querySelectorAll('.queue-item:not(.now-playing-item):not(.queue-item-history)')];
      const newOrder = items.map(el => parseInt(el.dataset.index));
      await api(`/guilds/${currentGuildId}/queue/reorder`, 'PUT', { newOrder });
      await refreshQueue();
    },
  });
}

/* ── Dynamic Art Background ── */
function setArtBg(url) {
  const bg = document.getElementById('artBg');
  if (!bg) return;
  bg.style.backgroundImage = url ? `url(${url})` : 'none';
}

/* ── Controls ── */
async function sendControl(action) {
  if (!currentGuildId) return;
  await api(`/guilds/${currentGuildId}/controls/${action}`, 'POST');
  if (action === 'pause') { isPaused = true; updatePauseBtn(true); }
  else if (action === 'resume') { isPaused = false; updatePauseBtn(false); }
  setTimeout(refreshQueue, 300);
}

function updatePauseBtn(paused) {
  const btn = document.getElementById('btnPause');
  const eqBars = document.getElementById('eqBars');
  if (!btn) return;
  if (paused) {
    btn.title = 'Resume';
    btn.onclick = () => sendControl('resume');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    if (eqBars) eqBars.classList.add('paused');
    setVinylSpin(false);
  } else {
    btn.title = 'Pause';
    btn.onclick = () => sendControl('pause');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    if (eqBars) eqBars.classList.remove('paused');
    if (currentTrackData) setVinylSpin(true);
  }
}

/* ── Volume ── */
let volumeTimer = null;
function onVolumeChange(val) {
  document.getElementById('volumeLabel').textContent = val;
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => {
    if (!currentGuildId) return;
    api(`/guilds/${currentGuildId}/controls/volume`, 'POST', { level: parseInt(val) });
  }, 300);
}

/* ── Add Track (form submit → add to end) ── */
async function addTrack(evt) {
  evt.preventDefault();
  hideAutocomplete();
  if (!currentGuildId) return alert('เลือก server ก่อนนะ');
  const input = document.getElementById('searchInput');
  const query = input.value.trim();
  if (!query) return;

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังเพิ่ม...';

  try {
    const res = await api(`/guilds/${currentGuildId}/queue`, 'POST', { query, position: 'end' });
    if (res.error) {
      alert(res.error);
    } else {
      input.value = '';
      if (res.playlist) showNotice(`เพิ่ม "${res.name}" ${res.count} เพลงแล้ว 🎵`);
    }
  } catch {
    alert('เชื่อมต่อไม่ได้ ลองใหม่อีกที');
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg> เพิ่ม`;
}

function showNotice(msg) {
  const el = document.getElementById('playlistNotice');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

/* ── Autocomplete ── */
async function fetchAutocomplete(q) {
  if (!currentGuildId) return;
  const input = document.getElementById('searchInput');
  input.classList.add('ac-loading');
  const results = await api(`/guilds/${currentGuildId}/suggest?q=${encodeURIComponent(q)}`);
  input.classList.remove('ac-loading');
  if (!Array.isArray(results)) return;
  autocompleteResults = results;
  renderAutocomplete(results);
}

function renderAutocomplete(results) {
  const dropdown = document.getElementById('searchAutocomplete');
  if (!dropdown) return;
  if (!results.length) { hideAutocomplete(); return; }
  dropdown.innerHTML = results.map((t, i) => `
    <div class="autocomplete-item">
      <img class="ac-thumb" src="${esc(ytThumb(t.url) || t.thumbnail || '')}" alt="" onerror="this.style.opacity='0'" />
      <div class="ac-meta">
        <div class="ac-title" title="${esc(t.title)}">${esc(t.title)}</div>
        <div class="ac-info">${esc(t.author)} · ${esc(t.duration)}</div>
      </div>
      <div class="ac-actions">
        <button class="ac-btn ac-now" onclick="pickAutocomplete(${i},'now')" title="เล่นเลย">▶</button>
        <button class="ac-btn ac-next" onclick="pickAutocomplete(${i},'next')" title="เล่นต่อจากนี้">↑</button>
        <button class="ac-btn" onclick="pickAutocomplete(${i},'end')" title="ท้ายคิว">+</button>
      </div>
    </div>
  `).join('');
  dropdown.style.display = 'block';
}

function hideAutocomplete() {
  const dropdown = document.getElementById('searchAutocomplete');
  if (dropdown) dropdown.style.display = 'none';
}

async function pickAutocomplete(idx, position) {
  const track = autocompleteResults[idx];
  if (!track || !currentGuildId) return;
  hideAutocomplete();
  document.getElementById('searchInput').value = '';

  const res = await api(`/guilds/${currentGuildId}/queue`, 'POST', { query: track.url, position });
  if (res.error) alert(res.error);
  else if (position === 'now') showNotice(`▶ เล่น "${res.title}" เลย`);
  else if (position === 'next') showNotice(`↑ "${res.title}" จะเล่นต่อจากนี้`);
  else showNotice(`+ เพิ่ม "${res.title}" แล้ว`);
}

/* ── Jump to Track ── */
async function jumpToTrack(index) {
  if (!currentGuildId) return;
  await api(`/guilds/${currentGuildId}/queue/${index}/jump`, 'POST');
  setTimeout(refreshQueue, 300);
}

/* ── Clear Queue ── */
async function clearQueue() {
  if (!currentGuildId) return;
  await api(`/guilds/${currentGuildId}/controls/clearqueue`, 'POST');
  await refreshQueue();
}

/* ── Remove Track ── */
async function removeTrack(index) {
  if (!currentGuildId) return;
  await api(`/guilds/${currentGuildId}/queue/${index}`, 'DELETE');
  await refreshQueue();
}

/* ── Add Track Direct (from suggest/history tabs) ── */
async function addTrackDirect(url, position = 'end') {
  if (!currentGuildId) return alert('เลือก server ก่อนนะ');
  const res = await api(`/guilds/${currentGuildId}/queue`, 'POST', { query: url, position });
  if (res.error) alert(res.error);
  else showNotice(`เพิ่มเพลงแล้ว 🎵`);
}

/* ── Seekbar (drag + click) ── */
function initSeekBar() {
  const bar = document.getElementById('progressBar');
  if (!bar) return;

  bar.addEventListener('mousedown', (e) => {
    if (!currentGuildId || !currentTrackData) return;
    isSeekDragging = true;
    bar.classList.add('is-seeking');
    document.body.style.userSelect = 'none';
    seekUpdateVisual(e.clientX, bar);
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isSeekDragging) return;
    seekUpdateVisual(e.clientX, document.getElementById('progressBar'));
  });

  document.addEventListener('mouseup', (e) => {
    if (!isSeekDragging) return;
    isSeekDragging = false;
    const bar = document.getElementById('progressBar');
    bar.classList.remove('is-seeking');
    document.body.style.userSelect = '';
    const fill = document.getElementById('npProgressFill');
    if (fill) fill.style.transition = 'width 0.9s linear';
    const pct = seekGetPct(e.clientX, bar);
    const posMs = Math.floor(pct * durationToMs(currentTrackData?.duration));
    api(`/guilds/${currentGuildId}/controls/seek`, 'POST', { position: posMs });
  });
}

function seekUpdateVisual(clientX, bar) {
  if (!bar) return;
  const pct = seekGetPct(clientX, bar);
  const fill = document.getElementById('npProgressFill');
  if (fill) { fill.style.transition = 'none'; fill.style.width = (pct * 100) + '%'; }
  const curr = document.getElementById('npCurrent');
  if (curr && currentTrackData) curr.textContent = msToTime(Math.floor(pct * durationToMs(currentTrackData.duration)));
}

function seekGetPct(clientX, bar) {
  if (!bar) return 0;
  const rect = bar.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function durationToMs(dur) {
  if (!dur || dur === '—') return 0;
  const parts = String(dur).split(':').map(Number);
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return 0;
}

function msToTime(ms) {
  if (!ms || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const sec = String(s % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${sec}`;
  return `${m}:${sec}`;
}

/* ── Refresh ── */
async function refreshQueue() {
  if (!currentGuildId) return;
  const data = await api(`/guilds/${currentGuildId}/queue`);
  if (currentGuildId) renderQueue(data);
}

/* ── History ── */
async function refreshHistory() {
  if (!currentGuildId) return;
  const history = await api(`/guilds/${currentGuildId}/history`);
  const list = document.getElementById('historyList');
  if (!history.length) {
    list.innerHTML = '<div class="queue-empty">ยังไม่มีประวัติ</div>';
    return;
  }
  list.innerHTML = history.map(h => {
    const thumb = ytThumb(h.url);
    return `
    <div class="history-item">
      <img class="history-thumb" src="${esc(thumb)}" alt="" onerror="this.style.opacity='0.3'" />
      <div class="history-meta">
        <div class="history-title">${esc(h.title)}</div>
        <div class="history-info">${esc(h.author)} · ${timeAgo(h.playedAt)}</div>
      </div>
      <button class="queue-add-btn" onclick="addTrackDirect('${esc(h.url)}')" title="เพิ่มเข้า Queue">+</button>
    </div>`;
  }).join('');
}

/* ── Suggested Tracks ── */
async function refreshSuggestions(track) {
  if (!track || !currentGuildId) return;
  const list = document.getElementById('suggestList');
  const label = document.getElementById('suggestLabel');
  list.innerHTML = '<div class="queue-empty">กำลังหาเพลงแนะนำ...</div>';
  if (label) label.textContent = '...';

  const q = `${track.title} ${track.author}`.replace(/[-–—()\[\]]/g, ' ').trim();
  const results = await api(`/guilds/${currentGuildId}/suggest?q=${encodeURIComponent(q)}`);

  if (!results.length) {
    list.innerHTML = '<div class="queue-empty">ไม่พบเพลงแนะนำ</div>';
    if (label) label.textContent = '0';
    return;
  }

  if (label) label.textContent = `${results.length} เพลง`;
  list.innerHTML = results.map(t => `
    <div class="queue-item">
      <img class="queue-thumb" src="${esc(ytThumb(t.url) || t.thumbnail || '')}" alt="" onerror="this.src=''" />
      <div class="queue-meta">
        <div class="queue-title" title="${esc(t.title)}">${esc(t.title)}</div>
        <div class="queue-author">${esc(t.author)}</div>
      </div>
      <span class="queue-dur">${esc(t.duration)}</span>
      <button class="queue-add-btn" onclick="addTrackDirect('${esc(t.url)}')" title="เพิ่มเข้า Queue">+ Add</button>
    </div>
  `).join('');
}

/* ── Tabs ── */
function switchTab(name) {
  const tabNames = ['queue', 'suggest', 'playlists', 'history', 'settings'];
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', tabNames[i] === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panelMap = {
    queue: 'tabQueue', suggest: 'tabSuggest',
    playlists: 'tabPlaylists', history: 'tabHistory', settings: 'tabSettings',
  };
  const panel = document.getElementById(panelMap[name]);
  if (panel) panel.classList.add('active');

  if (name === 'history') refreshHistory();
  if (name === 'playlists') refreshPlaylists();
  if (name === 'suggest') refreshSuggestions(currentTrackData);
  if (name === 'settings') loadSettings();
}

/* ── Settings ── */
async function loadSettings() {
  if (!currentGuildId) return;
  const [channels, config] = await Promise.all([
    api(`/guilds/${currentGuildId}/channels`),
    api(`/guilds/${currentGuildId}/config`),
  ]);

  const sel = document.getElementById('notifyChannelSelect');
  sel.innerHTML = '<option value="">— ปิดการแจ้งเตือน —</option>';
  (channels || []).forEach(ch => {
    const opt = document.createElement('option');
    opt.value = ch.id;
    opt.textContent = `# ${ch.name}`;
    if (ch.id === config?.notifyChannelId) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function saveConfig() {
  if (!currentGuildId) return;
  const sel = document.getElementById('notifyChannelSelect');
  const notice = document.getElementById('configNotice');
  const res = await api(`/guilds/${currentGuildId}/config`, 'PUT', { notifyChannelId: sel.value || null });

  notice.classList.remove('error');
  if (res.ok) {
    notice.textContent = '✅ บันทึกแล้ว!';
  } else {
    notice.classList.add('error');
    notice.textContent = res.error || 'เกิดข้อผิดพลาด';
  }
  setTimeout(() => { notice.textContent = ''; }, 3000);
}

/* ── Playlists ── */
async function refreshPlaylists() {
  if (!currentGuildId) return;
  const playlists = await api(`/guilds/${currentGuildId}/playlists`);
  renderPlaylists(Array.isArray(playlists) ? playlists : []);
}

function renderPlaylists(playlists) {
  const list = document.getElementById('playlistList');
  document.getElementById('playlistCount').textContent = playlists.length;

  if (!playlists.length) {
    list.innerHTML = '<div class="queue-empty">ยังไม่มี playlist<br>บันทึกจาก Queue ได้เลย</div>';
    return;
  }

  list.innerHTML = playlists.map(pl => `
    <div class="playlist-item" id="pl-${esc(pl.id)}">
      <div class="playlist-header">
        <div class="playlist-icon">
          <svg viewBox="0 0 24 24"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
        </div>
        <div class="playlist-meta">
          <div class="playlist-name">${esc(pl.name)}</div>
          <div class="playlist-info">${pl.tracks.length} เพลง · ${timeAgo(pl.createdAt)}</div>
        </div>
        <div class="playlist-actions">
          <button class="pl-btn play" onclick="playPlaylist('${esc(pl.id)}')" title="เล่น">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="pl-btn del" onclick="deletePlaylist('${esc(pl.id)}')" title="ลบ">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>
      <div class="playlist-tracks">
        ${pl.tracks.slice(0, 5).map((t, i) => `
          <div class="pl-track">
            <span class="pl-track-num">${i + 1}</span>
            <span class="pl-track-title" title="${esc(t.title)}">${esc(t.title)}</span>
            <span class="pl-track-dur">${esc(t.duration)}</span>
          </div>`).join('')}
        ${pl.tracks.length > 5 ? `<div class="pl-track"><span style="font-size:11px;color:var(--muted)">+${pl.tracks.length - 5} เพลงอีก</span></div>` : ''}
      </div>
    </div>
  `).join('');
}

async function saveQueueAsPlaylist() {
  if (!currentGuildId) return;
  const queueData = await api(`/guilds/${currentGuildId}/queue`);
  const tracks = [
    ...(queueData.currentTrack ? [queueData.currentTrack] : []),
    ...(queueData.tracks ?? []),
  ];
  if (!tracks.length) { alert('Queue ว่างอยู่'); return; }
  const name = prompt(`ตั้งชื่อ Playlist (${tracks.length} เพลง):`);
  if (!name?.trim()) return;
  const res = await api(`/guilds/${currentGuildId}/playlists`, 'POST', { name, tracks });
  if (res.error) alert(res.error);
  else { showNotice(`บันทึก "${res.name}" แล้ว 🎵`); switchTab('playlists'); }
}

async function playPlaylist(pid) {
  if (!currentGuildId) return;
  const btn = document.querySelector(`#pl-${pid} .pl-btn.play`);
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
  const res = await api(`/guilds/${currentGuildId}/playlists/${pid}/play`, 'POST');
  if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  if (res.error) alert(res.error);
  else switchTab('queue');
}

async function deletePlaylist(pid) {
  if (!currentGuildId) return;
  if (!confirm('ลบ playlist นี้?')) return;
  const res = await api(`/guilds/${currentGuildId}/playlists/${pid}`, 'DELETE');
  if (res.error) alert(res.error);
  else refreshPlaylists();
}

/* ── Socket.io Realtime ── */
socket.on('queue:update', data => {
  if (data.guildId && data.guildId !== currentGuildId) return;
  renderQueue(data);
  if (document.getElementById('tabSuggest')?.classList.contains('active') && data.currentTrack) {
    clearTimeout(suggestDebounce);
    suggestDebounce = setTimeout(() => refreshSuggestions(data.currentTrack), 1000);
  }
});

socket.on('track:start', track => {
  if (!currentGuildId) return;
  // Archive previous track into recently played
  if (currentTrackData) {
    recentlyPlayed.unshift(currentTrackData);
    recentlyPlayed = recentlyPlayed.slice(0, 3);
  }
  currentTrackData = track;
  document.getElementById('npArt').src = track.thumbnail || '';
  document.getElementById('npTitle').textContent = track.title;
  document.getElementById('npAuthor').textContent = track.author;
  document.getElementById('npTotal').textContent = track.duration;
  document.getElementById('npEmpty').style.display = 'none';
  document.getElementById('npContent').style.display = 'flex';
  setProgress(0, '0:00', track.duration);
  setArtBg(track.thumbnail);
  document.getElementById('eqBars')?.classList.remove('paused');
  updateDynamicTheme(track.thumbnail);
  setVinylSpin(true);
  if (document.getElementById('tabSuggest')?.classList.contains('active')) {
    clearTimeout(suggestDebounce);
    suggestDebounce = setTimeout(() => refreshSuggestions(track), 1500);
  }
});

socket.on('progress:tick', data => {
  if (isSeekDragging) return;
  setProgress(data.progress, data.current, data.total);
});

function setProgress(pct, current, total) {
  const fill = document.getElementById('npProgressFill');
  const curr = document.getElementById('npCurrent');
  const tot = document.getElementById('npTotal');
  if (fill) fill.style.width = (pct || 0) + '%';
  if (curr) curr.textContent = current || '0:00';
  if (tot && total) tot.textContent = total;
}

/* ── Dynamic Color Extraction ── */
async function extractDominantColor(thumbnailUrl) {
  if (!thumbnailUrl) return null;
  return new Promise((resolve) => {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(thumbnailUrl)}`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 40;
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        let best = { r: 59, g: 130, b: 246, score: -1 };
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;
          const maxC = Math.max(r, g, b) / 255;
          const minC = Math.min(r, g, b) / 255;
          const l = (maxC + minC) / 2;
          const s = maxC === minC ? 0 : (maxC - minC) / (1 - Math.abs(2 * l - 1));
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          if (brightness > 35 && brightness < 215 && s > 0.3 && s > best.score) {
            best = { r, g, b, score: s };
          }
        }
        resolve(best);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = proxyUrl;
  });
}

function applyDynamicColor(color) {
  const root = document.documentElement;
  const bar = document.querySelector('.player-bar');
  if (!color) {
    root.style.setProperty('--dyn-color', '#3B82F6');
    root.style.setProperty('--dyn-glow', 'rgba(59,130,246,0.45)');
    root.style.setProperty('--dyn-glow-soft', 'rgba(59,130,246,0.15)');
    if (bar) bar.style.boxShadow = '';
    return;
  }
  const { r, g, b } = color;
  root.style.setProperty('--dyn-color', `rgb(${r},${g},${b})`);
  root.style.setProperty('--dyn-glow', `rgba(${r},${g},${b},0.35)`);
  root.style.setProperty('--dyn-glow-soft', `rgba(${r},${g},${b},0.10)`);
  if (bar) bar.style.boxShadow = `0 -6px 24px rgba(${r},${g},${b},0.08), 0 -1px 0 rgba(${r},${g},${b},0.2)`;
}

async function updateDynamicTheme(thumbnailUrl) {
  if (!thumbnailUrl || thumbnailUrl === currentDynColorUrl) return;
  currentDynColorUrl = thumbnailUrl;
  const color = await extractDominantColor(thumbnailUrl);
  applyDynamicColor(color);
}

/* ── Vinyl Spin ── */
function setVinylSpin(playing) {
  const wrap = document.querySelector('.pb-art-wrap');
  if (!wrap) return;
  if (playing) {
    wrap.classList.add('spinning');
    wrap.classList.remove('paused');
  } else {
    if (wrap.classList.contains('spinning')) wrap.classList.add('paused');
  }
}

function clearVinylSpin() {
  const wrap = document.querySelector('.pb-art-wrap');
  if (wrap) wrap.classList.remove('spinning', 'paused');
}

/* ── Helpers ── */
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  return res.json().catch(() => ({}));
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function ytThumb(url) {
  if (!url) return '';
  const m = String(url).match(/(?:[?&]v=|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{11})/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg` : '';
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'เมื่อกี้';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}
