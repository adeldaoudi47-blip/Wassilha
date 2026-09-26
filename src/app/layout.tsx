import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
// Leaflet's default stylesheet (required for tiles, zoom controls, attribution).
// Imported globally so the map renders correctly in every route that uses
// <LiveMap />.
import "leaflet/dist/leaflet.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { PushPermissionBootstrap } from "@/components/wassilha/push-permission-bootstrap";
import { ForceUpdateGate } from "@/components/wassilha/force-update-gate";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "وَصِّلها · WASSILHA — نقل بضائعك بثقة في القرارة",
  description:
    "منصة النقل المحلية بالدراجة ثلاثية العجلات (Triporteur) لنقل كل أنواع البضائع بسرعة وأمان في القرارة - غرداية. اطلب، تتبع، وادفع بكل ثقة.",
  keywords: [
    "WASSILHA",
    "وَصِّلها",
    "Triporteur",
    "القرارة",
    "غرداية",
    "نقل البضائع",
    "الجزائر",
    "delivery",
    "El Guerrara",
    "Ghardaïa",
  ],
  authors: [{ name: "WASSILHA" }],
  // Favicon is provided by src/app/icon.tsx (renders the official
  // BrandLogo as a PNG, matching the Onboarding/splash screen and
  // every app header across the app). The previous Z.ai blue "Z"
  // placeholder has been removed.
  openGraph: {
    title: "وَصِّلها · WASSILHA",
    description: "نقل بضائعك بثقة في القرارة - غرداية",
    siteName: "WASSILHA",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0E6B5E",
  width: "device-width",
  initialScale: 1,
  // Allow users to zoom in (essential for the Leaflet-based LiveMap; the
  // previous maximumScale=1 was a PWA-era relic and is no longer needed).
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {/* PWA / iOS home-screen install support.
            - `apple-mobile-web-app-capable` is what makes an iOS Safari
              "Add to Home Screen" launch standalone instead of in a browser
              chrome.
            - `theme-color` is declared here (and mirrored in app/manifest.ts)
              so the browser/OS chrome matches the brand on mobile.
            The previous inline script in this slot force-unregistered every
            service worker on each load (a PWA-era workaround for a stale-cache
            bug). It was removed together with public/sw.js: with no service
            worker registered anywhere in the app, that script could only ever
            undo a future one. If a deliberate offline strategy is added later,
            reintroduce caching deliberately — never as a blanket unregister. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="WASSILHA" />
        <meta name="theme-color" content="#0E6B5E" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        {/* All app feedback flows through sonner (auth-flow, customer/driver/admin).
            Its display component was never mounted, so every toast was invisible. */}
        <SonnerToaster position="top-center" richColors closeButton />
        <Toaster />
        {/* FCM bootstrap: wires up push listeners and, once the user is
            signed in, requests notification permission + registers the
            device token with our backend. No-op on the web. */}
        <PushPermissionBootstrap />
        {/* Force update: on a native shell this asks /api/version on every
            cold start and hard-blocks an outdated build behind a modal that
            can only be dismissed by downloading the new APK. Skipped on the
            web, where the served bundle is always the newest. */}
        <ForceUpdateGate />
      </body>
    </html>
  );
}
// Vercel wake up

// Vercel trigger
