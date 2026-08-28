import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dz.wassilha.app',
  appName: 'Wassilha',
  // Static folder used by `npx cap sync`. The app itself loads the remote
  // production URL below, so these assets are only a lightweight fallback.
  webDir: 'public',
  server: {
    url: 'https://wassilha.vercel.app'
  }
};

export default config;