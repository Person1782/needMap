import { WORLD_REGION } from "./region-navigation.js";

const worldAliases = ["worldwide", "world", "global", "all regions", "global regions"];
const normalizeSearch = (value) => String(value || "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();

/** Show Worldwide above all countries initially, then every matching region. */
export function createRegionPicker({ navigation, document = globalThis.document, i18n,
  dynamicTranslator, displayRegion, ids = {}, rootSelector = ".region-navigation" }) {
  const byId = (id) => document.getElementById(id);
  const names = {
    menu: "region-menu", search: "region-search", results: "region-results",
    toggle: "change-region", form: "region-search-form", status: "region-search-status",
    ...ids,
  };
  const menu = byId(names.menu);
  const search = byId(names.search);
  const results = byId(names.results);
  const toggle = byId(names.toggle);
  if (!menu || !search || !results || !toggle || !byId(names.form) || !byId(names.status)) {
    throw new TypeError("Region picker controls are incomplete.");
  }
  const listeners = [];
  let destroyed = false;
  const tr = (key, values, fallback) => i18n ? i18n.t(key, values) : fallback;
  const originalLabel = (region) => region?.label || region?.name || "";
  function countryLabel(region) {
    if (region?.kind !== "country") return "";
    const code = String(region.countryCode || region.id || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || typeof Intl?.DisplayNames !== "function") return "";
    try { return new Intl.DisplayNames([i18n?.code || "en"], { type: "region" }).of(code) || ""; }
    catch { return ""; }
  }
  function displayLabel(region) {
    const supplied = typeof displayRegion === "function" ? displayRegion(region, { language: i18n?.code || "en" }) : "";
    return supplied || region?.translatedLabel || region?.displayLabel || countryLabel(region) ||
      dynamicTranslator?.cached?.(originalLabel(region)) || originalLabel(region);
  }
  const localizedValues = (region) => [
    displayLabel(region), region?.translatedName, region?.translatedLabel,
    region?.displayName, region?.displayLabel,
  ].filter((value) => typeof value === "string" && value.trim());
  function localizedMatches(region, query) {
    const normalized = normalizeSearch(query);
    return normalized && localizedValues(region).some((value) => normalizeSearch(value).includes(normalized));
  }
  const listen = (target, type, callback) => {
    target.addEventListener(type, callback);
    listeners.push(() => target.removeEventListener(type, callback));
  };
  function render() {
    if (destroyed) return;
    const query = search.value;
    const searching = !!query.trim();
    const kind = searching ? undefined : "country";
    const catalogTotal = navigation.count(query, { kind });
    const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
    const worldLabel = displayLabel(WORLD_REGION);
    const includeWorld = !searching || worldAliases.some((alias) => alias.startsWith(normalized)) || localizedMatches(WORLD_REGION, query);
    results.replaceChildren(); results.scrollTop = 0;
    const localizedMatchesById = new Map();
    if (searching) {
      for (const region of navigation.search("", { kind, limit: Infinity })) {
        if (localizedMatches(region, query)) localizedMatchesById.set(region.id, region);
      }
    }
    const directMatches = navigation.search(query, { kind, limit: Infinity });
    const matchesById = new Map([...localizedMatchesById, ...directMatches.map((region) => [region.id, region])]);
    const catalogMatches = [...matchesById.values()];
    const total = catalogMatches.length + (includeWorld ? 1 : 0);
    const matches = [...(includeWorld ? [WORLD_REGION] : []), ...catalogMatches];
    const current = navigation.getSelected()?.id;
    matches.forEach((region) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const sourceLabel = originalLabel(region);
      const shownLabel = region.id === WORLD_REGION.id ? worldLabel : displayLabel(region);
      button.textContent = shownLabel;
      button.setAttribute("data-region-id", region.id);
      button.setAttribute("data-region-source-label", sourceLabel);
      if (dynamicTranslator?.bind && shownLabel === sourceLabel && region.kind !== "country") {
        dynamicTranslator.bind(button, sourceLabel, { sourceLanguage: "en" });
      }
      if (region.id === current) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => { if (!destroyed) navigation.select(region.id); });
      item.append(button); results.append(item);
    });
    byId(names.status).textContent = total
      ? searching ? tr("region.matching", { count: total }, `${total.toLocaleString()} matching region${total === 1 ? "" : "s"}.`)
        : tr("region.allCountries", { count: catalogTotal }, `Worldwide and ${catalogTotal.toLocaleString()} countries and territories.`)
      : tr("region.noMatches", {}, "No matching regions. Try a country, state, or a different spelling.");
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
  listen(byId(names.form), "submit", (event) => {
    event.preventDefault(); render(); results.querySelector("button")?.focus();
  });
  listen(document, "keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) { close(); toggle.focus(); }
  });
  listen(document, "click", (event) => { if (!event.target.closest(rootSelector)) close(); });
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
