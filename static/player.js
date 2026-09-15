(function () {
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
    queueAdvancePending: false
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

  // ---------- SETTINGS ----------
  function loadSettings() {
    return fetch('/settings')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        state.spDc = (s && s.sp_dc) || '';
        return state.spDc;
      })
      .catch(function () {
        return '';
      });
  }

  function showGate() {
    el.gate.classList.add('open');
  }

  function hideGate() {
    el.gate.classList.remove('open');
  }

  // ---------- PLAYER ----------
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
      ensurePlaying(8);
      startMonitor();
    };
    el.spWidget.src = '/embed-proxy?trackId=' + encodeURIComponent(trackId) + credQ();

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
          renderLyrics();
          document.body.classList.add('lyrics-mode');
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
      if (window.parent !== window && new URLSearchParams(location.search).get('embedded') === '1') {
        window.parent.postMessage({ type: 'playback-state', playback: current }, location.origin);
      }
    } catch (e) { }
  }

  function playNextQueued() {
    if (state.queueAdvancePending) return true;
    try {
      var queue = JSON.parse(localStorage.getItem('spotifyQueue') || '[]');
      if (!queue.length) return false;
      state.queueAdvancePending = true;
      var next = queue.shift();
      localStorage.setItem('spotifyQueue', JSON.stringify(queue));
      var embedded = new URLSearchParams(location.search).get('embedded') === '1';
      // Ganti track di tempat (tanpa reload halaman penuh) agar browser tidak
      // kehilangan izin autoplay yang biasanya hanya berlaku selama page load yang sama.
      var newUrl = '/player?trackId=' + encodeURIComponent(next.trackId) + (embedded ? '&embedded=1' : '');
      history.replaceState(embedded ? null : { playerPage: true }, '', newUrl);
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
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
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
    samplePlayhead();
    var doc = getEmbedDoc();
    var media = doc && doc.querySelector('audio, video');
    var isPlaying = !!(media && !media.paused) || state.isPlaying;
    state.isPlaying = isPlaying;
    rememberPlayback();
    document.body.classList.remove('lyrics-mode');
    state.lyrics = null;
    if (new URLSearchParams(location.search).get('embedded') === '1') {
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

  // ---------- EMBED / AUTOPLAY ----------
  function getEmbedDoc() {
    try { return el.spWidget.contentDocument || null; } catch (e) { return null; }
  }

  function clickPlayButton(doc) {
    var sel = [
      'button[data-testid="play-pause-button"]',
      'button[data-testid="play-button"]',
      'button[aria-label="Play"]',
      'button[aria-label="Putar"]'
    ];
    for (var i = 0; i < sel.length; i++) {
      var b = doc.querySelector(sel[i]);
      if (b && !b.disabled) {
        var lb = (b.getAttribute('aria-label') || '').toLowerCase();
        if (lb.indexOf('pause') === -1 && lb.indexOf('jeda') === -1) {
          try { b.click(); } catch (e) { }
          return true;
        }
      }
    }
    return false;
  }

  function ensurePlaying(rounds) {
    if (state.autoplayDone || state.autoplayPending || rounds <= 0) return;
    var doc = getEmbedDoc();
    if (!doc) {
      setTimeout(function () { ensurePlaying(rounds - 1); }, 700);
      return;
    }
    var media = doc.querySelector('audio,video');
    if (media && !media.paused && media.currentTime > 0) {
      state.autoplayDone = true;
      return;
    }
    state.autoplayPending = true;
    if (media) {
      try {
        var playResult = media.play();
        if (playResult && typeof playResult.then === 'function') {
          playResult.then(function () {
            state.isPlaying = true;
            state.autoplayDone = true;
          }).catch(function () {
            state.autoplayPending = false;
          });
        } else {
          state.isPlaying = true;
          state.autoplayDone = true;
        }
      } catch (e) {
        state.autoplayPending = false;
      }
    } else {
      if (clickPlayButton(doc)) state.autoplayDone = true;
      else state.autoplayPending = false;
    }
    if (!state.autoplayDone) {
      setTimeout(function () {
        state.autoplayPending = false;
        ensurePlaying(rounds - 1);
      }, 700);
    }
  }

  // ---------- LYRICS ----------
  function renderLyrics() {
    el.pvLyrics.innerHTML = '';
    state.lyrics.lines.forEach(function (ln) {
      var d = document.createElement('div');
      d.className = 'l-line' + (state.lyrics.hasSync ? '' : ' unsynced');
      d.textContent = ln.text || '\u00A0';
      if (state.lyrics.hasSync) {
        d.addEventListener('click', function () {
          seekTo(ln.startMs);
        });
      }
      el.pvLyrics.appendChild(d);
    });
    el.lyricsOuter.style.display = 'block';
    setTimeout(function () { updateActiveLine(0); }, 80);
  }

  function seekTo(ms) {
    var doc = getEmbedDoc();
    if (!doc) return;
    try {
      var media = doc.querySelector('audio, video');
      if (!media) return;
      media.currentTime = ms / 1000;
      state.playhead = ms;
      state.useMsg = false;
      updateActiveLine(ms);
      if (media.paused) ensurePlaying(4);
    } catch (e) { }
  }

  function updateActiveLine(pos) {
    if (!state.lyrics.hasSync) return;
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
    for (var i = 0; i < els.length; i++) {
      var on = i === idx;
      els[i].classList.toggle('active', on);
      els[i].classList.toggle('dim', on === false);
    }
    if (idx >= 0) {
      var lineEl = els[idx];
      el.pvLyricsWrap.scrollTo({
        top: lineEl.offsetTop - el.pvLyricsWrap.clientHeight / 2 + lineEl.clientHeight / 2,
        behavior: 'smooth'
      });
    }
  }

  function samplePlayhead() {
    var doc = getEmbedDoc();
    if (!doc) return;
    var medias;
    try { medias = doc.querySelectorAll('audio, video'); } catch (e) { medias = []; }
    var best = null;
    var fallback = null;
    for (var i = 0; i < medias.length; i++) {
      var m = medias[i];
      if (!m) continue;
      if (!fallback) fallback = m;
      if (!m.paused) {
        best = m;
        break;
      }
    }
    if (!best) best = fallback;
    if (!best) {
      state.isPlaying = false;
      return false;
    }
    state.isPlaying = !best.paused;
    if (!state.useMsg || Date.now() - state.lastMessageAt > 1000) {
      state.playhead = (best.currentTime || 0) * 1000;
      state.useMsg = false;
    }
    return state.isPlaying;
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    var payload = d.payload || d.data || d;
    var position = payload.position;
    if (typeof position !== 'number') position = payload.positionMs;
    if (typeof position !== 'number') position = d.ms;
    if (d.type === 'playback_started') {
      state.isPlaying = true;
    }
    if ((d.type === 'playhead' || d.type === 'playback_update' ||
      d.type === 'playback_started') && typeof position === 'number') {
      state.playhead = position;
      state.useMsg = true;
      state.lastMessageAt = Date.now();
    }
  });

  function startMonitor() {
    stopMonitor();
    state.lyricTimer = setInterval(function () {
      var doc = getEmbedDoc();
      if (doc && !state.endedBound) {
        var media = doc.querySelector('audio, video');
        if (media) {
          state.endedBound = true;
          media.addEventListener('ended', function () {
            state.isPlaying = false;
            rememberPlayback();
            playNextQueued();
          });
        }
      }
      if (state.lyrics) {
        state.isPlaying = samplePlayhead();
        if (!state.isPlaying && !state.useMsg) return;
        updateActiveLine(state.playhead);
      } else {
        state.isPlaying = samplePlayhead();
      }
      rememberPlayback();
    }, 200);
  }

  function stopMonitor() {
    if (state.lyricTimer) {
      clearInterval(state.lyricTimer);
      state.lyricTimer = null;
    }
  }

  // ---------- EVENTS ----------
  el.btnBack.addEventListener('click', goBack);

  window.addEventListener('pagehide', function () {
    samplePlayhead();
    rememberPlayback();
  });

  el.gateBack.addEventListener('click', function () {
    location.href = '/';
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      goBack();
    }
  });

  el.embedPanel.addEventListener('click', function () {
    state.autoplayPending = false;
    state.autoplayDone = false;
    ensurePlaying(4);
  });

  var queueBtn = document.getElementById('queueBtn');
  var queuePanel = document.getElementById('queuePanel');
  var queueList = document.getElementById('queueList');
  var queueClear = document.getElementById('queueClear');
  if (queueBtn && queuePanel && queueList && queueClear) {
    queueBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      queuePanel.hidden = !queuePanel.hidden;
      if (!queuePanel.hidden) renderQueue();
    });
    queueList.addEventListener('click', function (e) {
      var remove = e.target.closest('.queue-remove');
      if (remove) {
        e.stopPropagation();
        var queue = readQueue();
        queue.splice(Number(remove.dataset.index), 1);
        localStorage.setItem('spotifyQueue', JSON.stringify(queue));
        renderQueue();
        return;
      }
      var row = e.target.closest('.queue-item');
      if (!row) return;
      var index = Number(row.dataset.index);
      var queue = readQueue();
      var item = queue[index];
      if (!item || !item.trackId) return;
      // Lagu yang diputar langsung dari antrean harus hilang dari antrean.
      queue.splice(index, 1);
      localStorage.setItem('spotifyQueue', JSON.stringify(queue));
      queuePanel.hidden = true;
      openPlayer(item.trackId);
    });
    queueClear.addEventListener('click', function () {
      localStorage.removeItem('spotifyQueue');
      renderQueue();
    });
  }

  // ---------- INIT ----------
  var params = new URLSearchParams(location.search);
  var trackId = params.get('trackId');
  var embedded = params.get('embedded') === '1';

  if (!embedded) {
    history.pushState({ playerPage: true }, '', location.href);
    window.addEventListener('popstate', function () {
      location.replace('/');
    });
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'player-stop') return;
    var doc = getEmbedDoc();
    var media = doc && doc.querySelector('audio, video');
    if (media) media.pause();
    state.isPlaying = false;
    localStorage.removeItem('spotifyPlayback');
  });

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