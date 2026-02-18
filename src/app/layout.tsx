import "./globals.css";

export const metadata = {
  title: "VT Multi-Team Scheduler",
  description: "Multi-team scheduling dashboard (GitHub Pages + Supabase)"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
