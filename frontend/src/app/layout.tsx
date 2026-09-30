import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import ViewportStage from './components/ViewportStage';

const inter = Inter({ subsets: ['latin'] });

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export const metadata: Metadata = {
  title: 'CRAFT - Wearable Creative AI',
  description: 'Generate narratives based on what you see with eye tracking technology',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}><ViewportStage>{children}</ViewportStage></body>
    </html>
  );
}