"use client";

import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import AppShell from "../src/components/AppShell";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html data-theme="dark" lang="en">
      <body className="findec-app-body">
        <AppShell>{children}</AppShell>
        <Analytics />
      </body>
    </html>
  );
}
