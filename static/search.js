(function () {
  var state = {
    spDc: '',
    query: '',
    page: 1,
    limit: 20,
    hasNext: false,
    loading: false,
    requestId: 0,
    suggestionTimer: null,
    suggestionRequestId: 0
  };

  var el = {
    hint: document.getElementById('hint'),
    results: document.getElementById('results'),
    topResults: document.getElementById('topResults'),
    topResult: document.getElementById('topResult'),
    songResults: document.getElementById('songResults'),
    songScrollArea: document.getElementById('songScrollArea'),
    songList: document.getElementById('songList'),
    scrollStatus: document.getElementById('scrollStatus'),
    scrollSkeleton: document.getElementById('scrollSkeleton'),
    scrollSentinel: document.getElementById('scrollSentinel'),
    searchbar: document.querySelector('.searchbar'),
    resultsSkeleton: document.getElementById('resultsSkeleton'),
    suggestions: document.getElementById('suggestions'),
    searchInput: document.getElementById('searchInput'),
    btnSearch: document.getElementById('btnSearch'),
    banner: document.getElementById('spdcBanner'),
    bannerOpen: document.getElementById('bannerOpenSettings'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsPop: document.getElementById('settingsPop'),
    spdcInput: document.getElementById('spdcInput'),
    btnSaveSpdc: document.getElementById('btnSaveSpdc'),
    settingsMsg: document.getElementById('settingsMsg'),
    toast: document.getElementById('toast'),
    miniPlayer: document.getElementById('miniPlayer'),
    miniArtwork: document.getElementById('miniArtwork'),
    miniFrame: document.getElementById('miniFrame'),
    miniTitle: document.getElementById('miniTitle'),
    miniArtist: document.getElementById('miniArtist'),
    miniLyrics: document.getElementById('miniLyrics'),
    miniClose: document.getElementById('miniClose'),
    playerFrame: document.getElementById('playerFrame'),
    queueBtn: document.getElementById('queueBtn'),
    queuePanel: document.getElementById('queuePanel'),
    queueList: document.getElementById('queueList'),
    queueEmpty: document.getElementById('queueEmpty'),
    queueClear: document.getElementById('queueClear'),
    queueCount: document.getElementById('queueCount')
  };

  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(el.toast._t);
    el.toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, ms || 2200);
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

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
      row.innerHTML = (item.thumbnail ? '<img class="queue-thumb" src="' + escapeHtml(item.thumbnail) + '" alt="">' : '<span class="queue-thumb queue-thumb-empty"><i data-lucide="music"></i></span>') +
        '<span class="queue-item-copy"><strong>' + escapeHtml(item.title || 'Unknown') + '</strong><small>' + escapeHtml(item.artist || '') + '</small></span>' +
        '<button class="queue-remove" data-index="' + index + '" title="Hapus dari antrean" aria-label="Hapus dari antrean"><i data-lucide="x"></i></button>';
      el.queueList.appendChild(row);
    });
    refreshIcons();
  }

  // ---------- SETTINGS ----------
  function loadSettings() {
    return fetch('/settings')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        state.spDc = (s && s.sp_dc) || '';
        el.spdcInput.value = state.spDc;
        syncSpdcUI();
      })
      .catch(function () { syncSpdcUI(); });
  }

  function syncSpdcUI() {
    el.banner.classList.toggle('show', !state.spDc);
  }

  function openSettings() {
    el.settingsPop.classList.add('open');
    el.settingsBtn.classList.add('active');
    setTimeout(function () { el.spdcInput.focus(); }, 60);
  }

  function closeSettings() {
    el.settingsPop.classList.remove('open');
    el.settingsBtn.classList.remove('active');
  }

  function setMsg(text, type) {
    el.settingsMsg.textContent = text;
    el.settingsMsg.className = 'pmsg ' + (type || '');
  }

  function saveSpdc() {
    var val = el.spdcInput.value.trim();
    setMsg('Menyimpan...');
    return fetch('/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sp_dc: val })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (s) {
        state.spDc = (s && s.sp_dc) || '';
        syncSpdcUI();
        setMsg(state.spDc ? 'Tersimpan' : 'Kosong, dihapus dari file', 'ok');
        setTimeout(function () {
          closeSettings();
          toast(state.spDc ? 'sp_dc disimpan' : 'sp_dc dihapus');
        }, 600);
      })
      .catch(function () {
        setMsg('Gagal menyimpan', 'err');
      });
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
    document.body.classList.add('searching');
    el.hint.style.display = 'none';
    el.topResults.hidden = true;
    el.songResults.hidden = true;
    el.topResult.innerHTML = '';
    el.songList.innerHTML = '';
    el.resultsSkeleton.hidden = false;
    el.results.hidden = true;
    fetchSearch();
  }

  function fetchSearch() {
    if (state.loading) return;
    state.loading = true;
    var requestId = state.requestId;
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, 20000);
    el.scrollStatus.hidden = false;
    refreshIcons();
    el.scrollSkeleton.hidden = state.page === 1;

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
            el.hint.innerHTML = '<p>Tidak ada hasil untuk "' + escapeHtml(state.query) + '"</p>';
            el.hint.style.display = 'block';
            el.scrollStatus.hidden = true;
            el.resultsSkeleton.hidden = true;
            el.results.hidden = false;
            return;
          }
          el.topResults.hidden = false;
          el.songResults.hidden = false;
          el.topResult.appendChild(card(items[0], true));
          items.slice(1).forEach(function (t) { el.songList.appendChild(card(t, false)); });
        } else {
          items.forEach(function (t) { el.songList.appendChild(card(t, false)); });
        }
        state.hasNext = !!res.hasNext;
        state.page += 1;
        refreshIcons();
        if (state.page === 2) {
          el.resultsSkeleton.hidden = true;
          el.results.hidden = false;
        }
      })
      .catch(function (e) {
        if (requestId !== state.requestId) return;
        var message = e.name === 'AbortError'
          ? 'Pencarian terlalu lama. Coba lagi.'
          : 'Pencarian gagal. Coba lagi.';
        el.resultsSkeleton.hidden = true;
        el.results.hidden = false;
        el.hint.innerHTML = '<p>' + message + '</p>';
        el.hint.style.display = 'block';
        toast(message, 2600);
      })
      .then(function () {
        clearTimeout(timeoutId);
        if (requestId !== state.requestId) return;
        state.loading = false;
        el.scrollStatus.hidden = !state.hasNext;
        el.scrollSkeleton.hidden = true;
        if (state.page === 1) {
          el.resultsSkeleton.hidden = true;
          el.results.hidden = false;
        }
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
    el.suggestions.innerHTML = '<div class="suggestion-loading"><i data-lucide="loader-circle" class="spin-icon"></i><span>Mencari...</span></div>';
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
            item.innerHTML = (t.thumbnail ? '<img src="' + escapeHtml(t.thumbnail) + '" alt="">' : '<span class="suggestion-cover"><i data-lucide="music"></i></span>') +
              '<span class="suggestion-copy"><strong>' + escapeHtml(t.title || 'Unknown') + '</strong><small>' + escapeHtml(t.artist || '') + '</small></span>' +
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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
    cover.className = 'card-cover' + (featured ? ' featured-cover' : '');
    if (t.thumbnail) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = t.title || '';
      img.onerror = function () { this.style.display = 'none'; };
      img.src = t.thumbnail;
      cover.appendChild(img);
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
      (featured ? '<div class="card-meta">' + meta.join('<span class="sep"></span>') + '</div>' :
        '<div class="card-meta">' + (meta.length ? meta.join('<span class="sep"></span>') : '') + '</div>');

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

  el.results.addEventListener('click', function (e) {
    var queueButton = e.target.closest('.queue-next');
    if (queueButton) {
      e.stopPropagation();
      enqueueTrack(queueButton.parentElement);
      return;
    }
    var cardEl = e.target.closest('.card');
    if (!cardEl) return;
    var id = cardEl.dataset.id;
    if (!id) return;
    openEmbeddedPlayer(cardEl);
  });

  function enqueueTrack(cardEl) {
    if (!cardEl || !cardEl.dataset.id) return;
    var item = {
      trackId: cardEl.dataset.id,
      title: cardEl.dataset.title || '',
      artist: cardEl.dataset.artist || '',
      thumbnail: cardEl.dataset.thumbnail || ''
    };
    window.SpotifyQueue.add(item)
      .then(function () {
        toast('Ditambahkan ke antrean berikutnya');
      })
      .catch(function () {
        toast('Antrean tidak tersedia');
      });
  }

  el.suggestions.addEventListener('click', function (e) {
    var item = e.target.closest('.suggestion-item');
    if (!item || !item.dataset.id) return;
    closeSuggestions();
    openEmbeddedPlayer(item);
  });

  function rememberSearchPlayback(source) {
    try {
      var current = JSON.parse(localStorage.getItem('spotifyPlayback') || '{}');
      current.trackId = source.dataset.id;
      current.title = source.dataset.title || '';
      current.artist = source.dataset.artist || '';
      current.thumbnail = source.dataset.thumbnail || '';
      current.playing = false;
      current.positionMs = 0;
      localStorage.setItem('spotifyPlayback', JSON.stringify(current));
    } catch (e) { }
  }

  function openEmbeddedPlayer(source) {
    rememberSearchPlayback(source);
    el.miniPlayer.hidden = true;
    el.miniPlayer.classList.remove('streaming');
    el.playerFrame.classList.remove('is-background');
    el.playerFrame.hidden = false;
    el.playerFrame.src = '/player?trackId=' + encodeURIComponent(source.dataset.id) + '&embedded=1';
    history.pushState({ player: true }, '', '/player?trackId=' + encodeURIComponent(source.dataset.id));
  }

  function openPlayerFromMini() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem('spotifyPlayback') || 'null'); } catch (e) { saved = null; }
    if (!saved || !saved.trackId) return;
    if (el.playerFrame.hidden) {
      openEmbeddedPlayer({
        dataset: {
          id: saved.trackId,
          title: saved.title || '',
          artist: saved.artist || '',
          thumbnail: saved.thumbnail || ''
        }
      });
      return;
    }
    el.playerFrame.classList.remove('is-background');
    el.miniPlayer.hidden = true;
    history.pushState({ player: true }, '', '/player?trackId=' + encodeURIComponent(saved.trackId));
  }

  function showPersistentMiniPlayer() {
    var saved;
    el.miniPlayer.hidden = true;
    el.miniPlayer.classList.remove('streaming');
    try { saved = JSON.parse(localStorage.getItem('spotifyPlayback') || 'null'); } catch (e) { saved = null; }
    // Mini player hanya muncul saat ada sesi pemutaran yang baru saja aktif.
    if (!saved || !saved.trackId || saved.playing !== true) return;
    var age = Date.now() - (saved.lastActiveAt || 0);
    if (age > 120000) return;
    el.miniTitle.textContent = saved.title || 'Sedang diputar';
    el.miniArtist.textContent = saved.artist || '';
    if (el.miniArtwork) {
      el.miniArtwork.src = saved.thumbnail || '';
      el.miniArtwork.hidden = !saved.thumbnail;
    }
    el.miniFrame.src = 'about:blank';
    el.miniPlayer.classList.add('streaming');
    el.miniPlayer.hidden = false;
    refreshIcons();
  }

  function updateMiniFromPlayback(playback) {
    if (!playback || !playback.trackId) return;
    localStorage.setItem('spotifyPlayback', JSON.stringify(playback));
    if (!el.playerFrame.classList.contains('is-background')) return;
    if (playback.playing !== true) {
      el.miniPlayer.classList.remove('streaming');
      el.miniPlayer.hidden = true;
      return;
    }
    el.miniTitle.textContent = playback.title || 'Sedang diputar';
    el.miniArtist.textContent = playback.artist || '';
    if (el.miniArtwork) {
      el.miniArtwork.src = playback.thumbnail || '';
      el.miniArtwork.hidden = !playback.thumbnail;
    }
    el.miniPlayer.classList.add('streaming');
    el.miniPlayer.hidden = false;
    refreshIcons();
  }

  function hideEmbeddedPlayer(showMini) {
    if (!el.playerFrame || el.playerFrame.hidden) return;
    el.playerFrame.classList.add('is-background');
    if (showMini) showPersistentMiniPlayer();
  }

  function restoreMiniPlayer() {
    var saved;
    el.miniPlayer.hidden = true;
    el.miniPlayer.classList.remove('streaming');
    el.miniFrame.src = 'about:blank';
    try { saved = JSON.parse(localStorage.getItem('spotifyPlayback') || 'null'); } catch (e) { saved = null; }
    if (!saved || !saved.trackId || !state.spDc || saved.playing !== true) return;
    var restoreAge = Date.now() - (saved.lastActiveAt || 0);
    if (restoreAge > 120000) return;
    el.miniTitle.textContent = saved.title || 'Sedang diputar';
    el.miniArtist.textContent = saved.artist || '';
    if (el.miniArtwork) {
      el.miniArtwork.src = saved.thumbnail || '';
      el.miniArtwork.hidden = !saved.thumbnail;
    }
    el.miniPlayer.hidden = false;
    refreshIcons();
    el.miniFrame.src = '/embed-proxy?trackId=' + encodeURIComponent(saved.trackId) +
      '&sp_dc=' + encodeURIComponent(state.spDc);
    el.miniFrame.onload = function () {
      setTimeout(function () {
        try {
          var doc = el.miniFrame.contentDocument;
          var media = doc && doc.querySelector('audio, video');
          if (!media) return;
          media.currentTime = (saved.positionMs || 0) / 1000;
          var result = media.play();
          if (result && result.catch) result.catch(function () { });
        } catch (e) { }
      }, 700);
    };
  }

  el.miniClose.addEventListener('click', function () {
    el.playerFrame.src = 'about:blank';
    el.playerFrame.hidden = true;
    el.playerFrame.classList.remove('is-background');
    el.miniFrame.src = 'about:blank';
    el.miniPlayer.classList.remove('streaming');
    el.miniPlayer.hidden = true;
    localStorage.removeItem('spotifyPlayback');
  });

  el.miniLyrics.addEventListener('click', openPlayerFromMini);

  window.addEventListener('message', function (e) {
    if (e.origin === location.origin && e.data && e.data.type === 'playback-state') {
      updateMiniFromPlayback(e.data.playback);
      return;
    }
    if (e.origin !== location.origin || !e.data || e.data.type !== 'player-back') return;
    if (e.data.playback && e.data.playback.trackId) {
      localStorage.setItem('spotifyPlayback', JSON.stringify(e.data.playback));
    }
    history.replaceState(null, '', '/');
    hideEmbeddedPlayer(true);
  });

  window.addEventListener('popstate', function () {
    if (location.pathname === '/player') {
      history.replaceState(null, '', '/');
    }
    hideEmbeddedPlayer(true);
  });

  el.queueBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    el.queuePanel.hidden = !el.queuePanel.hidden;
    if (!el.queuePanel.hidden) renderQueue();
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
    var row = e.target.closest('.queue-item');
    if (!row) return;
    playQueueItem(Number(row.dataset.index));
  });

  function playQueueItem(index) {
    var item = window.SpotifyQueue.get()[index];
    if (!item || !item.trackId) return;
    // Lagu yang diputar langsung dari antrean harus hilang dari antrean.
    window.SpotifyQueue.remove(index).then(function () {
      el.queuePanel.hidden = true;
      openEmbeddedPlayer({
        dataset: {
          id: item.trackId,
          title: item.title || '',
          artist: item.artist || '',
          thumbnail: item.thumbnail || ''
        }
      });
    }).catch(function () {
      toast('Antrean tidak tersedia');
    });
  }

  el.queueClear.addEventListener('click', function () {
    window.SpotifyQueue.clear().catch(function () {
      toast('Antrean tidak tersedia');
    });
  });

  document.addEventListener('click', function (e) {
    if (el.queuePanel.hidden) return;
    if (el.queuePanel.contains(e.target) || el.queueBtn.contains(e.target)) return;
    el.queuePanel.hidden = true;
  });

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'queue-updated') return;
    renderQueue();
  });

  document.addEventListener('click', function (e) {
    if (!el.searchbar || el.searchbar.contains(e.target)) return;
    closeSuggestions();
  });

  var observer = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting && state.hasNext && !state.loading) fetchSearch();
  }, { root: el.songScrollArea, rootMargin: '480px 0px' });
  observer.observe(el.scrollSentinel);

  el.settingsBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (el.settingsPop.classList.contains('open')) {
      closeSettings();
    } else {
      openSettings();
    }
  });

  document.addEventListener('click', function (e) {
    if (!el.settingsPop.classList.contains('open')) return;
    if (el.settingsPop.contains(e.target) || e.target === el.settingsBtn) return;
    closeSettings();
  });

  el.btnSaveSpdc.addEventListener('click', saveSpdc);
  el.spdcInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveSpdc();
  });

  el.bannerOpen.addEventListener('click', function () {
    openSettings();
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '/') {
      e.preventDefault();
      el.searchInput.focus();
    }
  });

  window.addEventListener('pageshow', function () {
    restoreMiniPlayer();
  });

  // ---------- INIT ----------
  el.miniPlayer.hidden = true;
  refreshIcons();
  if (window.SpotifyQueue) {
    window.SpotifyQueue.start();
    window.SpotifyQueue.subscribe(function () { renderQueue(); });
    window.SpotifyQueue.refresh();
  } else {
    renderQueue();
  }
  loadSettings().then(function () {
    restoreMiniPlayer();
  });
})();