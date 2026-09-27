import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ToastProvider } from './components/Toast';
import { installAutoRetry } from './lib/uploadQueue';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

installAutoRetry();

/**
 * Keep the installed app current without anybody being told to refresh.
 *
 * The app is a PWA, so a service worker serves it from the phone. Until that worker notices a new
 * build, the phone keeps running the old one, which is why a deploy used to need a manual reload, and
 * sometimes two: one to fetch the new worker and another to get the new page. Now it asks whether
 * there is a new build whenever the shop comes back to the screen, and once a minute while it is
 * open, and updates itself when there is.
 *
 * Nothing in flight is lost by that: recordings and photos waiting to upload live in IndexedDB, and a
 * bill being reviewed is cached by its session id, so the review screen comes back as it was.
 */
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateSW(true);
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine !== false) void registration.update().catch(() => undefined);
    };
    window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
