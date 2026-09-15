(function () {
  'use strict';

  var trackId = '';
  var endedSent = false;

  try {
    trackId = new URLSearchParams(location.search).get('trackId') || '';
  } catch (e) {}

  function emitEnded(payload) {
    if (endedSent) return;
    endedSent = true;

    var detail = {
      trackId: trackId,
      source: payload && payload.source || 'spotify-embed',
      position: Number(payload && payload.position || 0),
      duration: Number(payload && payload.duration || 0)
    };

    console.log('[PLAYER ENDED] DETECTED', detail);

    try {
      window.dispatchEvent(new CustomEvent('queue-ended-local', { detail: detail }));
    } catch (e) {}

    if (window.parent !== window) {
      try {
        window.parent.postMessage({
          type: 'queue-ended',
          trackId: trackId,
          source: detail.source,
          position: detail.position,
          duration: detail.duration
        }, location.origin);
      } catch (e) {}
    }
  }

  function handlePlaybackUpdate(payload) {
    if (!payload || typeof payload !== 'object') return;

    var position = Number(payload.position);
    var duration = Number(payload.duration);
    var paused = payload.isPaused === true;

    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;

    var remaining = duration - position;
    if (paused && position > 0 && remaining <= 1200) {
      console.log('[PLAYER ENDED] playback_update near end', {
        trackId: trackId,
        position: position,
        duration: duration,
        remaining: remaining,
        isPaused: paused
      });

      emitEnded({
        source: 'playback_update-threshold',
        position: position,
        duration: duration
      });
    }
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data) return;

    var data = event.data;
    var type = data.type || data.event || '';
    var payload = data.payload || data.data || data;

    if (type === 'playback_started') {
      endedSent = false;
      console.log('[PLAYER ENDED] playback_started', {
        trackId: trackId,
        payload: payload
      });
      return;
    }

    if (type === 'playback_update') {
      handlePlaybackUpdate(payload);
      return;
    }

    if (type === 'spotify-ended') {
      console.log('[PLAYER ENDED] spotify-ended bridge event', {
        trackId: trackId,
        payload: payload
      });
      emitEnded({
        source: 'spotify-bridge',
        position: payload && payload.position,
        duration: payload && payload.duration
      });
      return;
    }

    if (type === 'stop-playback') {
      try {
        var frame = document.getElementById('spWidget');
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({ type: 'stop-playback' }, location.origin);
        }
      } catch (e) {}
      return;
    }
  });

  console.log('[PLAYER ENDED] bridge listener ready', {
    trackId: trackId
  });
})();
