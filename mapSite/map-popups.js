// One popup per map: hover previews a location; a click pins it until dismissed.
export function createMapPopups(L, map, { document = globalThis.document, closeDelay = 180 } = {}) {
  let current = null;
  let destroyed = false;
  let pinned = false;
  let timer;
  let popupElement;
  let popupMargins;
  let contentSizing;
  let popupObserver;
  let owner;
  const registrations = new Set();
  const cancelClose = () => { clearTimeout(timer); timer = undefined; };
  const leave = () => { if (!pinned) { cancelClose(); timer = setTimeout(close, closeDelay); } };
  function detachPopup() {
    popupObserver?.disconnect(); popupObserver = undefined;
    popupElement?.removeEventListener('mouseenter', cancelClose);
    popupElement?.removeEventListener('mouseleave', leave);
    if (popupElement && popupMargins) {
      popupElement.style.marginLeft = popupMargins.left;
      popupElement.style.marginBottom = popupMargins.bottom;
      popupElement.classList.remove('needmap-popup-constrained');
    }
    if (contentSizing) Object.assign(contentSizing.element.style, contentSizing.original);
    popupMargins = undefined; contentSizing = undefined;
    popupElement = undefined;
  }
  function constrainPinnedProposal() {
    if (!pinned || !current?.options.autoPan || !popupElement) return;
    const frame = map.getContainer().getBoundingClientRect?.();
    if (!frame || !(frame.width > 0 && frame.height > 0)) return;
    if (!popupMargins) popupMargins = { left: popupElement.style.marginLeft || '', bottom: popupElement.style.marginBottom || '' };
    // Always measure from Leaflet's original anchor, never accumulate offsets.
    popupElement.style.marginLeft = popupMargins.left;
    popupElement.style.marginBottom = popupMargins.bottom;
    const content = popupElement.querySelector('.leaflet-popup-content');
    if (content) {
      if (!contentSizing) contentSizing = { element: content, original: {
        maxWidth: content.style.maxWidth || '', maxHeight: content.style.maxHeight || '', overflowY: content.style.overflowY || '',
      } };
      content.style.maxWidth = `${Math.max(32, frame.width - 80)}px`;
      content.style.maxHeight = `${Math.max(32, frame.height - 72)}px`;
      content.style.overflowY = 'auto';
    }
    const rectangle = popupElement.getBoundingClientRect?.();
    if (!rectangle || !(rectangle.width > 0 && rectangle.height > 0)) return;
    const padding = 12;
    const dx = Math.max(frame.left + padding - rectangle.left, Math.min(0, frame.right - padding - rectangle.right));
    const dy = Math.max(frame.top + padding - rectangle.top, Math.min(0, frame.bottom - padding - rectangle.bottom));
    const computed = document?.defaultView?.getComputedStyle?.(popupElement);
    if (dx) popupElement.style.marginLeft = `${(parseFloat(computed?.marginLeft) || 0) + dx}px`;
    if (dy) popupElement.style.marginBottom = `${(parseFloat(computed?.marginBottom) || 0) - dy}px`;
    // A displaced box cannot truthfully point at the marker with its old tip.
    popupElement.classList.toggle('needmap-popup-constrained', Boolean(dx || dy));
  }
  function reset() { cancelClose(); detachPopup(); current = null; owner = undefined; pinned = false; }
  function close() { const popup = current; reset(); if (popup) map.closePopup(popup); }
  function openAt(coordinates, content, { pin = true, source, autoPanOnPin = false } = {}) {
    if (destroyed || (pinned && !pin)) return;
    close();
    pinned = pin;
    owner = source;
    current = L.popup({ autoPan: pin && autoPanOnPin, autoPanPadding: [16, 16], closeOnClick: false }).setLatLng(coordinates).setContent(typeof content === 'function' ? content() : content).openOn(map);
    popupElement = current.getElement?.();
    popupElement?.addEventListener('mouseenter', cancelClose);
    popupElement?.addEventListener('mouseleave', leave);
    const ResizeObserver = document?.defaultView?.ResizeObserver;
    if (autoPanOnPin && popupElement && ResizeObserver) {
      popupObserver = new ResizeObserver(constrainPinnedProposal);
      popupObserver.observe(popupElement);
    }
    constrainPinnedProposal();
  }
  function register(marker, content, { autoPanOnPin = false } = {}) {
    if (destroyed) return () => {};
    const enter = () => {
      cancelClose();
      if (owner === marker && current) return;
      openAt(marker.getLatLng(), content, { pin: false, source: marker, autoPanOnPin });
    };
    const click = (event) => {
      if (event.originalEvent) L.DomEvent?.stopPropagation(event.originalEvent);
      if (owner === marker && current) {
        cancelClose();
        if (!pinned) {
          pinned = true;
          if (autoPanOnPin) {
            current.options.autoPan = true;
            // Opted-in proposal previews stay stationary until selected.
            // Then bring their entire popup inside the map using Leaflet.
            current.update?.();
            constrainPinnedProposal();
          }
        }
        return;
      }
      openAt(marker.getLatLng(), content, { source: marker, autoPanOnPin });
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
  map.on('moveend zoomend resize', constrainPinnedProposal);
  document?.addEventListener('click', onOutsideClick, true);
  return {
    register, openAt, close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close();
      for (const dispose of [...registrations]) dispose();
      map.off('click', close).off('popupclose', onPopupClose);
      map.off('moveend zoomend resize', constrainPinnedProposal);
      document?.removeEventListener('click', onOutsideClick, true);
    },
  };
}
