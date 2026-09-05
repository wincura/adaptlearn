import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: 'AdaptLearn — Your AI learning studio',
  description: 'A personal learning studio that adapts to how you learn.',
  icons: {
    icon: '/brand/adaptlearn-app-icon.png',
    shortcut: '/brand/adaptlearn-app-icon.png',
    apple: '/brand/adaptlearn-app-icon.png',
  },
  openGraph: {
    title: 'AdaptLearn',
    description: 'Your AI learning studio',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AdaptLearn',
    description: 'Your AI learning studio',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
