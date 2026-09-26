import type { Metadata } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "Baza Korisnika - PRO",
  description: "Modern CRM for subscription lines",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hr" className="dark">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
