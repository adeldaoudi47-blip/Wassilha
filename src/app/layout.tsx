import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

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
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
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
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {/* Dev hygiene: this app previously shipped a service worker (PWA-era build).
            Stale registrations keep serving outdated bundles and break auth flows.
            Unregister any existing service workers on every load until a real PWA
            strategy is reintroduced deliberately. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){for(var i=0;i<rs.length;i++){rs[i].unregister();}}).catch(function(){});}",
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        {/* All app feedback flows through sonner (auth-flow, customer/driver/admin).
            Its display component was never mounted, so every toast was invisible. */}
        <SonnerToaster position="top-center" richColors closeButton />
        <Toaster />
      </body>
    </html>
  );
}
