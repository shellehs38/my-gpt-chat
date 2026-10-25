import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "ИИ-помощник — СВОИ ЛЮДИ",
  description: "Строительный помощник ООО «СВОИ ЛЮДИ»: технологии, сметы, фасады и управление проектами.",
  icons: { icon: "/brand/logo-sl-approved-light.png" },
  robots: { index: false, follow: false, noarchive: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}

