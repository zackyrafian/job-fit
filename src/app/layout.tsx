import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Fit Analyzer",
  description: "Analyze how well a CV matches a Job Description — without fabricating experience.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
