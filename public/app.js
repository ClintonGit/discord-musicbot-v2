/* ── State ── */
let currentGuildId = null;
let sortable = null;
let isPaused = false;

const socket = io();

/* ── Init ── */
(async () => {
  const guilds = await api('/guilds');
  renderGuilds(guilds);
  loadUser();
})();

/* ── User info from session ── */
async function loadUser() {
  const res = await fetch('/api/guilds');
  // user info embedded in sidebar footer via server-side HTML isn't practical
  // fetch separately via dedicated endpoint instead
  const meRes = await fetch('/api/me').catch(() => null);
  if (!meRes || !meRes.ok) return;
  const me = await meRes.json();
  document.getElementById('userName').textContent = me.username;
  document.getElementById('userAvatar').src = me.avatar;
}

/* ── Guild List ── */
function renderGuilds(guilds) {
  const list = document.getElementById('guildList');
  list.innerHTML = '';
  if (!guilds.length) {
    list.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:13px;">Bot ไม่ได้อยู่ใน server ไหนเลยค่ะ</div>';
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
  currentGuildId = guildId;

  document.querySelectorAll('.guild-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === guildId);
  });

  document.getElementById('noGuild').style.display = 'none';
  const gc = document.getElementById('guildContent');
  gc.style.display = 'flex';
  document.getElementById('guildName').textContent = guildName;
  document.getElementById('onlineDot').classList.remove('offline');

  socket.emit('join:guild', guildId);

  await Promise.all([refreshQueue(), refreshHistory()]);
}

/* ── Refresh Queue ── */
async function refreshQueue() {
  if (!currentGuildId) return;
  const data = await api(`/guilds/${currentGuildId}/queue`);
  renderQueue(data);
}

function renderQueue(data) {
  const { currentTrack, tracks = [], isPlaying, isPaused: paused, volume } = data;
  isPaused = paused;

  // Now Playing
  const npEmpty = document.getElementById('npEmpty');
  const npContent = document.getElementById('npContent');
  if (currentTrack) {
    npEmpty.style.display = 'none';
    npContent.style.display = 'block';
    document.getElementById('npArt').src = currentTrack.thumbnail || '';
    document.getElementById('npTitle').textContent = currentTrack.title;
    document.getElementById('npAuthor').textContent = currentTrack.author;
    document.getElementById('npDuration').textContent = currentTrack.duration;
    updatePauseBtn(paused);
  } else {
    npEmpty.style.display = '';
    npContent.style.display = 'none';
  }

  // Volume
  if (volume !== undefined) {
    document.getElementById('volumeSlider').value = volume;
    document.getElementById('volumeLabel').textContent = volume;
  }

  // Queue list
  const list = document.getElementById('queueList');
  document.getElementById('queueCount').textContent = `${tracks.length} เพลง`;

  if (!tracks.length) {
    list.innerHTML = '<div class="queue-empty">Queue ว่างอยู่ค่ะ เพิ่มเพลงได้เลย!</div>';
    if (sortable) { sortable.destroy(); sortable = null; }
    return;
  }

  list.innerHTML = tracks.map((t, i) => `
    <div class="queue-item" data-index="${i}">
      <span class="drag-handle">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>
      </span>
      <span class="queue-pos">${i + 1}</span>
      <img class="queue-thumb" src="${esc(t.thumbnail || '')}" alt="" onerror="this.src=''" />
      <div class="queue-meta">
        <div class="queue-title" title="${esc(t.title)}">${esc(t.title)}</div>
        <div class="queue-author">${esc(t.author)}</div>
      </div>
      <span class="queue-dur">${esc(t.duration)}</span>
      <button class="queue-remove" onclick="removeTrack(${i})" title="ลบออก">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
  `).join('');

  // Init Sortable
  if (sortable) sortable.destroy();
  sortable = Sortable.create(list, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    handle: '.drag-handle',
    onEnd: async evt => {
      if (evt.oldIndex === evt.newIndex) return;
      const items = [...list.querySelectorAll('.queue-item')];
      const newOrder = items.map(el => parseInt(el.dataset.index));
      await api(`/guilds/${currentGuildId}/queue/reorder`, 'PUT', { newOrder });
      // re-fetch to sync
      await refreshQueue();
    },
  });
}

/* ── Controls ── */
async function sendControl(action) {
  if (!currentGuildId) return;
  await api(`/guilds/${currentGuildId}/controls/${action}`, 'POST');
  if (action === 'pause') {
    isPaused = true;
    updatePauseBtn(true);
  } else if (action === 'resume') {
    isPaused = false;
    updatePauseBtn(false);
  }
  setTimeout(refreshQueue, 300);
}

function updatePauseBtn(paused) {
  const btn = document.getElementById('btnPause');
  if (paused) {
    btn.title = 'Resume';
    btn.onclick = () => sendControl('resume');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  } else {
    btn.title = 'Pause';
    btn.onclick = () => sendControl('pause');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
  }
}

let volumeTimer = null;
function onVolumeChange(val) {
  document.getElementById('volumeLabel').textContent = val;
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => {
    if (!currentGuildId) return;
    api(`/guilds/${currentGuildId}/controls/volume`, 'POST', { level: parseInt(val) });
  }, 300);
}

/* ── Add Track ── */
async function addTrack(evt) {
  evt.preventDefault();
  if (!currentGuildId) return alert('เลือก server ก่อนนะคะ');
  const input = document.getElementById('searchInput');
  const query = input.value.trim();
  if (!query) return;

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังเพิ่ม...';

  const res = await api(`/guilds/${currentGuildId}/queue`, 'POST', { query });
  if (res.error) {
    alert(res.error);
  } else {
    input.value = '';
  }

  btn.disabled = false;
  btn.textContent = '+ Add';
}

/* ── Remove Track ── */
async function removeTrack(index) {
  if (!currentGuildId) return;
  await api(`/guilds/${currentGuildId}/queue/${index}`, 'DELETE');
  await refreshQueue();
}

/* ── History ── */
async function refreshHistory() {
  if (!currentGuildId) return;
  const history = await api(`/guilds/${currentGuildId}/history`);
  const list = document.getElementById('historyList');
  if (!history.length) {
    list.innerHTML = '<div class="queue-empty">ยังไม่มีประวัติค่ะ</div>';
    return;
  }
  list.innerHTML = history.map(h => `
    <div class="history-item">
      <img class="history-thumb" src="" alt="" />
      <div class="history-meta">
        <div class="history-title">${esc(h.title)}</div>
        <div class="history-info">${esc(h.author)} · ${timeAgo(h.playedAt)}</div>
      </div>
    </div>
  `).join('');
}

/* ── Tabs ── */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', ['queue', 'history'][i] === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(name === 'queue' ? 'tabQueue' : 'tabHistory').classList.add('active');
  if (name === 'history') refreshHistory();
}

/* ── Socket.io real-time ── */
socket.on('queue:update', data => {
  if (data.guildId && data.guildId !== currentGuildId) return;
  renderQueue(data);
});

socket.on('track:start', track => {
  if (!currentGuildId) return;
  document.getElementById('npArt').src = track.thumbnail || '';
  document.getElementById('npTitle').textContent = track.title;
  document.getElementById('npAuthor').textContent = track.author;
  document.getElementById('npDuration').textContent = track.duration;
  document.getElementById('npEmpty').style.display = 'none';
  document.getElementById('npContent').style.display = 'block';
});

/* ── Helpers ── */
async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  return res.json().catch(() => ({}));
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
