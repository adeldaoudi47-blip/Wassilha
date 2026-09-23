import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dz.wassilha.app',
  appName: 'Wassilha',
  // Static folder used by `npx cap sync`. The app itself loads the remote
  // production URL below, so these assets are only a lightweight fallback.
  webDir: 'public',
  server: {
    url: 'https://wassilha.vercel.app'
  },
  plugins: {
    PushNotifications: {
      // *** CRITICAL for the Android system tray ***
      // The native @capacitor/push-notifications plugin only builds and
      // posts a *system* notification when `presentationOptions` is present
      // (PushNotificationsPlugin.java: `if (presentation != null) { ... notify() }`).
      // Without this key the plugin fires the `pushNotificationReceived` JS
      // event but never hands anything to NotificationManager, which is why
      // notifications showed in the in-app center yet never appeared in the
      // top bar. `alert` is the Android banner; `banner`/`list` cover the
      // newer iOS presentation; `badge`+`sound` keep the icon counter and
      // the default ringtone.
      presentationOptions: ['badge', 'sound', 'alert', 'banner', 'list'],
    },
    LocalNotifications: {
      // Used by the foreground re-post path. Android requires a small status
      // bar icon or the notification renders as a plain square; without an
      // explicit iconColor some OEM skins show it greyscale.
      smallIcon: 'ic_launcher',
      iconColor: '#0E6B5E',
      // Ringtones live in android/app/src/main/res/raw; 'default' plays the
      // user's system notification sound rather than silence.
      sound: 'default',
    },
  },
};

export default config;