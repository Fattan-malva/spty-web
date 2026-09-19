(function () {
  'use strict';

  var state = {
    spDc: '',
    query: '',
    page: 1,
    limit: 20,
    hasNext: false,
    loading: false,
    requestId: 0,
    suggestionTimer: null,
    suggestionRequestId: 0,
    sessionTimer: null,
    playlists: [],
    liked: { total: 0, items: [] },
    currentPlaylist: null
  };

  var el = {
    searchInput: document.getElementById('searchInput'),
    btnSearch: document.getElementById('btnSearch'),
    searchbar: document.querySelector('.searchbar'),
    suggestions: document.getElementById('suggestions'),
    searchTitle: document.getElementById('searchTitle'),
    searchHint: document.getElementById('searchHint'),
    searchSkeleton: document.getElementById('searchSkeleton'),
    searchTopResult: document.getElementById('searchTopResult'),
    searchSongList: document.getElementById('searchSongList'),
    searchSentinel: document.getElementById('searchSentinel'),
    viewHome: document.getElementById('viewHome'),
    viewSearch: document.getElementById('viewSearch'),
    viewPlaylist: document.getElementById('viewPlaylist'),
    main: document.querySelector('.main-content'),
    homeBtn: document.getElementById('homeBtn'),
    homeSubtitle: document.getElementById('homeSubtitle'),
    playlistGrid: document.getElementById('playlistGrid'),
    libraryList: document.getElementById('libraryList'),
    libraryEmpty: document.getElementById('libraryEmpty'),
    libraryLogin: document.getElementById('libraryLogin'),
    libraryReload: document.getElementById('libraryReload'),
    plCover: document.getElementById('plCover'),
    plType: document.getElementById('plType'),
    plTitle: document.getElementById('plTitle'),
    plDesc: document.getElementById('plDesc'),
    plMeta: document.getElementById('plMeta'),
    plPlayAll: document.getElementById('plPlayAll'),
    plEnqueueAll: document.getElementById('plEnqueueAll'),
    plTracks: document.getElementById('plTracks'),
    nowCover: document.getElementById('nowCover'),
    nowTitle: document.getElementById('nowTitle'),
    nowSongTitle: document.getElementById('nowSongTitle'),
    nowArtist: document.getElementById('nowArtist'),
    queueList: document.getElementById('queueList'),
    queueEmpty: document.getElementById('queueEmpty'),
    queueClear: document.getElementById('queueClear'),
    queueCount: document.getElementById('queueCount'),
    banner: document.getElementById('spdcBanner'),
    bannerLogin: document.getElementById('bannerLogin'),
    loginBtn: document.getElementById('loginBtn'),
    loggedUser: document.getElementById('loggedUser'),
    loginModal: document.getElementById('loginModal'),
    loginFrame: document.getElementById('loginFrame'),
    loginClose: document.getElementById('loginClose'),
    toast: document.getElementById('toast')
  };

  // ---------- HELPERS ----------
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    if (!match) return '';
    var value = match[1];
    try { return decodeURIComponent(value); } catch (e) { return value; }
  }

  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(el.toast._t);
    el.toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, ms || 2200);
  }

  function refreshIcons() {
    try { if (window.lucide) window.lucide.createIcons(); } catch (e) {}
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showView(name) {
    el.viewHome.classList.toggle('active', name === 'home');
    el.viewSearch.classList.toggle('active', name === 'search');
    el.viewPlaylist.classList.toggle('active', name === 'playlist');
    el.main.scrollTop = 0;
  }

  function spdcQuery() {
    var dc = getCookie('sp_dc');
    return dc ? '?sp_dc=' + encodeURIComponent(dc) : '';
  }

  // ---------- QUEUE ----------
  function renderQueue() {
    var queue = window.SpotifyQueue ? window.SpotifyQueue.get() : [];
    el.queueList.innerHTML = '';
    el.queueEmpty.hidden = queue.length > 0;
    el.queueCount.textContent = queue.length;
    el.queueCount.hidden = queue.length === 0;
    queue.forEach(function (item, index) {
      var row = document.createElement('div');
      row.className = 'queue-item';
      row.dataset.index = index;
      row.dataset.trackId = item.trackId || '';
      row.title = 'Putar sekarang';
      row.innerHTML =
        (item.thumbnail
          ? '<img class="queue-thumb" src="' + escapeHtml(item.thumbnail) + '" alt="">'
          : '<span class="queue-thumb queue-thumb-empty"><i data-lucide="music"></i></span>') +
        '<span class="queue-item-copy"><strong>' + escapeHtml(item.title || 'Unknown') +
        '</strong><small>' + escapeHtml(item.artist || '') + '</small></span>' +
        '<button class="queue-remove" data-index="' + index + '" title="Hapus dari antrean" aria-label="Hapus dari antrean"><i data-lucide="x"></i></button>';
      el.queueList.appendChild(row);
    });
    refreshIcons();
  }

  function addItemsToQueue(items) {
    if (!items || !items.length) return Promise.resolve(0);
    var queue = window.SpotifyQueue;
    if (!queue) {
      toast('Antrean tidak tersedia');
      return Promise.reject();
    }
    return queue.addMany(items)
      .then(function (res) {
        var added = (res && res.added) || items.length;
        toast(added + ' lagu ditambahkan ke antrean');
        return added;
      })
      .catch(function () {
        toast('Gagal menambahkan ke antrean');
        return Promise.reject();
      });
  }

  // ---------- AUTH ----------
  function loadSettings() {
    var spDc = getCookie('sp_dc');
    state.spDc = spDc;
    syncSpdcUI();
    return Promise.resolve();
  }

  function syncSpdcUI() {
    var logged = !!(state.spDc && state.spDc.length >= 20);
    if (el.loginBtn) el.loginBtn.hidden = logged;
    if (el.loggedUser) el.loggedUser.hidden = !logged;
    if (el.banner) el.banner.classList.toggle('show', !logged);
    if (el.libraryEmpty) el.libraryEmpty.hidden = logged;
    if (el.homeSubtitle) el.homeSubtitle.textContent = logged ? 'Perpustakaan kamu' : 'Masuk untuk memuat perpustakaan';
  }

  function openLoginModal() {
    el.loginFrame.src = '/auth/login?t=' + Date.now();
    el.loginModal.hidden = false;
    document.body.classList.add('modal-open');
    startSessionPolling();
  }

  function closeLoginModal() {
    el.loginModal.hidden = true;
    document.body.classList.remove('modal-open');
    stopSessionPolling();
  }

  function startSessionPolling() {
    stopSessionPolling();
    state.sessionTimer = setInterval(function () {
      fetch('/api/session', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.loggedIn) onLoggedIn();
        })
        .catch(function () {});
    }, 1200);
  }

  function stopSessionPolling() {
    if (state.sessionTimer) {
      clearInterval(state.sessionTimer);
      state.sessionTimer = null;
    }
  }

  function onLoggedIn() {
    var dc = getCookie('sp_dc');
    if (!dc || dc.length < 20) return;
    state.spDc = dc;
    syncSpdcUI();
    closeLoginModal();
    toast('Login berhasil. sp_dc tersimpan di cookie.');
    loadLibrary();
  }

  function logoutSpdc() {
    if (!window.confirm('Logout dari akun Spotify ini?')) return;
    fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' })
      .then(function () {
        state.spDc = '';
        syncSpdcUI();
        showView('home');
        toast('sp_dc dihapus');
        loadLibrary();
      })
      .catch(function () { toast('Gagal logout'); });
  }

  // ---------- LIBRARY ----------
  function renderPlaylistGrid() {
    var liked = state.liked;
    var playlists = state.playlists;

    el.playlistGrid.innerHTML = '';

    var likedCard = document.createElement('div');
    likedCard.className = 'pl-card liked';
    likedCard.dataset.type = 'liked';
    likedCard.title = 'Buka Lagu yang Disukai';
    likedCard.innerHTML =
      '<div class="pl-cover"><i class="fas fa-heart text-2xl"></i></div>' +
      '<div class="pl-name">Lagu yang Disukai</div>' +
      '<div class="pl-meta">' + (liked.total) + ' lagu</div>';
    el.playlistGrid.appendChild(likedCard);

    if (!playlists.length) return;

    playlists.forEach(function (pl) {
      var card = document.createElement('div');
      card.className = 'pl-card';
      card.dataset.type = 'playlist';
      card.dataset.id = pl.id || '';
      card.title = 'Buka playlist';
      var img = (pl.images && pl.images.length && pl.images[0].url)
        ? '<img loading="lazy" src="' + escapeHtml(pl.images[0].url) + '" alt="">'
        : '<i class="fas fa-list-ul text-2xl"></i>';
      card.innerHTML =
        '<div class="pl-cover">' + img + '</div>' +
        '<div class="pl-name">' + escapeHtml(pl.name || 'Unknown') + '</div>' +
        '<div class="pl-meta">' + (pl.trackCount || 0) + ' lagu</div>';
      el.playlistGrid.appendChild(card);
    });
  }

  function renderLibraryList() {
    el.libraryList.innerHTML = '';

    var likedItem = document.createElement('button');
    likedItem.type = 'button';
    likedItem.className = 'lib-item liked';
    likedItem.dataset.type = 'liked';
    likedItem.innerHTML =
      '<div class="lib-cover"><i class="fas fa-heart"></i></div>' +
      '<div class="lib-item-copy"><strong>Lagu yang Disukai</strong><small>' + (state.liked.total || 0) + ' lagu</small></div>';
    el.libraryList.appendChild(likedItem);

    state.playlists.forEach(function (pl) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'lib-item';
      item.dataset.type = 'playlist';
      item.dataset.id = pl.id || '';
      item.innerHTML =
        '<div class="lib-cover">' +
        (pl.images && pl.images.length && pl.images[0].url
          ? '<img loading="lazy" src="' + escapeHtml(pl.images[0].url) + '" alt="">'
          : '<i class="fas fa-list-ul"></i>') +
        '</div>' +
        '<div class="lib-item-copy"><strong>' + escapeHtml(pl.name || 'Unknown') +
        '</strong><small>Playlist</small></div>';
      el.libraryList.appendChild(item);
    });

    el.libraryEmpty.hidden = !!state.spDc;
  }

  function showLibraryError(msg) {
    el.libraryEmpty.hidden = false;
    el.homeSubtitle.textContent = msg || 'Perpustakaan gagal dimuat';
    el.playlistGrid.innerHTML =
      '<p class="text-spotify-light col-span-full text-sm">' + msg + '</p>';
  }

  function loadLibrary() {
    if (!state.spDc) {
      renderPlaylistGrid();
      renderLibraryList();
      return;
    }
    el.playlistGrid.innerHTML =
      '<div class="pl-card pl-skeleton"><div class="skeleton-block sk-cover"></div><div class="skeleton-block h-4 w-3/4"></div></div>' +
      '<div class="pl-card pl-skeleton"><div class="skeleton-block sk-cover"></div><div class="skeleton-block h-4 w-3/4"></div></div>' +
      '<div class="pl-card pl-skeleton"><div class="skeleton-block sk-cover"></div><div class="skeleton-block h-4 w-3/4"></div></div>';
    Promise.all([
      fetch('/playlists' + spdcQuery()),
      fetch('/liked' + spdcQuery())
    ]).then(function (responses) {
      var checks = responses.map(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var ct = (r.headers.get('content-type') || '');
        if (ct.indexOf('application/json') === -1) throw new Error('Bukan JSON (sp_dc tidak valid?)');
        return r.json();
      });
      return Promise.all(checks);
    }).then(function (data) {
      state.playlists = (data[0] && data[0].items) || [];
      state.liked = data[1] || { total: 0, items: [] };
      renderPlaylistGrid();
      renderLibraryList();
    }).catch(function (e) {
      showLibraryError(e && e.message && e.message.indexOf('JSON') !== -1
        ? 'sp_dc tidak valid. Cek pengaturan.'
        : 'Perpustakaan gagal dimuat. Coba lagi.');
      renderLibraryList();
    });
  }

  // ---------- PLAYLIST VIEW ----------
  function trackItem(t) {
    return {
      trackId: t.trackId || t.id || '',
      title: t.title || t.name || 'Unknown',
      artist: t.artist || (t.artists && t.artists.map(function (a) { return a.name; }).join(', ')) || '',
      thumbnail: t.thumbnail || ((t.album && t.album.images && t.album.images[0]) ? t.album.images[0].url : '')
    };
  }

  function openPlaylistView(type, id, name, opt) {
    opt = opt || {};
    state.currentPlaylist = { type: type, id: id, name: name, meta: opt.meta || '', tracks: [] };
    var coverWrap = el.plCover;

    el.plType.textContent = type === 'liked' ? 'Playlist' : 'Playlist';
    el.plTitle.textContent = name || (type === 'liked' ? 'Lagu yang Disukai' : '');
    el.plDesc.textContent = opt.desc || '';
    el.plMeta.textContent = opt.meta || '';
    el.plTracks.innerHTML = '';

    if (type === 'liked') {
      coverWrap.className = 'pl-view-cover liked';
      coverWrap.innerHTML = '<i class="fas fa-heart text-5xl"></i>';
    } else {
      coverWrap.className = 'pl-view-cover';
      coverWrap.innerHTML = '<i class="fas fa-music text-4xl"></i>';
    }

    showView('playlist');

    var url = type === 'liked'
      ? '/liked'
      : '/playlist/' + encodeURIComponent(id) + '/tracks';
    if (type === 'liked') el.plType.textContent = 'Playlist';

    fetch(url + spdcQuery())
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var ct = (r.headers.get('content-type') || '');
        if (ct.indexOf('application/json') === -1) throw new Error('Not JSON');
        return r.json();
      })
      .then(function (data) {
        var items = (data && data.items) || [];
        var tracks = items.map(trackItem).filter(function (t) { return t.trackId; });
        state.currentPlaylist.tracks = tracks;
        el.plDesc.textContent = opt.desc || '';
        el.plMeta.textContent = (data.total || tracks.length) + ' lagu';
        el.plTracks.innerHTML = '';
        tracks.forEach(function (t) {
          el.plTracks.appendChild(card(t, false));
        });
        refreshIcons();
      })
      .catch(function () {
        el.plTracks.innerHTML =
          '<p class="text-spotify-light text-sm py-8 text-center">Gagal memuat lagu playlist.</p>';
      });
  }

  function playFirstAndEnqueueRest(tracks) {
    if (!tracks.length) return;
    var first = tracks[0];
    var rest = tracks.slice(1);
    var c = document.querySelector('.card[data-id="' + first.trackId + '"]');
    if (c && c.click) c.click();
    if (rest.length) addItemsToQueue(rest);
  }

  // ---------- SEARCH ----------
  function doSearch() {
    var q = el.searchInput.value.trim();
    if (!q) return;
    state.query = q;
    state.page = 1;
    state.hasNext = false;
    state.requestId += 1;
    closeSuggestions();
    showView('search');
    el.searchTitle.textContent = 'Hasil untuk "' + q + '"';
    el.searchHint.hidden = true;
    el.searchTopResult.innerHTML = '';
    el.searchSongList.innerHTML = '';
    el.searchSkeleton.hidden = false;
    fetchSearch();
  }

  function fetchSearch() {
    if (state.loading) return;
    state.loading = true;
    var requestId = state.requestId;
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, 20000);
    if (state.page === 1) el.searchSkeleton.hidden = false;

    fetch('/search?q=' + encodeURIComponent(state.query) +
      '&page=' + state.page + '&limit=' + state.limit, { signal: controller.signal })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (res) {
        if (requestId !== state.requestId) return;
        var items = res.data || [];
        if (state.page === 1) {
          if (!items.length) {
            el.searchHint.innerHTML = '<p class="py-10">Tidak ada hasil untuk "' + escapeHtml(state.query) + '"</p>';
            el.searchHint.hidden = false;
            el.searchSkeleton.hidden = true;
            return;
          }
          el.searchHint.hidden = true;
          el.searchTopResult.appendChild(card(items[0], true));
          items.slice(1).forEach(function (t) { el.searchSongList.appendChild(card(t, false)); });
        } else {
          items.forEach(function (t) { el.searchSongList.appendChild(card(t, false)); });
        }
        state.hasNext = !!res.hasNext;
        state.page += 1;
        refreshIcons();
        el.searchSkeleton.hidden = true;
      })
      .catch(function (e) {
        if (requestId !== state.requestId) return;
        var message = e.name === 'AbortError'
          ? 'Pencarian terlalu lama. Coba lagi.'
          : 'Pencarian gagal. Coba lagi.';
        el.searchSkeleton.hidden = true;
        el.searchHint.innerHTML = '<p class="py-10">' + message + '</p>';
        el.searchHint.hidden = false;
        toast(message, 2600);
      })
      .then(function () {
        clearTimeout(timeoutId);
        if (requestId !== state.requestId) return;
        state.loading = false;
      });
  }

  function closeSuggestions() {
    el.suggestions.hidden = true;
    el.suggestions.innerHTML = '';
  }

  function fetchSuggestions(query) {
    var requestId = ++state.suggestionRequestId;
    clearTimeout(state.suggestionTimer);
    if (query.length < 2) {
      closeSuggestions();
      return;
    }
    el.suggestions.hidden = false;
    el.suggestions.innerHTML =
      '<div class="suggestion-loading"><i data-lucide="loader-circle" class="spin-icon"></i><span>Mencari...</span></div>';
    refreshIcons();
    state.suggestionTimer = setTimeout(function () {
      fetch('/search?q=' + encodeURIComponent(query) + '&page=1&limit=6')
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (res) {
          if (requestId !== state.suggestionRequestId || el.searchInput.value.trim() !== query) return;
          var items = res.data || [];
          el.suggestions.innerHTML = '';
          if (!items.length) {
            closeSuggestions();
            return;
          }
          items.forEach(function (t) {
            var item = document.createElement('button');
            item.type = 'button';
            item.className = 'suggestion-item';
            item.dataset.id = t.trackId || '';
            item.dataset.title = t.title || '';
            item.dataset.artist = t.artist || '';
            item.dataset.thumbnail = t.thumbnail || '';
            item.innerHTML =
              (t.thumbnail ? '<img src="' + escapeHtml(t.thumbnail) + '" alt="">'
                : '<span class="suggestion-cover"><i data-lucide="music"></i></span>') +
              '<span class="suggestion-copy"><strong>' + escapeHtml(t.title || 'Unknown') +
              '</strong><small>' + escapeHtml(t.artist || '') + '</small></span>' +
              '<i data-lucide="arrow-up-right" class="suggestion-arrow"></i>';
            el.suggestions.appendChild(item);
          });
          refreshIcons();
        })
        .catch(function () {
          if (requestId === state.suggestionRequestId) closeSuggestions();
        });
    }, 260);
  }

  function card(t, featured) {
    var d = document.createElement('div');
    d.className = featured ? 'card top-card' : 'card song-row';
    d.dataset.id = t.trackId || '';
    d.dataset.title = t.title || '';
    d.dataset.artist = t.artist || '';
    d.dataset.thumbnail = t.thumbnail || '';

    var queueButton = document.createElement('button');
    queueButton.className = 'queue-next';
    queueButton.type = 'button';
    queueButton.title = 'Tambahkan ke antrean berikutnya';
    queueButton.setAttribute('aria-label', 'Tambahkan ke antrean berikutnya');
    queueButton.innerHTML = '<i data-lucide="list-plus"></i>';
    d.appendChild(queueButton);

    var cover = document.createElement('div');
    cover.className = 'card-cover';
    if (t.thumbnail) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = t.title || '';
      img.onerror = function () { this.style.display = 'none'; };
      img.src = t.thumbnail;
      cover.appendChild(img);
      var overlay = document.createElement('div');
      overlay.className = 'play-overlay';
      overlay.innerHTML = '<i class="fas fa-play"></i>';
      cover.appendChild(overlay);
    }
    var body = document.createElement('div');
    body.className = 'card-body';

    var meta = [];
    if (t.album) meta.push('<span>' + escapeHtml(t.album) + '</span>');
    if (t.duration && t.duration !== '0:00') meta.push('<span>' + escapeHtml(t.duration) + '</span>');
    if (t.explicit) meta.push('<span class="badge-explicit">E</span>');

    body.innerHTML =
      '<div class="card-title">' + escapeHtml(t.title || 'Unknown') + '</div>' +
      '<div class="card-artist">' + escapeHtml(t.artist || '') + '</div>' +
      '<div class="card-meta">' + (meta.length ? meta.join('<span class="sep"></span>') : '') + '</div>';

    d.appendChild(cover);
    d.appendChild(body);
    return d;
  }

  // ---------- EVENTS ----------
  el.btnSearch.addEventListener('click', doSearch);
  el.searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doSearch();
  });
  el.searchInput.addEventListener('input', function () {
    fetchSuggestions(el.searchInput.value.trim());
  });

  document.addEventListener('click', function (e) {
    var target = e.target;
    var closest = target && target.closest ? target.closest.bind(target) : null;
    if (!closest) return;

    var qButton = closest('.queue-next');
    if (qButton) {
      var cardForQueue = qButton.closest('.card');
      if (cardForQueue && cardForQueue.dataset.id) {
        addItemsToQueue([{
          trackId: cardForQueue.dataset.id,
          title: cardForQueue.dataset.title || '',
          artist: cardForQueue.dataset.artist || '',
          thumbnail: cardForQueue.dataset.thumbnail || ''
        }]).catch(function () {});
      }
      return;
    }

    var libItem = closest('.lib-item');
    if (libItem && libItem.dataset.type) {
      openPlaylistView(libItem.dataset.type, libItem.dataset.id || '',
        libItem.dataset.type === 'liked' ? 'Lagu yang Disukai' : '');
      return;
    }

    var plCard = closest('.pl-card');
    if (plCard && plCard.dataset.type) {
      var plName = plCard.querySelector('.pl-name');
      openPlaylistView(plCard.dataset.type, plCard.dataset.id || '',
        (plName && plName.textContent) || '');
      return;
    }
  });

  el.queueList.addEventListener('click', function (e) {
    var remove = e.target.closest('.queue-remove');
    if (remove) {
      e.stopPropagation();
      window.SpotifyQueue.remove(Number(remove.dataset.index)).catch(function () {
        toast('Antrean tidak tersedia');
      });
      return;
    }
  });

  el.queueClear.addEventListener('click', function () {
    window.SpotifyQueue.clear().catch(function () {
      toast('Antrean tidak tersedia');
    });
  });

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data) return;

    if (e.data.type === 'playback-state' && e.data.playback && e.data.playback.trackId) {
      updateNowPlaying(e.data.playback);
    }
    if (e.data.type === 'queue-updated') {
      renderQueue();
    }
    if (e.data === 'loginSuccess' || (e.data && e.data.type === 'spdc-saved')) {
      if (getCookie('sp_dc')) onLoggedIn();
    }
  });

  function updateNowPlaying(playback) {
    el.nowTitle.textContent = playback.title || 'Sedang diputar';
    el.nowSongTitle.textContent = playback.title || '—';
    el.nowArtist.textContent = playback.artist || '—';
    if (playback.thumbnail) {
      el.nowCover.src = playback.thumbnail;
      el.nowCover.hidden = false;
    } else {
      el.nowCover.hidden = true;
    }
  }

  if (el.bannerLogin) el.bannerLogin.addEventListener('click', openLoginModal);
  if (el.loginBtn) el.loginBtn.addEventListener('click', openLoginModal);
  if (el.libraryLogin) el.libraryLogin.addEventListener('click', openLoginModal);
  if (el.loginClose) el.loginClose.addEventListener('click', closeLoginModal);
  if (el.loggedUser) el.loggedUser.addEventListener('click', logoutSpdc);
  if (el.libraryReload) el.libraryReload.addEventListener('click', function () {
    loadLibrary();
  });

  document.addEventListener('click', function (e) {
    if (!el.searchbar || el.searchbar.contains(e.target)) return;
    closeSuggestions();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.loginModal.hidden) {
      closeLoginModal();
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '/') {
      e.preventDefault();
      el.searchInput.focus();
    }
  });

  el.homeBtn.addEventListener('click', function () {
    showView('home');
  });

  el.plPlayAll.addEventListener('click', function () {
    if (state.currentPlaylist) playFirstAndEnqueueRest(state.currentPlaylist.tracks);
  });
  el.plEnqueueAll.addEventListener('click', function () {
    if (!state.currentPlaylist) return;
    var tr = state.currentPlaylist.tracks || [];
    if (!tr.length) {
      toast(state.spDc ? 'Track playlist belum dimuat. Muat ulang playlist.' : 'Login dulu untuk memuat playlist.');
      return;
    }
    addItemsToQueue(tr).catch(function () {});
  });

  window.addEventListener('popstate', function () {
    if (location.pathname === '/' || location.pathname === '') {
      showView('home');
    }
  });

  window.addEventListener('pageshow', function () {
    var saved;
    try { saved = JSON.parse(localStorage.getItem('spotifyPlayback') || 'null'); } catch (e) { saved = null; }
    if (saved && saved.trackId) updateNowPlaying(saved);
  });

  // ---------- SEARCH INFINITE SCROLL ----------
  var observer = new IntersectionObserver(function (entries) {
    if (entries[0] && entries[0].isIntersecting && state.hasNext && !state.loading) {
      fetchSearch();
    }
  }, { root: el.main, rootMargin: '480px 0px' });
  if (el.searchSentinel) observer.observe(el.searchSentinel);

  // ---------- INIT ----------
  refreshIcons();
  if (window.SpotifyQueue) {
    window.SpotifyQueue.start();
    window.SpotifyQueue.subscribe(function () { renderQueue(); });
    window.SpotifyQueue.refresh();
  } else {
    renderQueue();
  }
  loadSettings().then(function () {
    loadLibrary();
    if (new URLSearchParams(location.search).get('login') === '1') {
      openLoginModal();
      history.replaceState(null, '', location.pathname);
    }
  }).catch(function (e) { console.error('init error', e); });
  console.log('home.js loaded', { loginBtn: !!el.loginBtn, spDc: !!state.spDc });
})();