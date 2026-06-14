import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { SyncManager } from "@/components/SyncManager";
import { DarkModeToggle } from "@/components/DarkModeToggle";
import { NavAuth } from "@/components/NavAuth";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OxAI — Oxbridge Exam Prep",
  description: "AI-powered exam preparation for ESAT, TMUA, NSAA, MAT, PAT and Oxbridge interviews.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();` }} />
      </head>
      <body className="min-h-full flex flex-col bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <SyncManager />
        <nav className="bg-white/90 dark:bg-gray-950/90 backdrop-blur border-b border-gray-100 dark:border-gray-800 px-6 py-3 flex items-center gap-5 sticky top-0 z-30">
          <Link href="/" className="text-base font-bold text-accent tracking-tight shrink-0">
            OxAI
          </Link>
          <div className="flex-1" />
          <Link href="/about" className="text-sm text-gray-600 dark:text-gray-400 hover:text-accent transition-colors hidden sm:block">
            About
          </Link>
          <Link href="/quick" className="text-sm text-gray-600 dark:text-gray-400 hover:text-accent transition-colors hidden sm:block">
            Quick Mode
          </Link>
          <Link href="/paper" className="text-sm text-gray-600 dark:text-gray-400 hover:text-accent transition-colors hidden sm:block">
            Paper Mode
          </Link>
          <DarkModeToggle />
          <NavAuth />
        </nav>
        <div className="flex-1 flex flex-col">{children}</div>
      </body>
    </html>
  );
}