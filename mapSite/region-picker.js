/** Show all countries initially and every matching region when searching. */
export function createRegionPicker({ navigation, document = globalThis.document }) {
  const byId = (id) => document.getElementById(id);
  const menu = byId("region-menu");
  const search = byId("region-search");
  const results = byId("region-results");
  const toggle = byId("change-region");
  const listeners = [];
  let destroyed = false;
  const listen = (target, type, callback) => {
    target.addEventListener(type, callback);
    listeners.push(() => target.removeEventListener(type, callback));
  };
  function render() {
    if (destroyed) return;
    const query = search.value;
    const searching = !!query.trim();
    const kind = searching ? undefined : "country";
    const total = navigation.count(query, { kind });
    results.replaceChildren(); results.scrollTop = 0;
    const matches = navigation.search(query, { kind, limit: Infinity });
    const current = navigation.getSelected()?.id;
    matches.forEach((region) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = region.label || region.name;
      button.setAttribute("data-region-id", region.id);
      if (region.id === current) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => { if (!destroyed) navigation.select(region.id); });
      item.append(button); results.append(item);
    });
    byId("region-search-status").textContent = total
      ? searching ? `${total.toLocaleString()} matching region${total === 1 ? "" : "s"}.`
        : `${total.toLocaleString()} countries and territories.`
      : "No matching regions. Try a country, state, or a different spelling.";
  }
  function close() {
    const wasOpen = !menu.hidden;
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (wasOpen && menu.contains(document.activeElement)) toggle.focus();
  }
  function open() {
    if (destroyed) return;
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    render(); search.focus();
  }
  listen(toggle, "click", () => menu.hidden ? open() : close());
  listen(search, "input", () => render());
  listen(byId("region-search-form"), "submit", (event) => {
    event.preventDefault(); render(); results.querySelector("button")?.focus();
  });
  listen(document, "keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) { close(); toggle.focus(); }
  });
  listen(document, "click", (event) => { if (!event.target.closest(".region-navigation")) close(); });
  listen(results, "keydown", (event) => {
    const buttons = [...results.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const next = event.key === "ArrowDown" ? (index + 1) % buttons.length
      : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length
      : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next].focus(); }
  });
  return { open, close, render, destroy() { destroyed = true; listeners.forEach((remove) => remove()); } };
}
