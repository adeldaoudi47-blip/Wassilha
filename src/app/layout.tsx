import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
