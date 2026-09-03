import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui";

/**
 * Three families with clear jobs and no overlap:
 *   Instrument Serif - editorial display, used only for major headings
 *   Inter            - all application UI
 *   JetBrains Mono   - hashes, addresses, and technical detail
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  fallback: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "VerseFlow - Turn agreements into programmable payments",
    template: "%s · VerseFlow",
  },
  description:
    "VerseFlow helps clients and service providers turn real-world work agreements into transparent milestones, protected escrow, evidence-based approvals, and verifiable payment history.",
  keywords: [
    "escrow", "milestone payments", "freelance payments", "programmable payments",
    "Verse", "smart contract escrow", "work agreements",
  ],
  openGraph: {
    title: "VerseFlow - Turn agreements into programmable payments",
    description:
      "Programmable escrow and payment orchestration for freelancers, agencies, and the clients who hire them.",
    type: "website",
    siteName: "VerseFlow",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F8F6" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0C" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/*
          Theme is applied before first paint so a dark-mode user never sees a
          flash of light chrome. Kept inline and tiny for that reason.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('vf-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(!t&&d))document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <a href="#main" className="skip-link">Skip to main content</a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
