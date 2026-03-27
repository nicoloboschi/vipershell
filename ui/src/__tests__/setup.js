import '@testing-library/jest-dom'

// Stub navigator.serviceWorker for utils.ts module-level registration
if (!('serviceWorker' in navigator)) {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register: () => Promise.reject(new Error('no SW in tests')) },
    writable: true,
  })
}
