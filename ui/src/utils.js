/**
 * Replaces /Users/<username> or /home/<username> with ~ in a path.
 * @param {string|null|undefined} path
 * @param {string} [username]
 * @returns {string|null|undefined}
 */
export function tildefy(path, username) {
  if (!path) return path;
  if (!username) return path;
  for (const home of [`/Users/${username}`, `/home/${username}`]) {
    if (path === home) return '~';
    if (path.startsWith(home + '/')) return '~/' + path.slice(home.length + 1);
  }
  return path;
}

let _swRegistration = null;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    _swRegistration = reg;
  }).catch(() => {});
}

/**
 * Shows a browser/system notification if permission is granted and the window is not focused.
 * Uses the service worker registration when available (required for mobile).
 * @param {string} title
 * @param {string} body
 */
export function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  if (_swRegistration) {
    _swRegistration.showNotification(title, { body });
  } else {
    new Notification(title, { body });
  }
}

/**
 * Returns a short human-readable relative time string (e.g. "2m ago").
 * @param {number|null|undefined} ts  Unix ms timestamp
 */
export function relativeTime(ts) {
  if (!ts) return null;
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10)  return 'just now';
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Requests notification permission if not yet decided.
 */
export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
