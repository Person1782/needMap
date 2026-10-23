// One popup per map: hover previews a location; a click pins it until dismissed.
export function createMapPopups(L, map, { document = globalThis.document, closeDelay = 180 } = {}) {
  let current = null;
  let destroyed = false;
  let pinned = false;
  let timer;
  let popupElement;
  let owner;
  const registrations = new Set();
  const cancelClose = () => { clearTimeout(timer); timer = undefined; };
  const leave = () => { if (!pinned) { cancelClose(); timer = setTimeout(close, closeDelay); } };
  function detachPopup() {
    popupElement?.removeEventListener('mouseenter', cancelClose);
    popupElement?.removeEventListener('mouseleave', leave);
    popupElement = undefined;
  }
  function reset() { cancelClose(); detachPopup(); current = null; owner = undefined; pinned = false; }
  function close() { const popup = current; reset(); if (popup) map.closePopup(popup); }
  function openAt(coordinates, content, { pin = true, source } = {}) {
    if (destroyed || (pinned && !pin)) return;
    close();
    pinned = pin;
    owner = source;
    current = L.popup({ autoPan: false, closeOnClick: false }).setLatLng(coordinates).setContent(typeof content === 'function' ? content() : content).openOn(map);
    popupElement = current.getElement?.();
    popupElement?.addEventListener('mouseenter', cancelClose);
    popupElement?.addEventListener('mouseleave', leave);
  }
  function register(marker, content) {
    if (destroyed) return () => {};
    const enter = () => {
      cancelClose();
      if (owner === marker && current) return;
      openAt(marker.getLatLng(), content, { pin: false, source: marker });
    };
    const click = (event) => {
      if (event.originalEvent) L.DomEvent?.stopPropagation(event.originalEvent);
      if (owner === marker && current) { cancelClose(); pinned = true; return; }
      openAt(marker.getLatLng(), content, { source: marker });
    };
    const remove = () => dispose();
    const dispose = () => {
      if (owner === marker) close();
      marker.off('mouseover', enter).off('mouseout', leave).off('click', click).off('remove', remove);
      registrations.delete(dispose);
    };
    marker.on('mouseover', enter).on('mouseout', leave).on('click', click).on('remove', remove);
    registrations.add(dispose);
    return dispose;
  }
  const onPopupClose = (event) => { if (event.popup === current) reset(); };
  const onOutsideClick = (event) => { if (!map.getContainer().contains(event.target)) close(); };
  map.on('click', close).on('popupclose', onPopupClose);
  document?.addEventListener('click', onOutsideClick, true);
  return {
    register, openAt, close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close();
      for (const dispose of [...registrations]) dispose();
      map.off('click', close).off('popupclose', onPopupClose);
      document?.removeEventListener('click', onOutsideClick, true);
    },
  };
}
