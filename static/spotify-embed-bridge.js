(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var trackId = params.get('trackId') || '';
  var endedSent = false;

  function normalize(data) {
    if (!data || typeof data !== 'object') return null;
    var payload = data.payload || data.data || data.detail || data.state || data;
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  }

  function findNumber(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      var value = obj[keys[i]];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return Number(value);
      }
    }
    return null;
  }

  function findBoolean(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof obj[keys[i]] === 'boolean') return obj[keys[i]];
    }
    return null;
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

  function emitEnded(position, duration, source) {
    if (endedSent) return;
    endedSent = true;

    var payload = {
      trackId: trackId,
      position: position,
      duration: duration,
      source: source
    };

    console.log('[SPOTIFY BRIDGE] ENDED DETECTED', payload);
    forward('spotify-ended', payload);
  }

  function inspectPlayback(data) {
    var payload = normalize(data) || {};
    var position = findNumber(payload, ['position', 'positionMs', 'currentTime', 'currentTimeMs', 'progress', 'progressMs']);
    var duration = findNumber(payload, ['duration', 'durationMs', 'length', 'lengthMs']);
    var paused = findBoolean(payload, ['isPaused', 'paused', 'is_paused']);
    var ended = findBoolean(payload, ['ended', 'isEnded', 'finished', 'isFinished']);

    if (ended === true) {
      emitEnded(position, duration, 'message-ended');
      return;
    }

    if (Number.isFinite(position) && Number.isFinite(duration) && duration > 0) {
      var remaining = duration - position;
      console.log('[SPOTIFY BRIDGE] playback sample', {
        type: data && (data.type || data.event || data.name || data.action || ''),
        position: position,
        duration: duration,
        remaining: remaining,
        paused: paused
      });

      // Spotify can stop dispatching a dedicated ended message. Treat a paused
      // position at/near the duration as completion.
      if (position >= duration - 750 && paused === true) {
        emitEnded(position, duration, 'position-threshold');
      }
    }
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;

    var origin = event.origin || '';
    if (origin && origin !== 'https://open.spotify.com' && origin !== 'https://open.spotify.com/') {
      return;
    }

    console.log('[SPOTIFY BRIDGE] raw message', data);

    var type = data.type || data.event || data.name || data.action || '';
    if (type === 'playback_started' || type === 'playback_start' || type === 'play') {
      endedSent = false;
    }

    inspectPlayback(data);

    // Forward known playback events, regardless of the exact payload envelope.
    if (
      type === 'playback_started' ||
      type === 'playback_start' ||
      type === 'playback_update' ||
      type === 'playback_paused' ||
      type === 'playback_resumed' ||
      type === 'playback_stopped' ||
      type === 'ready'
    ) {
      forward(type, normalize(data) || data);
    }
  });

  console.log('[SPOTIFY BRIDGE] ready', { trackId: trackId });
})();
