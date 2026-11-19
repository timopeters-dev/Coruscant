import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { getFinanzCockpitBridgeConfig } from "@/lib/integrations/finanz-cockpit-client";
import { isDevMode } from "@/lib/server/dev-mode";

export const dynamic = "force-dynamic";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Coruscant — Haushalts- & Vermögens-Zentrale",
  description:
    "Local-First Haushalts-, Vertrags-, Dokumenten- und Vermögens-Zentrale.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { publicUrl } = getFinanzCockpitBridgeConfig();
  const devMode = isDevMode();

  return (
    <html lang="de" suppressHydrationWarning className={inter.variable}>
      <body className="antialiased">
        <ThemeProvider>
          <AppShell finanzCockpitUrl={publicUrl} devMode={devMode}>
            {children}
          </AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
