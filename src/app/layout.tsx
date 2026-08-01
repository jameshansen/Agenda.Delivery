import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const gelica = localFont({
  src: "./fonts/Gelica-Regular.otf",
  variable: "--font-gelica",
  display: "swap",
});

export const metadata: Metadata = {
  title: "agenda.delivery",
  description:
    "Never miss an update from your local council, committee, organization, non-profit, charity, or business. AI-summarized agendas, delivered.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${gelica.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
