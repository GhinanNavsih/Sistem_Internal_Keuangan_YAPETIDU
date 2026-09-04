import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import QueryProvider from "@/lib/queries/QueryProvider";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import Script from "next/script";

const inter = {
  variable: "font-sans",
};

const isProduction = process.env.NODE_ENV === "production";

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: "BAK UNIPDU Payroll",
  description: "Internal payroll system for BAK UNIPDU",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "BAK Payroll",
  },
  icons: {
    icon: "/Logo YAPETIDU (Transparent bg).png",
    shortcut: "/Logo YAPETIDU (Transparent bg).png",
    apple: "/Logo YAPETIDU (Transparent bg).png",
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={`${inter.variable} antialiased`}>
      <body className="font-sans min-h-screen bg-slate-50">
        <QueryProvider>
          <AuthProvider>
            <ImpersonationBanner />
            {children}
          </AuthProvider>
        </QueryProvider>
        <Script id="register-sw" strategy="afterInteractive">
          {`
            if ('serviceWorker' in navigator) {
              if (${isProduction}) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(
                    function(registration) {
                      console.log('ServiceWorker registration successful with scope: ', registration.scope);
                    },
                    function(err) {
                      console.log('ServiceWorker registration failed: ', err);
                    }
                  );
                });
              } else {
                // Do not let a previously installed production worker serve
                // stale route HTML while running the development server.
                navigator.serviceWorker.getRegistrations().then(function(registrations) {
                  registrations.forEach(function(registration) {
                    registration.unregister();
                  });
                });
                if ('caches' in window) {
                  caches.keys().then(function(keys) {
                    return Promise.all(keys
                      .filter(function(key) { return key.indexOf('bak-payroll-cache-') === 0; })
                      .map(function(key) { return caches.delete(key); }));
                  });
                }
              }
            }
          `}
        </Script>
      </body>
    </html>
  );
}
