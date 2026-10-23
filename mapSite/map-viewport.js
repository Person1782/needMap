const MAX_LATITUDE = 85.0511287798;
export const MAP_WORLD_BOUNDS = Object.freeze([
  Object.freeze([-MAX_LATITUDE, -180]),
  Object.freeze([MAX_LATITUDE, 180]),
]);
export const MAP_VIEWPORT_OPTIONS = Object.freeze({
  maxBounds: MAP_WORLD_BOUNDS,
  maxBoundsViscosity: 1,
  bounceAtZoomLimits: false,
});

/** Keep a single, non-wrapping map world large enough to fill its viewport. */
export function attachMapViewport(map) {
  const container = map.getContainer();
  const initialMinimum = map.getMinZoom();
  const baseMinimum = Number.isFinite(initialMinimum) ? initialMinimum : 0;
  let destroyed = false;
  let updating = false;
  let observer;

  function visible() { return container.clientWidth > 0 && container.clientHeight > 0; }
  function constrainCenter() {
    if (Number.isFinite(map.getZoom())) map.panInsideBounds(MAP_WORLD_BOUNDS, { animate: false });
  }
  function refresh() {
    if (destroyed || updating || !visible()) return;
    updating = true;
    try {
      // getSize caches dimensions; refresh that cache before measuring.
      map.invalidateSize({ pan: false, animate: false });
      const size = map.getSize();
      if (!(size.x > 0 && size.y > 0)) return;
      const northWest = map.project([MAX_LATITUDE, -180], 0);
      const southEast = map.project([-MAX_LATITUDE, 180], 0);
      const worldWidth = Math.abs(southEast.x - northWest.x);
      const worldHeight = Math.abs(southEast.y - northWest.y);
      if (!(worldWidth > 0 && worldHeight > 0)) return;
      // Calculate without getBoundsZoom: it clamps to the previous minimum,
      // preventing the minimum from decreasing when the viewport shrinks.
      const scale = Math.max((size.x + 2) / worldWidth, (size.y + 2) / worldHeight);
      const coverageZoom = map.getScaleZoom(scale, 0);
      if (!Number.isFinite(coverageZoom)) return;
      const snap = map.options?.zoomSnap ?? 1;
      const rounded = snap > 0 ? Math.ceil((coverageZoom - 1e-10) / snap) * snap : coverageZoom;
      const minimum = Math.min(map.getMaxZoom(), Math.max(baseMinimum, rounded));
      if (map.getMinZoom() !== minimum) {
        // Leaflet setMinZoom implicitly animates upward when needed. Its queued
        // animation can overwrite a region fit made immediately afterward.
        // Elevate synchronously first so updating the constraint queues no zoom.
        const currentZoom = map.getZoom();
        if (Number.isFinite(currentZoom) && currentZoom < minimum) map.setZoom(minimum, { animate: false });
        map.setMinZoom(minimum);
      }
      constrainCenter();
    } finally {
      updating = false;
    }
  }
  function onMove(event) {
    // Normal mouse dragging and inertia already obey maxBoundsViscosity.
    // Native TouchZoom can translate its center past the edge between frames.
    if (!event.pinch || destroyed || updating || !visible()) return;
    updating = true;
    try { constrainCenter(); } finally { updating = false; }
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    map.off('resize', refresh).off('load', refresh).off('move', onMove).off('remove', destroy);
  }
  map.on('resize', refresh).on('load', refresh).on('move', onMove).on('remove', destroy);
  const Observer = container.ownerDocument?.defaultView?.ResizeObserver || globalThis.ResizeObserver;
  if (Observer) {
    observer = new Observer(refresh);
    observer.observe(container);
  }
  refresh();
  return { refresh, destroy };
}
