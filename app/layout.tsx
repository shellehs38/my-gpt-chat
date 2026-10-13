import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "ИИ-помощник — СВОИ ЛЮДИ",
  description: "Строительный помощник ООО «СВОИ ЛЮДИ»: технологии, сметы, фасады и управление проектами.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
