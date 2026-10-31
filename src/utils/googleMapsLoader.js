/**
 * googleMapsLoader.js
 * Asynchronous loader for Google Maps JavaScript API and Street View helpers.
 */

let loadPromise = null;
let currentLoadedKey = null;

const STORAGE_KEY = 'google_maps_api_key';

export function getStoredGoogleMapsApiKey() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {}
  return (import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || '').trim();
}

export function saveGoogleMapsApiKey(key) {
  try {
    if (key && key.trim()) {
      localStorage.setItem(STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

/**
 * Loads the Google Maps JS SDK dynamically using the active API key.
 */
export function loadGoogleMapsApi(apiKey = null) {
  const keyToUse = apiKey || getStoredGoogleMapsApiKey();

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (loadPromise && currentLoadedKey === keyToUse) {
    return loadPromise;
  }

  currentLoadedKey = keyToUse;
  loadPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById('google-maps-sdk-script');
    if (existingScript) existingScript.remove();

    const script = document.createElement('script');
    script.id = 'google-maps-sdk-script';
    const keyParam = keyToUse ? `&key=${encodeURIComponent(keyToUse)}` : '';
    script.src = `https://maps.googleapis.com/maps/api/js?v=weekly&loading=async${keyParam}`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error('Google Maps SDK loaded, but window.google.maps is undefined.'));
      }
    };

    script.onerror = (err) => {
      loadPromise = null;
      reject(new Error(`Failed to load Google Maps SDK: ${err?.message || 'Network error'}`));
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}

export function clearGoogleMapsScript() {
  const script = document.getElementById('google-maps-sdk-script');
  if (script) script.remove();
  loadPromise = null;
  currentLoadedKey = null;
}

export function getStreetViewEmbedUrl(lat, lng, heading = 0) {
  return `https://maps.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=11,${heading},0,0,0&output=svembed`;
}
