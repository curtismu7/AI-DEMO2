// The app zooms the whole page for the text-size dial (documentElement.style.zoom, default 1.125, A+ up to 1.25;
// --app-zoom mirrors it for CSS). window.innerWidth/innerHeight and pointer coordinates are in window pixels, but
// left/top/width/height written into the page are in zoomed pixels, so anything positioned from the window size has
// to divide by the zoom or it lands that much too far right/down and overflows a narrow window.

export function getAppZoom() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom);
  return z > 0 ? z : 1;
}

/** The window's size in the page's own (zoomed) CSS pixels. */
export function getViewportCssSize() {
  const z = getAppZoom();
  return { w: window.innerWidth / z, h: window.innerHeight / z, zoom: z };
}
