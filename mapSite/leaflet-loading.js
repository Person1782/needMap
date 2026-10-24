/** Track real Leaflet tile request cycles without retaining a removed map. */
export function trackLeafletTileLayer(layer, {
  onLoading,
  key = "map-tiles",
  label = "Loading map…",
  delayMs = 80,
  target,
} = {}) {
  if (!layer?.on || !layer?.off || typeof onLoading !== "function") return () => {};
  let release;
  let disposed = false;
  const begin = () => {
    if (disposed || release) return;
    const currentLabel = typeof label === "function" ? label() : label;
    release = onLoading({ key, label: currentLabel, delayMs, target, appearance: "map" }) || (() => {});
  };
  const end = () => {
    const current = release;
    release = undefined;
    current?.();
  };
  layer.on("loading", begin);
  layer.on("load", end);
  return () => {
    if (disposed) return;
    disposed = true;
    layer.off("loading", begin);
    layer.off("load", end);
    end();
  };
}
