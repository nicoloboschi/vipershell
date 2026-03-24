export function tildefy(path: string | null | undefined, username?: string): string | null | undefined {
  if (!path) return path;
  if (!username) return path;
  for (const home of [`/Users/${username}`, `/home/${username}`]) {
    if (path === home) return '~';
    if (path.startsWith(home + '/')) return '~/' + path.slice(home.length + 1);
  }
  return path;
}

let _swRegistration: ServiceWorkerRegistration | null = null;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    _swRegistration = reg;
  }).catch(() => {});
}

export function notify(title: string, body: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  if (_swRegistration) {
    _swRegistration.showNotification(title, { body });
  } else {
    new Notification(title, { body });
  }
}

export function relativeTime(ts: number | null | undefined): string | null {
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

export function requestNotificationPermission(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
