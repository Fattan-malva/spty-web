window.SpotifyQueue = (function () {
  var queue = [];
  var listeners = [];
  var es = null;
  var started = false;

  function emit() {
    listeners.forEach(function (cb) {
      try { cb(queue.slice(), queue.length); } catch (e) {}
    });
  }

  function setQueue(next) {
    queue = Array.isArray(next) ? next : [];
    emit();
  }

  function subscribe(cb) {
    listeners.push(cb);
    cb(queue.slice(), queue.length);
    return function () {
      var i = listeners.indexOf(cb);
      if (i > -1) listeners.splice(i, 1);
    };
  }

  function parseOrNull(r) {
    if (!r.ok) return Promise.reject(new Error('HTTP ' + r.status));
    return r.json();
  }

  function refresh() {
    return fetch('/queue')
      .then(parseOrNull)
      .then(function (d) {
        setQueue((d && d.queue) || []);
        return queue.slice();
      })
      .catch(function () { return queue.slice(); });
  }

  function post(action, extra) {
    var body = Object.assign({ action: action }, extra || {});
    return fetch('/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(parseOrNull)
      .then(function (res) {
        if (res && res.queue) setQueue(res.queue);
        return res || {};
      });
  }

  function start() {
    if (started) return es;
    started = true;
    es = new EventSource('/queue/stream');
    es.onmessage = function (e) {
      try {
        var d = JSON.parse(e.data);
        if (d && d.type === 'queue') setQueue(d.queue);
      } catch (err) {}
    };
    es.onerror = function () {
      if (es && es.readyState === EventSource.CLOSED) {
        setTimeout(function () {
          started = false;
          es = start();
        }, 2000);
      }
    };
    es.onopen = function () { refresh(); };
    return es;
  }

  return {
    get: function () { return queue.slice(); },
    refresh: refresh,
    add: function (item) { return post('add', { item: item }); },
    addMany: function (items) { return post('add', { items: items }); },
    remove: function (index) { return post('remove', { index: index }); },
    shift: function () { return post('shift'); },
    clear: function () { return post('clear'); },
    subscribe: subscribe,
    start: start
  };
})();