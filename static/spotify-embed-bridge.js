(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var trackId = params.get('trackId') || '';
  var endedSent = false;

  function normalize(data) {
    if (!data || typeof data !== 'object') return null;
    var payload = data.payload || data.data || data;
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  }

  function forward(type, payload) {
    try {
      window.parent.postMessage({
        type: type,
        trackId: trackId,
        payload: payload
      }, location.origin);
    } catch (e) {}
  }

  function checkEnded(payload) {
    var position = Number(payload && payload.position);
    var duration = Number(payload && payload.duration);
    var paused = payload && payload.isPaused === true;

    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;

    var remaining = duration - position;
    if (paused && position > 0 && remaining <= 750) {
      if (!endedSent) {
        endedSent = true;
        console.log('[SPOTIFY BRIDGE] ended detected', {
          trackId: trackId,
          position: position,
          duration: duration,
          remaining: remaining
        });
        forward('spotify-ended', {
          position: position,
          duration: duration,
          isPaused: paused
        });
      }
    }
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;

    var type = data.type || data.event || '';
    if (type !== 'playback_update' && type !== 'playback_started' && type !== 'ready') return;

    var payload = normalize(data) || {};

    if (type === 'playback_started') {
      endedSent = false;
    }

    if (type === 'playback_update') {
      checkEnded(payload);
    }

    console.log('[SPOTIFY BRIDGE]', type, payload);
    forward(type, payload);
  });

  console.log('[SPOTIFY BRIDGE] ready', { trackId: trackId });
})();
