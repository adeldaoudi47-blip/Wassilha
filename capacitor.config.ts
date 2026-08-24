import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dz.wassilha.app',
  appName: 'Wassilha',
  server: {
    url: 'http://172.16.0.2:3000',
    cleartext: true
  }
};

export default config;