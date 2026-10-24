const noop = () => {};

/**
 * Shows indeterminate progress inside each part of the dashboard doing work.
 * Every start call owns its release function, including calls sharing a key.
 */
export function createLoadingBar({
  document = globalThis.document,
  defaultTarget,
  resolveTarget,
  initialKey = null,
  initialTarget,
  defaultLabel = "Loading…",
  minimumVisibleMs = 220,
  now = () => Date.now(),
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  if (!document?.createElement) throw new TypeError("A document is required for contextual loading.");

  const activities = new Map();
  const keyed = new Map();
  const panels = new Map();
  let sequence = 0;
  let panelSequence = 0;
  let revealTimer;
  let fallback = defaultLabel;
  let destroyed = false;

  function clearReveal() {
    if (revealTimer !== undefined) clearTimer(revealTimer);
    revealTimer = undefined;
  }

  function labelFor(activity) {
    const value = typeof activity?.label === "function" ? activity.label() : activity?.label;
    return value || fallback;
  }

  function targetFor(key, requested) {
    let target = requested;
    if (typeof target === "string") target = document.querySelector(target);
    if (!target && typeof resolveTarget === "function") target = resolveTarget(String(key));
    if (typeof target === "string") target = document.querySelector(target);
    if (!target) target = typeof defaultTarget === "string" ? document.querySelector(defaultTarget) : defaultTarget;
    return target?.append && target?.classList ? target : null;
  }

  function createTrack(document) {
    const track = document.createElement("span");
    track.className = "context-loading-track";
    const fill = document.createElement("span");
    fill.className = "context-loading-fill";
    fill.setAttribute("aria-hidden", "true");
    track.append(fill);
    return track;
  }

  function makePanel(target, appearance) {
    let state = panels.get(target);
    if (state && (state.panel.dataset.loadingFor || state.panel.parentElement === target)) return state;
    if (state) {
      clearHide(state);
      panels.delete(target);
    }

    const reserved = target.id && document.querySelector(`[data-loading-for="${target.id}"]`);
    const panel = reserved || document.createElement("div");
    const status = Boolean(reserved) || appearance === "status";
    panel.classList.add("context-loading", status ? "context-loading-status" : "context-loading-card");
    if (appearance === "map") panel.classList.add("context-loading-map");
    panel.setAttribute("aria-hidden", "true");

    let label = panel.querySelector(".context-loading-label");
    if (!label) {
      label = document.createElement("span");
      label.className = "context-loading-label";
      panel.append(label);
    }
    let track = panel.querySelector(".context-loading-track");
    if (!track) {
      track = createTrack(document);
      panel.append(track);
    }
    if (!reserved) {
      label.id = `context-loading-label-${++panelSequence}`;
      label.setAttribute("role", "status");
      label.setAttribute("aria-live", "polite");
      label.setAttribute("aria-atomic", "true");
      track.setAttribute("aria-labelledby", label.id);
      target.classList.add("context-loading-surface");
      target.append(panel);
    }
    const created = {
      panel,
      label,
      track,
      status,
      busyTarget: reserved
        ? (target.matches?.("[aria-live], [role=status]") ? target.parentElement : panel.parentElement)
        : target,
      visibleSince: null,
      hideTimer: undefined,
    };
    panels.set(target, created);
    return created;
  }

  function clearHide(state) {
    if (state.hideTimer !== undefined) clearTimer(state.hideTimer);
    state.hideTimer = undefined;
  }

  function applyPanel(state, activity) {
    clearHide(state);
    const label = labelFor(activity);
    state.label.textContent = label;
    state.label.hidden = state.status;
    state.track.setAttribute("role", "progressbar");
    if (!state.track.hasAttribute("aria-labelledby")) state.track.setAttribute("aria-label", label);
    state.track.setAttribute("aria-valuetext", label);
    state.panel.classList.add("is-loading");
    state.panel.setAttribute("aria-hidden", "false");
    if (state.visibleSince === null) state.visibleSince = now();
    state.busyTarget?.setAttribute("aria-busy", "true");
  }

  function hidePanel(target, state) {
    clearHide(state);
    state.panel.classList.remove("is-loading");
    state.panel.setAttribute("aria-hidden", "true");
    state.track.removeAttribute("role");
    state.track.removeAttribute("aria-label");
    state.track.removeAttribute("aria-valuetext");
    state.visibleSince = null;
    state.busyTarget?.removeAttribute("aria-busy");
    if (!state.status && target.isConnected === false) {
      state.panel.remove();
      panels.delete(target);
    }
  }

  function scheduleHide(target, state) {
    if (!state.panel.classList.contains("is-loading") || state.hideTimer !== undefined) return;
    const remaining = state.status ? 0 : Math.max(0, minimumVisibleMs - (now() - (state.visibleSince ?? now())));
    if (!remaining) hidePanel(target, state);
    else state.hideTimer = setTimer(() => {
      state.hideTimer = undefined;
      if (!destroyed && ![...activities.values()].some((activity) => activity.target === target && activity.showAt <= now())) {
        hidePanel(target, state);
      }
    }, remaining);
  }

  function sync() {
    if (destroyed) return;
    clearReveal();
    const time = now();
    const current = new Map();
    let nextReveal = Infinity;

    for (const activity of activities.values()) {
      if (activity.showAt > time) {
        nextReveal = Math.min(nextReveal, activity.showAt);
        continue;
      }
      if (!activity.target) continue;
      const previous = current.get(activity.target);
      if (!previous || activity.sequence > previous.sequence) current.set(activity.target, activity);
    }

    for (const [target, activity] of current) applyPanel(makePanel(target, activity.appearance), activity);
    for (const [target, state] of panels) {
      if (current.has(target)) continue;
      if (target.isConnected === false) {
        clearHide(state);
        state.panel.remove();
        panels.delete(target);
      } else scheduleHide(target, state);
    }
    if (Number.isFinite(nextReveal)) revealTimer = setTimer(sync, Math.max(0, nextReveal - time));
  }

  function start(key = "loading", activityLabel = fallback, { delayMs = 0, target, appearance } = {}) {
    if (destroyed) return noop;
    const token = Symbol(String(key));
    const activity = {
      key: String(key),
      label: activityLabel || fallback,
      target: targetFor(key, target),
      appearance,
      sequence: ++sequence,
      showAt: now() + Math.max(0, Number(delayMs) || 0),
    };
    activities.set(token, activity);
    sync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activities.delete(token);
      sync();
    };
  }

  function set(key, active, activityLabel = fallback, options) {
    const normalized = String(key);
    if (active) {
      if (!keyed.has(normalized)) keyed.set(normalized, start(normalized, activityLabel, options));
      else {
        const matching = [...activities.values()].find((activity) => activity.key === normalized);
        if (matching) {
          matching.label = activityLabel || fallback;
          matching.sequence = ++sequence;
          const nextTarget = targetFor(normalized, options?.target);
          if (nextTarget) matching.target = nextTarget;
          if (options?.appearance) matching.appearance = options.appearance;
          sync();
        }
      }
    } else {
      keyed.get(normalized)?.();
      keyed.delete(normalized);
    }
  }

  function setDefaultLabel(value) {
    fallback = value || "Loading…";
    sync();
  }

  if (initialKey) set(initialKey, true, defaultLabel, { target: initialTarget });
  else sync();

  return {
    start,
    set,
    finish(key) { set(key, false); },
    setDefaultLabel,
    refresh: sync,
    get activeCount() { return activities.size; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearReveal();
      activities.clear();
      keyed.clear();
      for (const [target, state] of panels) {
        clearHide(state);
        state.busyTarget?.removeAttribute("aria-busy");
        if (state.panel.dataset.loadingFor) {
          state.panel.classList.remove("is-loading");
          state.panel.setAttribute("aria-hidden", "true");
        } else {
          state.panel.remove();
          target.classList.remove("context-loading-surface");
        }
      }
      panels.clear();
    },
  };
}
