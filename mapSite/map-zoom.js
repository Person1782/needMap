/** Keep trackpad/browser zoom gestures inside an interactive Leaflet map. */
export function attachMapZoom(map, scheduler = {}) {
  const container = map.getContainer();
  const host = container.ownerDocument?.defaultView || globalThis;
  const now = scheduler.now || (() => Date.now());
  const scheduleTimer = scheduler.setTimeout || globalThis.setTimeout.bind(globalThis);
  const cancelTimer = scheduler.clearTimeout || globalThis.clearTimeout.bind(globalThis);
  const requestFrame = scheduler.requestAnimationFrame || host.requestAnimationFrame?.bind(host)
    || ((callback) => scheduleTimer(callback, 16));
  const cancelFrame = scheduler.cancelAnimationFrame || host.cancelAnimationFrame?.bind(host) || cancelTimer;
  let destroyed = false;
  let wheelZoom;
  let wheelLast = -Infinity;
  let wheelTimer;
  let frame;
  let pending;
  let gesture;
  let touches = 0;
  let moving = false;
  let lastMove;

  const consume = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const clamp = (zoom) => Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), zoom));
  function anchorFor(event) {
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) return map.mouseEventToContainerPoint(event);
    return map.getSize().divideBy(2);
  }
  function cancelPending() {
    if (frame !== undefined) cancelFrame(frame);
    frame = undefined; pending = undefined;
  }
  function centerFor(anchor, zoom) {
    const centerPoint = map.getSize().divideBy(2);
    const anchorLatLng = map.containerPointToLatLng(anchor);
    return map.unproject(map.project(anchorLatLng, zoom).subtract(anchor.subtract(centerPoint)), zoom);
  }
  function queueZoom(zoom, anchor) {
    if (!Number.isFinite(zoom)) return;
    pending = { zoom: clamp(zoom), anchor };
    if (frame !== undefined) return;
    frame = requestFrame(applyPendingZoom);
  }
  function applyPendingZoom() {
    frame = undefined;
    const next = pending; pending = undefined;
    if (destroyed || !next) return;
    const zoom = clamp(next.zoom);
    if (Math.abs(zoom - map.getZoom()) <= 1e-9) return;
    const center = centerFor(next.anchor, zoom);
    if (!moving) {
      map._stop?.();
      map._moveStart?.(true, false);
      moving = true;
    }
    lastMove = { anchor: next.anchor, center, zoom };
    // This is the same continuous transform Leaflet uses for touchscreen
    // pinching. Keeping the fractional zoom avoids rebuilding tiles and SVG
    // boundaries at every quarter-step.
    if (map._move) map._move(center, zoom, { pinch: true, round: false });
    else map.setZoomAround(next.anchor, zoom, { animate: false });
  }
  function flushPendingZoom() {
    if (frame !== undefined) cancelFrame(frame);
    applyPendingZoom();
  }
  function finishMove() {
    if (!moving || !lastMove) return;
    const snap = map.options?.zoomSnap || 0;
    const target = clamp(snap > 0 ? Math.round(lastMove.zoom / snap) * snap : lastMove.zoom);
    const center = centerFor(lastMove.anchor, target);
    moving = false;
    lastMove = undefined;
    if (map.options?.zoomAnimation && map._animateZoom) map._animateZoom(center, target, true, snap);
    else if (map._resetView) map._resetView(center, target);
    else map.setZoomAround(map.getSize().divideBy(2), target, { animate: false });
  }
  function endWheel() {
    flushPendingZoom();
    finishMove();
    wheelZoom = undefined; wheelLast = -Infinity; wheelTimer = undefined;
  }
  function resetWheel() { cancelTimer(wheelTimer); wheelTimer = undefined; endWheel(); }
  function onWheel(event) {
    // Ordinary wheel scrolling is handled by Leaflet's own wheel handler.
    if (!event.ctrlKey && !event.metaKey) return;
    consume(event);
    if (gesture || touches >= 2) return;
    const delta = event.deltaY;
    if (!Number.isFinite(delta) || delta === 0) return;
    const time = now();
    if (wheelZoom === undefined || time - wheelLast >= 200) wheelZoom = map.getZoom();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (container.clientHeight || 800) : 1;
    wheelZoom = clamp(wheelZoom - delta * units / 100);
    wheelLast = time;
    cancelTimer(wheelTimer);
    wheelTimer = scheduleTimer(endWheel, 200);
    queueZoom(wheelZoom, anchorFor(event));
  }
  function onGestureStart(event) {
    consume(event);
    resetWheel(); cancelPending();
    gesture = { baseZoom: map.getZoom(), anchor: anchorFor(event), nativeTouch: touches >= 2 };
  }
  function onGestureChange(event) {
    consume(event);
    if (!gesture) return;
    // Safari emits high-level gestures alongside touch events. Leaflet owns
    // touchscreen pinching; only trackpad gestures need our zoom calculation.
    if (gesture.nativeTouch || touches >= 2) return;
    if (!Number.isFinite(event.scale) || event.scale <= 0) return;
    queueZoom(gesture.baseZoom + Math.log2(event.scale), gesture.anchor);
  }
  function onGestureEnd(event) {
    consume(event);
    // Finish the last gesture frame before a following wheel session reads
    // its starting zoom; otherwise that frame can be overwritten.
    if (gesture) {
      flushPendingZoom();
      finishMove();
    }
    gesture = undefined;
  }
  function onTouch(event) {
    touches = event.touches?.length || 0;
    if (touches >= 2) {
      if (gesture) gesture.nativeTouch = true;
      resetWheel(); cancelPending();
    }
  }
  const active = { capture: true, passive: false };
  const passive = { capture: true, passive: true };
  container.addEventListener('wheel', onWheel, active);
  container.addEventListener('gesturestart', onGestureStart, active);
  container.addEventListener('gesturechange', onGestureChange, active);
  container.addEventListener('gestureend', onGestureEnd, active);
  for (const type of ['touchstart', 'touchend', 'touchcancel']) container.addEventListener(type, onTouch, passive);
  return function detachMapZoom() {
    if (destroyed) return;
    destroyed = true;
    cancelTimer(wheelTimer); wheelTimer = undefined;
    wheelZoom = undefined; wheelLast = -Infinity;
    cancelPending(); moving = false; lastMove = undefined; gesture = undefined;
    container.removeEventListener('wheel', onWheel, true);
    container.removeEventListener('gesturestart', onGestureStart, true);
    container.removeEventListener('gesturechange', onGestureChange, true);
    container.removeEventListener('gestureend', onGestureEnd, true);
    for (const type of ['touchstart', 'touchend', 'touchcancel']) container.removeEventListener(type, onTouch, true);
  };
}
