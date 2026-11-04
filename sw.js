// NaNa: службовий файл, щоб сайт можна було встановити як застосунок на телефон.
// Нічого не кешує — завжди завантажується свіжа версія сайту.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
