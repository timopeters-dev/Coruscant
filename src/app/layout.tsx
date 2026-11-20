import type { Metadata } from "next";
import { Barlow, Barlow_Semi_Condensed } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/frontend/shell/theme-provider";
import { AppShell } from "@/frontend/shell/app-shell";
import { getFinanzCockpitBridgeConfig } from "@/backend/integrations/finanz-cockpit-client";
import { isDevMode } from "@/backend/dev-mode";

export const dynamic = "force-dynamic";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

const barlowSemiCondensed = Barlow_Semi_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow-sc",
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
    <html lang="de" suppressHydrationWarning className={`${barlow.variable} ${barlowSemiCondensed.variable}`}>
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
