(function () {
  var params = new URLSearchParams(location.search);

  var state = {
    spDc: '',
    trackId: '',
    trackDuration: 0,
    lyrics: null,
    lyricTimer: null,
    activeLine: -1,
    playhead: 0,
    useMsg: false,
    lastMessageAt: 0,
    embedMsg: false,
    isPlaying: false,
    // Embed sudah melapor { type: 'ready' }.
    embedReady: false,
    // trackId dari antrean yang sedang dicoba; dihapus dari antrean hanya
    // setelah pemutarannya benar-benar berjalan.
    queueAdvancePending: false,
    autoAdvancing: false,
    loadSeq: 0,
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
    gateLogin: document.getElementById('gateLogin'),
    gateSpdc: document.getElementById('gateSpdc'),
    toast: document.getElementById('toast')
  };

  var SPDC_KEY = 'spotifySpdc';

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    if (!match) return '';
    var value = match[1];
    if (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.slice(1, -1);
    }
    try { return decodeURIComponent(value); } catch (e) { return value; }
  }

  function readStoredSpdc() {
    var dc = getCookie('sp_dc');
    if (dc && dc.length >= 20) return dc;
    try {
      dc = localStorage.getItem(SPDC_KEY) || '';
      // Normalkan nilai lama yang tersimpan sebagai JSON (metode versi dulu):
      // JSON.stringify merusak nilai cookie, pulihkan ke bentuk string mentah.
      if (dc && dc.charAt(0) === '"') {
        try {
          var parsed = JSON.parse(dc);
          if (typeof parsed === 'string') {
            dc = parsed;
            localStorage.setItem(SPDC_KEY, dc);
          } else {
            dc = '';
          }
        } catch (e2) { dc = ''; }
      }
    } catch (e) { dc = ''; }
    return dc && dc.length >= 20 ? dc : '';
  }

  function saveStoredSpdc(dc) {
    var expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie =
      'sp_dc=' + encodeURIComponent(dc) +
      '; expires=' + expires +
      '; path=/' +
      '; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
    try { localStorage.setItem(SPDC_KEY, dc); } catch (e) {}
  }

  function clearStoredSpdc() {
    document.cookie = 'sp_dc=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax';
    try { localStorage.removeItem(SPDC_KEY); } catch (e) {}
  }

  function credQ() {
    var dc = readStoredSpdc();
    return dc ? ('&sp_dc=' + encodeURIComponent(dc)) : '';
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

  // Mini player memakai iframe: di iOS/Safari elemen media di dalam kotak
  // display:none tidak bisa berjalan, jadi panel embed TIDAK PERNAH disembunyikan
  // pada mode mini (player.html sudah memaksa display:block !important).
  function setPanelVisible(visible) {
    if (!el.embedPanel) return;
    el.embedPanel.style.display = visible ? 'block' : 'none';
  }

  function loadSettings() {
    state.spDc = readStoredSpdc();
    return Promise.resolve(state.spDc);
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
      setPanelVisible(true);
      if (state.lyrics && state.lyrics.lines && state.lyrics.lines.length) {
        renderLyrics();
        document.body.classList.add('lyrics-mode');
      }
      if (window.lucide) window.lucide.createIcons();
    } else {
      document.body.classList.remove('lyrics-mode');
      root.classList.add('mini-embed');
      el.lyricsOuter.style.display = 'none';
      setPanelVisible(true);
    }
  }

  function openPlayer(trackId) {
    if (!state.spDc) {
      showGate();
      return;
    }
    // Di mini player yang sedang diperluas (lyrics penuh), pertahankan mode
    // tampilannya saat pindah lagu (auto-advance) agar lirik tidak menutup.
    var wasExpanded = state.mini && state.expanded;
    state.trackId = trackId;
    var loadSeq = ++state.loadSeq;
    state.trackDuration = 0;
    state.lyrics = null;
    state.activeLine = -1;
    state.playhead = 0;
    state.useMsg = false;
    state.lastMessageAt = 0;
    state.embedMsg = false;
    state.queueAdvancePending = false;
    state.autoAdvancing = false;
    state.expanded = false;
    state.embedMsg = false;
    state.embedReady = false;
    // Lagu baru belum berjalan apa pun. Ini juga yang membuat auto-advance
    // tetap bisa mengklik tombol play: tanpa reset ini, isPlaying masih true
    // dari lagu sebelumnya dan klik otomatis ikut ditolak.
    state.isPlaying = false;

    if (state.mini) {
      setExpandedView(wasExpanded);
    } else {
      document.documentElement.classList.remove('mini-embed');
    }

    rememberPlayback();
    document.body.classList.remove('lyrics-mode');
    el.pvTitle.textContent = 'Memuat...';
    el.pvArtist.textContent = '';
    el.pvLoading.style.display = 'flex';
    setPanelVisible(false);
    el.lyricsOuter.style.display = 'none';

    el.spWidget.onload = function () {
      if (loadSeq !== state.loadSeq) return;
      el.pvLoading.style.display = 'none';
      setPanelVisible(true);
      autoplay();
      attachEmbedGestureListeners();
      startMonitor();
      verifyEmbed();
    };

    el.spWidget.src = '/embed-proxy?trackId=' + encodeURIComponent(trackId) + credQ();

    api('/track?trackId=' + encodeURIComponent(trackId) + credQ())
      .then(function (full) {
        if (loadSeq !== state.loadSeq) return;
        if (full && (full.title || full.thumbnail)) renderNow(full);
      })
      .catch(function (e) {
        if (loadSeq !== state.loadSeq) return;
        if (e.needsSpdc) showGate();
      });

    api('/lyrics?trackId=' + encodeURIComponent(trackId) + credQ())
      .then(function (l) {
        if (loadSeq !== state.loadSeq) return;
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
        if (loadSeq !== state.loadSeq) return;
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
    if (t.durationMs) state.trackDuration = t.durationMs;
    rememberPlayback(t, true);
  }

  function rememberPlayback(metadata, force) {
    try {
      var current = JSON.parse(localStorage.getItem('spotifyPlayback') || '{}');
      current.trackId = state.trackId;
      current.positionMs = Math.max(0, Math.round(state.playhead || current.positionMs || 0));
      current.playing = state.isPlaying;
      current.lastActiveAt = Date.now();
      if (metadata) {
        current.title = metadata.title || '';
        current.artist = metadata.artist || '';
        current.thumbnail = metadata.thumbnail || '';
      }
      // iOS Safari sangat sensitif terhadap postMessage yang berulang; kirim
      // status ke parent hanya saat berubah atau paling sering 1x/detik.
      var sig = current.trackId + '|' + current.playing + '|' + (current.title || '');
      var nowTs = Date.now();
      if (!force && sig === state.postSig && nowTs - (state.postAt || 0) < 1000) return;
      state.postSig = sig;
      state.postAt = nowTs;
      localStorage.setItem('spotifyPlayback', JSON.stringify(current));
      if (window.parent !== window && state.embedded) {
        // 'view' dipakai parent untuk memastikan keduanya sepakat soal tampilan
        // (mini kecil vs layar lirik penuh). Tanpa ini, view lirik bisa
        // tertinggal di dalam mini player kalau statusnya tidak sinkron.
        window.parent.postMessage({
          type: 'playback-state',
          playback: current,
          view: state.mini ? (state.expanded ? 'lyrics' : 'mini') : 'full',
          // Parent memakai ini untuk menentukan apakah tombol mikrofon
          // (floating) perlu ditampilkan: hanya untuk lagu yang liriknya
          // tersedia DAN sudah tersinkron dengan timestamp.
          hasLyrics: !!(state.lyrics && state.lyrics.lines && state.lyrics.lines.length),
          hasSyncedLyrics: !!(state.lyrics && state.lyrics.hasSync &&
            state.lyrics.lines && state.lyrics.lines.length)
        }, location.origin);
      }
    } catch (e) {}
  }

  // Lagu berikutnya: item diambil dari antrean, lalu langsung diputar.
  function playNextQueued() {
    if (state.queueAdvancePending) return true;
    var queue = window.SpotifyQueue ? window.SpotifyQueue.get() : [];
    if (!queue.length) {
      state.autoAdvancing = false;
      return false;
    }
    state.queueAdvancePending = true;
    window.SpotifyQueue.shift()
      .then(function (res) {
        state.queueAdvancePending = false;
        var next = res && res.shifted;
        if (!next || !next.trackId) {
          state.autoAdvancing = false;
          toast('Antrean habis');
          return;
        }
        var newUrl = '/player?trackId=' + encodeURIComponent(next.trackId) +
          (state.embedded ? '&embedded=1' : '') + (state.mini ? '&mini=1' : '');
        history.replaceState(state.embedded ? null : { playerPage: true }, '', newUrl);
        openPlayer(next.trackId);
      })
      .catch(function () {
        state.queueAdvancePending = false;
        state.autoAdvancing = false;
      });
    return true;
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
    var queue = window.SpotifyQueue ? window.SpotifyQueue.get() : [];
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

  // ---------- Autoplay tanpa timer ----------
  // Aturan iOS/Safari: media hanya boleh autoplay kalau dokumen ini sudah
  // pernah "dibuka" oleh user gesture. Begitu satu pemutaran berjalan, semua
  // pemutaran berikutnya di dokumen yang sama (dan iframe same-origin)
  // otomatis diizinkan. Jadi solusinya bukan mengulang-ulang play() dengan
  // setTimeout, tapi MEMBUKA izin itu sekali, sinkron, di dalam gesture asli
  // pengguna. Setelah itu cukup satu panggilan play() dan selesai.
  //
  // WAV senyap 1/10 detik (8 kHz, 800 sample) yang dipakai hanya sebagai
  // "kunci" izin. Tidak ada timer, tidak ada polling, tidak ada klik sintetis
  // berulang.
  var SILENT_WAV = 'data:audio/wav;base64,UklGRqQHAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

  // Setiap dokumen hanya perlu dibuka izinnya satu kali. Daftar ini mengingat
  // dokumen mana yang sudah dibuka (dokumen embed dibuat ulang tiap ganti lagu).
  var primedDocs = [];

  function primePlayback() {
    primeAudioIn(document);
    // Dokumen embed juga same-origin, jadi buka izinnya di sana juga.
    var doc = getEmbedDoc();
    if (doc) primeAudioIn(doc);
  }

  function primeAudioIn(doc) {
    if (!doc || primedDocs.indexOf(doc) !== -1) return;
    if (primedDocs.length > 8) primedDocs.shift();
    primedDocs.push(doc);
    var a = null;
    try {
      a = doc.createElement('audio');
      a.src = SILENT_WAV;
      a.preload = 'auto';
      // Senyap total: volume 0 + muted, tidak ada suara yang keluar.
      a.volume = 0;
      a.muted = true;
      if (doc.body) doc.body.appendChild(a);
      var p = a.play();
      if (p && typeof p.then === 'function') p.then(function () { resetPrime(a); }).catch(function () {});
      a.addEventListener('playing', function () { resetPrime(a); }, { once: true });
    } catch (e) {}
  }

  function resetPrime(a) {
    try {
      a.muted = true;
      a.volume = 0;
      a.pause();
      a.currentTime = 0;
    } catch (e) {}
  }

  // Pastikan iframe embed benar-benar termuat. Hanya melapor error kalau
  // dokumennya tidak bisa dijangkau sama sekali (mis. /embed-proxy mengembalikan
  // 502/504 sehingga isinya halaman error) — jangan sampai salah melapor kalau
  // Spotify hanya mengubah markup-nya.
  function verifyEmbed() {
    var seq = state.loadSeq;
    var checks = 0;
    (function poll() {
      if (seq !== state.loadSeq) return;
      var doc = getEmbedDoc();
      if (doc && doc.documentElement && doc.documentElement.children.length) return;
      if (++checks > 20) {
        reportEmbedError('Player Spotify tidak bisa dimuat. Coba putar lagi.');
        return;
      }
      setTimeout(poll, 500);
    })();
  }

  function reportEmbedError(message) {
    if (window.parent !== window && state.embedded) {
      try {
        window.parent.postMessage({ type: 'player-error', message: message }, location.origin);
      } catch (e) {}
    }
    if (el.pvTitle) {
      el.pvTitle.textContent = 'Gagal memuat player';
      el.pvArtist.textContent = message || '';
      toast(message || 'Gagal memuat player', 3200);
    }
  }

  // ---------- Kontrol playback lewat IFrame API resmi Spotify ----------
  // PENTING: halaman embed TIDAK punya elemen <audio>/<video> yang bisa
  // dijangkau. Pemutarannya berjalan di Web Player SDK, dan satu-satunya
  // antarmuka resminya adalah perintah postMessage:
  //   { command: 'play' | 'pause' | 'toggle' | 'seek', timestamp }
  // Embed membalas ke parent dengan { type: 'playback_started' } dan
  // { type: 'playback_update', payload: { isPaused, position, ... } }.
  // Karena itu JANGAN mencari-cari elemen media -kontrol itu memang tidak ada.
  function sendEmbedCommand(command, extra) {
    var win = null;
    try { win = el.spWidget && el.spWidget.contentWindow; } catch (e) { win = null; }
    if (!win) return false;
    try {
      var payload = { command: command };
      if (extra) {
        for (var key in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, key)) payload[key] = extra[key];
        }
      }
      win.postMessage(payload, '*');
      return true;
    } catch (e) {
      return false;
    }
  }

  // Autoplay: coba SEBAGAI kali saja per lagu - satu panggilan media.play() dan
  // satu klik tombol play. Tidak pernah mengulang aksi, supaya tidak terjadi
  // play-pause yang berkedip-kedip. Setelah itu tinggal pantau status sampai
  // benar-benar berjalan atau menyerah.
  var autoplayActive = false;
  var autoplaySeq = 0;
  var autoplayTimer = null;

  function requiresPlaybackGesture() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function autoplay() {
    if (requiresPlaybackGesture()) return;
    if (autoplayActive && autoplaySeq === state.loadSeq) return;
    if (autoplayTimer) {
      clearTimeout(autoplayTimer);
      autoplayTimer = null;
    }
    autoplayActive = true;
    autoplaySeq = state.loadSeq;
    var tries = 0;
    var playedOnce = false;
    var clickedOnce = false;
    (function tick() {
      if (!autoplayActive || autoplaySeq !== state.loadSeq) {
        autoplayActive = false;
        return;
      }
      var doc = getEmbedDoc();
      var media = doc && doc.querySelector('audio,video');
      if (media && !media.paused && !media.ended) {
        autoplayActive = false;
        state.isPlaying = true;
        return;
      }
      if (!playedOnce && media && media.readyState >= 2) {
        playedOnce = true;
        try {
          var pr = media.play();
          if (pr && typeof pr.catch === 'function') pr.catch(function () {});
        } catch (e) {}
      } else if (!clickedOnce) {
        var btn = doc && doc.querySelector('[data-testid="play-pause-button"]');
        if (btn && !btn.disabled) {
          clickedOnce = true;
          try { btn.click(); } catch (e) {}
        }
      }
      if (++tries < 100) {
        autoplayTimer = setTimeout(tick, 300);
      } else {
        autoplayActive = false;
      }
    })();
  }

  function notifyParent(payload) {
    if (!(window.parent !== window && state.embedded)) return;
    try { window.parent.postMessage(payload, location.origin); } catch (e) {}
  }

  function stopEmbedPlayback() {
    sendEmbedCommand('pause');
    state.isPlaying = false;
  }

  // Tap di area embed = user gesture asli. Buka izin media, lalu kirim
  // perintah resmi ke embed.
  function attachEmbedGestureListeners() {
    var doc = getEmbedDoc();
    if (!doc || doc.__gestureHooked) return;
    doc.__gestureHooked = true;
    function onGesture() {
      primePlayback();
      autoplay();
    }
    doc.addEventListener('touchend', onGesture, true);
    doc.addEventListener('click', onGesture, true);
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

  // Embed menerima perintah { command: 'seek', timestamp } dengan timestamp
  // dalam detik. Tidak ada elemen media untuk di-set currentTime-nya.
  function seekTo(ms) {
    if (!sendEmbedCommand('seek', { timestamp: Math.round(ms / 1000) })) return;
    state.playhead = ms;
    state.useMsg = false;
    updateActiveLine(ms);
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

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;

    // Pindah lagu tanpa memuat ulang dokumen /player. Memuat ulang iframe
    // sedang membunyikan audio adalah penyebab paling sering audio mati di
    // iOS, jadi dokumen ini sengaja dipakai ulang.
    if (d.type === 'set-track' && d.trackId && state.spDc) {
      if (d.trackId === state.trackId && !d.force) return;
      var url = '/player?trackId=' + encodeURIComponent(d.trackId) +
        (state.embedded ? '&embedded=1' : '') + (state.mini ? '&mini=1' : '');
      history.replaceState(state.embedded ? null : { playerPage: true }, '', url);
      openPlayer(d.trackId);
      return;
    }

    if (d.type === 'expand-lyrics-view' && state.mini) {
      setExpandedView(true);
      return;
    }

    if (d.type === 'collapse-mini-view' && state.mini) {
      setExpandedView(false);
      return;
    }

    if (d.type === 'gesture-play') {
      autoplay();
      return;
    }

    if (d.type === 'gesture-pause') {
      sendEmbedCommand('pause');
      state.isPlaying = false;
      rememberPlayback();
      return;
    }

    var payload = d.payload || d.data || d;
    var position = payload.position;
    if (typeof position !== 'number') position = payload.positionMs;
    if (typeof position !== 'number') position = d.ms;

    // Status pemutaran asli datang dari embed Spotify lewat message
    // (mis. {type:'playback_update', payload:{isPaused, position, ...}}).
    // Halaman embed tidak punya elemen audio/video yang bisa dijangkau, jadi
    // pesan ini adalah satu-satunya sumber kebenaran tentang pemutaran.
    //
    // { type: 'ready' } berarti embed siap menerima perintah IFrame API.
    // Inilah momen yang tepat mengirim 'play': tidak perlu menunggu, tidak
    // perlu mengulang, dan perintah ini sudah membawa user activation dari
    // ketukan kartu karena dikirim lewat postMessage di dalam task yang sama.
    if (d.type === 'ready') {
      state.embedReady = true;
    }

    var embedType = d.type === 'ready' || d.type === 'playback_update' ||
      d.type === 'playback_started' || d.type === 'playback_paused' ||
      d.type === 'playback_resumed' || d.type === 'playhead';
    if (embedType) state.embedMsg = true;
    if (d.type === 'playback_started' || d.type === 'playback_resumed') {
      state.isPlaying = true;
      state.autoAdvancing = false;
    }
    if (d.type === 'playback_paused') {
      state.isPlaying = false;
    }
    if (d.type === 'playback_update' || d.type === 'playback_resumed' || d.type === 'playback_paused') {
      if (typeof payload.isPaused === 'boolean') {
        state.isPlaying = !payload.isPaused;
      }
    }

    var posMsg = (d.type === 'playhead' || d.type === 'playback_update' ||
      d.type === 'playback_started') && typeof position === 'number';
    if (posMsg) {
      state.playhead = position;
      state.useMsg = true;
      state.lastMessageAt = Date.now();
    }

    // Auto-advance: when embed reports paused after having played,
    // and position is near end, treat as track finished.
    if ((d.type === 'playback_paused' || (d.type === 'playback_update' && payload.isPaused === true)) &&
        state.trackDuration > 0 && state.playhead > 0 &&
        !state.queueAdvancePending && !state.autoAdvancing) {
      var progress = state.playhead / state.trackDuration;
      if (progress >= 0.90) {
        state.autoAdvancing = true;
        state.isPlaying = false;
        rememberPlayback();
        playNextQueued();
        return;
      }
    }

    // Capture duration from embed messages when available
    var msgDur = payload.duration || payload.durationMs || payload.totalDuration;
    if (typeof msgDur === 'number' && msgDur > 0) {
      state.trackDuration = msgDur > 1000 ? msgDur : msgDur * 1000;
    }
  });

  function startMonitor() {
    stopMonitor();
    state.lyricTimer = setInterval(function () {
      rememberPlayback();
      attachEmbedGestureListeners();

      if (state.lyrics && !document.documentElement.classList.contains('mini-embed')) {
        updateActiveLine(state.playhead);
      }
    }, 400);
  }

  function stopMonitor() {
    if (state.lyricTimer) {
      clearInterval(state.lyricTimer);
      state.lyricTimer = null;
    }
  }

  el.btnBack.addEventListener('click', goBack);

  window.addEventListener('pagehide', function () {
    rememberPlayback();
  });

  // iOS sering menghentikan audio saat aplikasi dil_backgroundkan. Saat
  // halaman aktif lagi, lanjutkan pemutaran yang sebelumnya berjalan (dan
  // tampilkan tombol ketuk lagi kalau gesture tetap diperlukan).
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!state.trackId) return;
    // Cukup andalkan ikon tombol: kalau lagunya masih jalan, ikon sudah
    // "jeda" dan tidak ada yang diklik.
    autoplay();
  });

  // Dipanggil LANGSUNG (sinkron) dari dokumen parent, di dalam user gesture
  // milik pengguna. Panggilan lintas frame same-origin ikut membawa user
  // activation-nya, jadi izin media terbuka tepat saat kartunya ditekan.
  window.sptPrimeMedia = function () { primePlayback(); };

  window.sptGesturePlay = function () {
    primePlayback();
    if (!state.trackId) return;
    autoplay();
  };

  el.gateBack.addEventListener('click', function () { location.href = '/'; });

  if (el.gateLogin) {
    // Fallback klien: browser tertentu (Safari/iOS) menolak Set-Cookie dari
    // respons server di HTTP lokal, jadi simpan juga via document.cookie
    // dan mirror localStorage agar sp_dc selalu ada di setiap pemutaran.
    function submitSpdc() {
      var dc = el.gateSpdc.value.trim();
      if (dc.length < 20) {
        toast('sp_dc tidak valid (minimal 20 karakter)', 3200);
        return;
      }
      saveStoredSpdc(dc);
      el.gateLogin.disabled = true;
      fetch('/api/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sp_dc: dc })
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function () {
        state.spDc = dc;
        hideGate();
        renderQueue();
        openPlayer(trackId);
      }).catch(function () {
        toast('Gagal menyimpan sp_dc', 3200);
      }).then(function () {
        el.gateLogin.disabled = false;
      });
    }
    el.gateLogin.addEventListener('click', submitSpdc);
    if (el.gateSpdc) {
      el.gateSpdc.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitSpdc();
      });
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') goBack();
  });

  // Klik/tap di area embed adalah user gesture asli: buka izin media lalu
  // kirim perintah resmi ke embed, tanpa jeda sama sekali.
  function onEmbedGesture() {
    primePlayback();
    autoplay();
  }
  el.embedPanel.addEventListener('click', onEmbedGesture);
  el.embedPanel.addEventListener('touchend', onEmbedGesture, true);

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
          window.SpotifyQueue.remove(Number(remove.dataset.index)).catch(function () {
            toast('Antrean tidak tersedia');
          });
          return;
        }
        var row = e.target.closest('.queue-item');
        if (!row) return;
        var index = Number(row.dataset.index);
        var item = window.SpotifyQueue.get()[index];
        if (!item || !item.trackId) return;
        window.SpotifyQueue.remove(index).then(function () {
          queuePanel.hidden = true;
          openPlayer(item.trackId);
        }).catch(function () {
          toast('Antrean tidak tersedia');
        });
      });
      queueClear.addEventListener('click', function () {
        window.SpotifyQueue.clear().catch(function () {
          toast('Antrean tidak tersedia');
        });
      });
    }

  var trackId = params.get('trackId');

  if (!state.embedded && !state.mini) {
    history.pushState({ playerPage: true }, '', location.href);
    window.addEventListener('popstate', function () { location.replace('/'); });
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'player-stop') return;
    stopEmbedPlayback();
    localStorage.removeItem('spotifyPlayback');
  });

  if (!trackId) {
    location.href = '/';
    return;
  }

  document.title = 'Loading...';
  if (window.lucide) window.lucide.createIcons();

  if (window.SpotifyQueue) {
    window.SpotifyQueue.start();
    window.SpotifyQueue.subscribe(function () { renderQueue(); });
    window.SpotifyQueue.refresh();
  }

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