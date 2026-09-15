(function () {
  'use strict';

  if (window.__queueRuntimeLoaded) return;
  window.__queueRuntimeLoaded = true;

  var queueUrl = '/queue';
  var timer = null;

  function getEl(id) {
    return document.getElementById(id);
  }

  function toast(message) {
    var el = getEl('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el.__queueToastTimer);
    el.__queueToastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, 2200);
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function api(url, options) {
    return fetch(url, Object.assign({
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    }, options || {})).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body.detail || ('HTTP ' + res.status));
        });
      }
      return res.json();
    });
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setBadge(count) {
    var badge = getEl('queueCount');
    if (!badge) return;
    badge.textContent = String(count || 0);
    badge.hidden = !count;
  }

  function getQueue() {
    return api(queueUrl).then(function (data) {
      var items = Array.isArray(data.items) ? data.items : [];
      setBadge(items.length);
      return items;
    });
  }

  function renderQueuePanel(items) {
    var list = getEl('queueList');
    var empty = getEl('queueEmpty');
    if (!list || !empty) return;

    list.innerHTML = '';
    empty.hidden = items.length > 0;

    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'queue-item';
      row.dataset.trackId = item.trackId || '';
      row.title = 'Putar sekarang';
      row.innerHTML =
        (item.thumbnail
          ? '<img class="queue-thumb" src="' + escapeHtml(item.thumbnail) + '" alt="">'
          : '<span class="queue-thumb queue-thumb-empty"><i data-lucide="music"></i></span>') +
        '<span class="queue-item-copy"><strong>' + escapeHtml(item.title || 'Unknown') +
        '</strong><small>' + escapeHtml(item.artist || '') +
        '</small></span>' +
        '<button class="queue-remove" data-track-id="' + escapeHtml(item.trackId || '') +
        '" title="Hapus dari antrean" aria-label="Hapus dari antrean"><i data-lucide="x"></i></button>';
      list.appendChild(row);
    });
    refreshIcons();
  }

  function refreshQueuePanel() {
    return getQueue().then(function (items) {
      var panel = getEl('queuePanel');
      if (panel && !panel.hidden) renderQueuePanel(items);
      return items;
    }).catch(function (error) {
      console.warn('[QUEUE] refresh failed:', error.message);
      return [];
    });
  }

  function addItem(card) {
    if (!card || !card.dataset.id) return Promise.resolve();
    return api(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackId: card.dataset.id,
        title: card.dataset.title || '',
        artist: card.dataset.artist || '',
        thumbnail: card.dataset.thumbnail || ''
      })
    }).then(function (data) {
      setBadge(data.count || 0);
      if (data.added) toast('Ditambahkan ke antrean berikutnya');
      else toast('Lagu sudah ada di antrean');
      var panel = getEl('queuePanel');
      if (panel && !panel.hidden) renderQueuePanel(data.items || []);
    }).catch(function (error) {
      toast('Gagal menambahkan antrean');
      console.error('[QUEUE] add failed:', error);
    });
  }

  function removeItem(trackId) {
    if (!trackId) return Promise.resolve();
    return api(queueUrl + '/' + encodeURIComponent(trackId), {
      method: 'DELETE'
    }).then(function (data) {
      setBadge(data.count || 0);
      var panel = getEl('queuePanel');
      if (panel && !panel.hidden) renderQueuePanel(data.items || []);
    }).catch(function (error) {
      console.error('[QUEUE] delete failed:', error);
    });
  }

  function clearQueue() {
    return api(queueUrl, { method: 'DELETE' }).then(function () {
      setBadge(0);
      var panel = getEl('queuePanel');
      if (panel && !panel.hidden) renderQueuePanel([]);
    }).catch(function (error) {
      console.error('[QUEUE] clear failed:', error);
    });
  }

  function takeNext() {
    return api(queueUrl + '/next', { method: 'POST' }).then(function (data) {
      setBadge(data.count || 0);
      var panel = getEl('queuePanel');
      if (panel && !panel.hidden) renderQueuePanel(data.items || []);
      return data.item || null;
    });
  }

  function playerUrl(item, mini) {
    return '/player?trackId=' + encodeURIComponent(item.trackId) +
      '&embedded=1' + (mini ? '&mini=1' : '');
  }

  function updateMiniHeader(item) {
    var title = getEl('miniTitle');
    var artist = getEl('miniArtist');
    var artwork = getEl('miniArtwork');
    if (title) title.textContent = item.title || 'Sedang diputar';
    if (artist) artist.textContent = item.artist || '';
    if (artwork) {
      artwork.src = item.thumbnail || '';
      artwork.hidden = !item.thumbnail;
    }
  }

  function playInCurrentFrame(item, sourceWindow) {
    var mini = getEl('miniPlayer');
    var miniFrame = getEl('miniFrame');
    var playerFrame = getEl('playerFrame');

    if (miniFrame && sourceWindow === miniFrame.contentWindow) {
      updateMiniHeader(item);
      mini.classList.add('streaming');
      mini.hidden = false;
      miniFrame.dataset.trackId = item.trackId;
      miniFrame.src = playerUrl(item, true);
      return true;
    }

    if (playerFrame && sourceWindow === playerFrame.contentWindow) {
      playerFrame.hidden = false;
      playerFrame.classList.remove('is-background');
      playerFrame.src = playerUrl(item, false);
      return true;
    }

    if (miniFrame && mini && !mini.hidden) {
      updateMiniHeader(item);
      mini.classList.add('streaming');
      miniFrame.dataset.trackId = item.trackId;
      miniFrame.src = playerUrl(item, true);
      return true;
    }

    if (playerFrame) {
      playerFrame.hidden = false;
      playerFrame.classList.remove('is-background');
      playerFrame.src = playerUrl(item, false);
      return true;
    }

    return false;
  }

  function handleEnded(sourceWindow, trackId) {
    console.log('[QUEUE] ended received', { trackId: trackId || null });
    takeNext().then(function (next) {
      if (!next) {
        console.log('[QUEUE] no next track');
        return;
      }
      console.log('[QUEUE] next track', next.trackId);
      playInCurrentFrame(next, sourceWindow);
    }).catch(function (error) {
      console.error('[QUEUE] next failed:', error);
    });
  }

  function openQueuedItem(item) {
    if (!item || !item.trackId) return;
    removeItem(item.trackId).then(function () {
      var mini = getEl('miniPlayer');
      var miniFrame = getEl('miniFrame');
      if (mini && miniFrame) {
        updateMiniHeader(item);
        mini.classList.remove('expanded');
        mini.classList.add('streaming');
        mini.hidden = false;
        miniFrame.dataset.trackId = item.trackId;
        miniFrame.src = playerUrl(item, true);
      } else if (window.parent !== window) {
        window.parent.postMessage({ type: 'queue-play-request', item: item }, location.origin);
      } else {
        location.replace('/player?trackId=' + encodeURIComponent(item.trackId));
      }
    });
  }

  function captureClick(event) {
    var target = event.target;
    var closest = target && target.closest ? target.closest.bind(target) : null;
    if (!closest) return;

    var queueButton = closest('#queueBtn');
    if (queueButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      var panel = getEl('queuePanel');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) refreshQueuePanel();
      return;
    }

    var queueNext = closest('.queue-next');
    if (queueNext) {
      event.preventDefault();
      event.stopImmediatePropagation();
      addItem(closest('.card'));
      return;
    }

    var queueClearButton = closest('#queueClear');
    if (queueClearButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearQueue();
      return;
    }

    var remove = closest('.queue-remove');
    if (remove) {
      event.preventDefault();
      event.stopImmediatePropagation();
      removeItem(remove.dataset.trackId || closest('.queue-item').dataset.trackId);
      return;
    }

    var row = closest('.queue-item');
    if (row && row.dataset.trackId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      var itemPromise = getQueue().then(function (items) {
        return items.find(function (item) { return item.trackId === row.dataset.trackId; });
      });
      itemPromise.then(openQueuedItem);
    }
  }

  function bind() {
    document.addEventListener('click', captureClick, true);

    window.addEventListener('message', function (event) {
      if (event.origin !== location.origin || !event.data) return;

      if (event.data.type === 'queue-ended') {
        handleEnded(event.source, event.data.trackId || '');
        return;
      }

      if (event.data.type === 'queue-play-request' && event.data.item) {
        openQueuedItem(event.data.item);
      }
    });

    window.addEventListener('queue-ended-local', function (event) {
      var detail = event.detail || {};
      handleEnded(window, detail.trackId || '');
    });

    refreshQueuePanel();
    timer = setInterval(refreshQueuePanel, 1500);
  }

  window.queueRuntime = {
    getQueue: getQueue,
    add: addItem,
    remove: removeItem,
    clear: clearQueue,
    next: takeNext,
    play: openQueuedItem
  };

  bind();
})();
