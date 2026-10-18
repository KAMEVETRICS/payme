import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Payme",
  description: "Your suppliers paid on time, inside the rules you set.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
