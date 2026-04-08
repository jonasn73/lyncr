import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from '@/components/ui/toaster'
import './globals.css'

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL('https://www.getzingapp.com'),
  title: {
    default: 'Zing - AI Call Routing for Small Businesses',
    template: '%s | Zing',
  },
  description:
    'Zing helps small businesses buy or port numbers, route calls to receptionists, and use AI fallback so no lead is missed.',
  keywords: [
    'business phone system',
    'AI call routing',
    'virtual receptionist',
    'business VoIP routing',
    'small business VoIP',
    'call analytics',
  ],
  openGraph: {
    title: 'Zing - AI Call Routing for Small Businesses',
    description:
      'Buy or port numbers, route calls instantly, and use AI fallback to capture every customer call.',
    url: 'https://www.getzingapp.com',
    siteName: 'Zing',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Zing - AI Call Routing for Small Businesses',
    description:
      'Route calls to your team or AI in seconds. Built for small business operations.',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  themeColor: '#1a1a2e',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}>
        {children}
        <Toaster />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'Zing',
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Web',
              description:
                'AI call routing and receptionist operations platform for small businesses.',
              offers: {
                '@type': 'Offer',
                priceCurrency: 'USD',
                price: '19',
              },
              url: 'https://www.getzingapp.com',
            }),
          }}
        />
        <Analytics />
      </body>
    </html>
  )
}
