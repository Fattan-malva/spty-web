(function () {
  var params = new URLSearchParams(location.search);

  var state = {
    spDc: '',
    trackId: '',
    lyrics: null,
    lyricTimer: null,
    activeLine: -1,
    playhead: 0,
    useMsg: false,
    lastMessageAt: 0,
    autoplayPending: false,
    autoplayDone: false,
    endedBound: false,
    isPlaying: false,
    queueAdvancePending: false,
    embedded: params.get('embedded') === '1',
    mini: params.get('mini') === '1',
    expanded: false
  };

  var el = {
    btnBack: document.getElementById('btnBack'),
    pvTitle: document.getElementById('pvTitle'),
    pvArtist: document.getElementById('pvArtist'),
    pvLoading: document.getElementById('pvLoading'),
    embedPanel: document.getElementById('embedPanel'),
    spWidget: document.getElementById('spWidget'),
    lyricsOuter: document.getElementById('lyricsOuter'),
    pvLyricsWrap: document.getElementById('pvLyricsWrap'),
    pvLyrics: document.getElementById('pvLyrics'),
    gate: document.getElementById('gate'),
    gateBack: document.getElementById('gateBack'),
    toast: document.getElementById('toast')
  };

  function credQ() {
    return state.spDc ? ('&sp_dc=' + encodeURIComponent(state.spDc)) : '';
  }

  function api(url) {
    return fetch(url).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('application/json') === -1) {
        var err = new Error('Not JSON');
        err.needsSpdc = res.status === 401;
        err.status = res.status;
        throw err;
      }
      if (!res.ok) {
        var err2 = new Error('HTTP ' + res.status);
        err2.status = res.status;
        throw err2;
      }
      return res.json();
    });
  }

  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(el.toast._t);
    el.toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, ms || 2200);
  }

  function loadSettings() {
    return fetch('/settings')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        state.spDc = (s && s.sp_dc) || '';
        return state.spDc;
      })
      .catch(function () { return ''; });
  }

  function showGate() { el.gate.classList.add('open'); }
  function hideGate() { el.gate.classList.remove('open'); }

  function setExpandedView(expanded) {
    if (!state.mini) return;
    state.expanded = !!expanded;
    var root = document.documentElement;
    if (state.expanded) {
      root.classList.remove('mini-embed');
      document.body.classList.remove('mini-embed');
      el.embedPanel.style.display = 'block';
      if (state.lyrics && state.lyrics.lines && state.lyrics.lines.length) {
        renderLyrics();
        document.body.classList.add('lyrics-mode');
      }
      if (window.lucide) window.lucide.createIcons();
    } else {
      document.body.classList.remove('lyrics-mode');
      root.classList.add('mini-embed');
      el.lyricsOuter.style.display = 'none';
      el.embedPanel.style.display = 'block';
    }
  }

  function openPlayer(trackId) {
    if (!state.spDc) {
      showGate();
      return;
    }
    state.trackId = trackId;
    state.lyrics = null;
    state.activeLine = -1;
    state.playhead = 0;
    state.useMsg = false;
    state.lastMessageAt = 0;
    state.autoplayPending = false;
    state.autoplayDone = false;
    state.endedBound = false;
    state.queueAdvancePending = false;
    state.expanded = false;

    if (state.mini) {
      setExpandedView(false);
    } else {
      document.documentElement.classList.remove('mini-embed');
    }

    rememberPlayback();
    document.body.classList.remove('lyrics-mode');
    el.pvTitle.textContent = 'Memuat...';
    el.pvArtist.textContent = '';
    el.pvLoading.style.display = 'flex';
    el.embedPanel.style.display = 'none';
    el.lyricsOuter.style.display = 'none';

    el.spWidget.onload = function () {
      el.pvLoading.style.display = 'none';
      el.embedPanel.style.display = 'block';
      startMonitor();
    };

    el.spWidget.src = '/embed-proxy?trackId=' + encodeURIComponent(trackId) + '&bridge=2' + credQ();

    api('/track?trackId=' + encodeURIComponent(trackId) + credQ())
      .then(function (full) {
        if (full && (full.title || full.thumbnail)) renderNow(full);
      })
      .catch(function (e) {
        if (e.needsSpdc) showGate();
      });

    api('/lyrics?trackId=' + encodeURIComponent(trackId) + credQ())
      .then(function (l) {
        if (l && l.lines && l.lines.length) {
          state.lyrics = l;
          if (!state.mini || state.expanded) {
            renderLyrics();
            document.body.classList.add('lyrics-mode');
          }
        } else {
          finishEmbedOnly();
        }
      })
      .catch(function (e) {
        if (e.needsSpdc) showGate();
        finishEmbedOnly();
      });
  }

  function finishEmbedOnly() {
    state.lyrics = null;
    document.body.classList.remove('lyrics-mode');
    el.lyricsOuter.style.display = 'none';
  }

  function renderNow(t) {
    document.title = (t.title || 'Spotify') + ' - ' + (t.artist || '');
    el.pvTitle.textContent = t.title || '';
    el.pvArtist.textContent = t.artist || '';
    rememberPlayback(t);
  }

  function rememberPlayback(metadata) {
    try {
      var current = JSON.parse(localStorage.getItem('spotifyPlayback') || '{}');
      current.trackId = state.trackId;
      current.positionMs = Math.max(0, Math.round(state.playhead || current.positionMs || 0));
      current.playing = state.isPlaying;
      if (metadata) {
        current.title = metadata.title || '';
        current.artist = metadata.artist || '';
        current.thumbnail = metadata.thumbnail || '';
      }
      localStorage.setItem('spotifyPlayback', JSON.stringify(current));
      if (window.parent !== window && state.embedded) {
        window.parent.postMessage({ type: 'playback-state', playback: current }, location.origin);
      }
    } catch (e) {}
  }

  function playNextQueued() {
    if (state.queueAdvancePending) return true;
    try {
      var queue = JSON.parse(localStorage.getItem('spotifyQueue') || '[]');
      if (!queue.length) return false;
      state.queueAdvancePending = true;
      var next = queue.shift();
      localStorage.setItem('spotifyQueue', JSON.stringify(queue));
      var newUrl = '/player?trackId=' + encodeURIComponent(next.trackId) +
        (state.embedded ? '&embedded=1' : '') + (state.mini ? '&mini=1' : '');
      history.replaceState(state.embedded ? null : { playerPage: true }, '', newUrl);
      openPlayer(next.trackId);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readQueue() {
    try { return JSON.parse(localStorage.getItem('spotifyQueue') || '[]'); } catch (e) { return []; }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>\"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderQueue() {
    var list = document.getElementById('queueList');
    var empty = document.getElementById('queueEmpty');
    var count = document.getElementById('queueCount');
    if (!list || !empty || !count) return;
    var queue = readQueue();
    list.innerHTML = '';
    empty.hidden = queue.length > 0;
    count.textContent = queue.length;
    count.hidden = queue.length === 0;
    queue.forEach(function (item, index) {
      var row = document.createElement('div');
      row.className = 'queue-item';
      row.dataset.index = index;
      row.dataset.trackId = item.trackId || '';
      row.title = 'Putar sekarang';
      row.innerHTML = (item.thumbnail ? '<img class="queue-thumb" src="' + escapeHtml(item.thumbnail) + '" alt="">' : '<span class="queue-thumb queue-thumb-empty"><i data-lucide="music"></i></span>') +
        '<span class="queue-item-copy"><strong>' + escapeHtml(item.title || 'Unknown') + '</strong><small>' + escapeHtml(item.artist || '') + '</small></span>' +
        '<button class="queue-remove" data-index="' + index + '" title="Hapus dari antrean" aria-label="Hapus dari antrean"><i data-lucide="x"></i></button>';
      list.appendChild(row);
    });
    if (window.lucide) window.lucide.createIcons();
  }

  function goBack() {
    state.playhead = state.playhead || 0;
    var isPlaying = state.isPlaying;
    rememberPlayback();

    if (state.mini) {
      window.parent.postMessage({ type: 'collapse-mini-request' }, location.origin);
      return;
    }

    document.body.classList.remove('lyrics-mode');
    state.lyrics = null;
    if (state.embedded) {
      window.parent.postMessage({
        type: 'player-back',
        playback: {
          trackId: state.trackId,
          title: el.pvTitle.textContent || '',
          artist: el.pvArtist.textContent || '',
          positionMs: Math.max(0, Math.round(state.playhead || 0)),
          playing: isPlaying
        }
      }, location.origin);
      return;
    }
    location.replace('/');
  }

  function getEmbedDoc() {
    try { return el.spWidget.contentDocument || null; } catch (e) { return null; }
  }

  function renderLyrics() {
    if (!state.lyrics || !state.lyrics.lines) return;
    el.pvLyrics.innerHTML = '';
    state.lyrics.lines.forEach(function (ln) {
      var d = document.createElement('div');
      d.className = 'l-line' + (state.lyrics.hasSync ? '' : ' unsynced');
      d.textContent = ln.text || '\u00A0';
      if (state.lyrics.hasSync) d.addEventListener('click', function () { seekTo(ln.startMs); });
      el.pvLyrics.appendChild(d);
    });
    el.lyricsOuter.style.display = 'block';
    setTimeout(function () { updateActiveLine(state.playhead || 0); }, 40);
  }

  function seekTo(ms) {
    try {
      var payload = { type: 'seek-request', position: ms, trackId: state.trackId };
      el.spWidget.contentWindow.postMessage(payload, location.origin);
      state.playhead = ms;
      updateActiveLine(ms);
    } catch (e) {}
  }

  function updateActiveLine(pos) {
    if (!state.lyrics || !state.lyrics.hasSync) return;
    var lines = state.lyrics.lines;
    if (!lines || !lines.length) return;
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (pos >= lines[i].startMs && (i === lines.length - 1 || pos < lines[i + 1].startMs)) {
        idx = i;
        break;
      }
    }
    if (idx === state.activeLine) return;
    state.activeLine = idx;
    var els = el.pvLyrics.children;
    for (var j = 0; j < els.length; j++) {
      var on = j === idx;
      els[j].classList.toggle('active', on);
      els[j].classList.toggle('dim', !on);
    }
    if (idx >= 0) {
      var lineEl = els[idx];
      el.pvLyricsWrap.scrollTo({
        top: lineEl.offsetTop - el.pvLyricsWrap.clientHeight / 2 + lineEl.clientHeight / 2,
        behavior: 'smooth'
      });
    }
  }

  function startMonitor() {
    if (state.lyricTimer) clearInterval(state.lyricTimer);
    state.lyricTimer = setInterval(function () {
      if (state.lyrics) updateActiveLine(state.playhead);
      rememberPlayback();
    }, 250);
  }

  function stopMonitor() {
    if (state.lyricTimer) {
      clearInterval(state.lyricTimer);
      state.lyricTimer = null;
    }
  }

  el.btnBack.addEventListener('click', goBack);

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data) return;
    var d = e.data;
    var payload = d.payload || d.data || d;
    var position = payload && typeof payload.position === 'number' ? payload.position : null;

    if (d.type === 'playback_started') {
      state.isPlaying = true;
      state.playhead = 0;
      state.useMsg = true;
      state.lastMessageAt = Date.now();
      return;
    }

    if (d.type === 'playback_update' && position !== null) {
      state.playhead = position;
      state.isPlaying = payload.isPaused !== true;
      state.useMsg = true;
      state.lastMessageAt = Date.now();
      updateActiveLine(position);
    }
  });

  window.addEventListener('queue-ended-local', function (event) {
    var detail = event.detail || {};
    console.log('[PLAYER] queue-ended-local', detail);
    playNextQueued();
  });

  window.addEventListener('pagehide', function () {
    rememberPlayback();
    stopMonitor();
  });

  el.gateBack.addEventListener('click', function () { location.href = '/'; });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') goBack();
  });

  var trackId = params.get('trackId');

  if (!state.embedded && !state.mini) {
    history.pushState({ playerPage: true }, '', location.href);
    window.addEventListener('popstate', function () { location.replace('/'); });
  }

  if (!trackId) {
    location.href = '/';
    return;
  }

  document.title = 'Loading...';
  if (window.lucide) window.lucide.createIcons();

  loadSettings().then(function () {
    if (!state.spDc) {
      showGate();
      el.pvLoading.style.display = 'none';
      el.pvTitle.textContent = 'sp_dc tidak ditemukan';
      el.pvArtist.textContent = 'Atur sp_dc di halaman pencarian';
    } else {
      renderQueue();
      openPlayer(trackId);
    }
  });
})();
