import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSessionProvider } from "@/components/providers/session-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Technic Technologies — Electronics ERP",
    template: "%s · Technic Technologies ERP",
  },
  description:
    "Technic Technologies Electronics ERP — products, inventory, serial & IMEI tracking, billing, purchases, payments and reports.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#123524",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <AppSessionProvider>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster />
        </AppSessionProvider>
      </body>
    </html>
  );
}
