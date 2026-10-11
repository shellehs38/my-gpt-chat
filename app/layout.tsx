import type { ReactNode } from "react";

export const metadata = {
  title: "ИИ-помощник — СВОИ ЛЮДИ",
  description: "ИИ-помощник для строительного бизнеса",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
