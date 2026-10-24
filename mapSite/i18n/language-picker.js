import { SUPPORTED_LANGUAGES } from "./index.js";

const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function createLanguagePicker({ i18n, document = globalThis.document, onBeforeSelect } = {}) {
  const toggle = document.getElementById("change-language");
  const menu = document.getElementById("language-menu");
  const search = document.getElementById("language-search");
  const results = document.getElementById("language-results");
  const listeners = [];
  let destroyed = false;
  const listen = (target, type, callback) => { target.addEventListener(type, callback); listeners.push(() => target.removeEventListener(type, callback)); };
  function render() {
    if (destroyed) return;
    const query = normalize(search.value);
    const matches = SUPPORTED_LANGUAGES.filter((item) => normalize(`${item.englishName} ${item.nativeName} ${item.code}`).includes(query));
    toggle.querySelector("span").textContent = i18n.language.nativeName;
    toggle.setAttribute("aria-label", `${i18n.t("language.button")}: ${i18n.language.nativeName}`);
    menu.setAttribute("aria-label", i18n.t("language.menu"));
    document.querySelector('label[for="language-search"]').textContent = i18n.t("language.searchLabel");
    search.placeholder = i18n.t("language.searchPlaceholder");
    results.setAttribute("aria-label", i18n.t("language.results"));
    results.replaceChildren();
    for (const item of matches) {
      const row = document.createElement("li"), button = document.createElement("button");
      button.type = "button"; button.dataset.language = item.code;
      button.setAttribute("lang", item.code); button.setAttribute("dir", item.direction);
      if (item.code === i18n.code) button.setAttribute("aria-current", "true");
      const native = document.createElement("strong"), english = document.createElement("span");
      native.textContent = item.nativeName; english.textContent = item.englishName;
      button.append(native, english); row.append(button); results.append(row);
    }
    const status = document.getElementById("language-search-status");
    if (status.dataset.error !== "true") status.textContent = matches.length ? "" : i18n.t("language.noMatches");
  }
  function close({ restoreFocus = false } = {}) {
    const wasOpen = !menu.hidden; menu.hidden = true; toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus && wasOpen) toggle.focus();
  }
  function open() { menu.hidden = false; toggle.setAttribute("aria-expanded", "true"); search.value = ""; const status = document.getElementById("language-search-status"); status.dataset.error = "false"; status.textContent = ""; render(); search.focus(); }
  listen(toggle, "click", () => menu.hidden ? open() : close());
  listen(search, "input", () => { document.getElementById("language-search-status").dataset.error = "false"; render(); });
  listen(search, "keydown", (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const buttons = [...results.querySelectorAll("button")]; if (!buttons.length) return;
    event.preventDefault(); (event.key === "ArrowDown" ? buttons[0] : buttons.at(-1)).focus();
  });
  listen(results, "click", async (event) => {
    const button = event.target.closest("button[data-language]");
    if (!button) return;
    const status = document.getElementById("language-search-status");
    status.dataset.error = "false"; status.textContent = "";
    try {
      onBeforeSelect?.(button.dataset.language);
      await i18n.select(button.dataset.language); close({ restoreFocus: true });
    }
    catch { status.dataset.error = "true"; status.textContent = i18n.t("language.loadError"); }
  });
  listen(results, "keydown", (event) => {
    const buttons = [...results.querySelectorAll("button")], index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next].focus(); }
  });
  listen(document, "keydown", (event) => { if (event.key === "Escape" && !menu.hidden) close({ restoreFocus: true }); });
  listen(document, "click", (event) => { if (!event.target.closest(".language-navigation")) close(); });
  const unsubscribe = i18n.subscribe(render); render();
  return { open, close, render, destroy() { destroyed = true; unsubscribe(); listeners.forEach((remove) => remove()); } };
}
