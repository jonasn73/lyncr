import type { Metadata, Viewport } from "next"
import { Inter, Geist_Mono } from "next/font/google"
import { Analytics as VercelWebAnalytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import {
  SITE_CANONICAL_URL,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_ALTERNATE_NAMES,
  SITE_METADATA_DEFAULT_TITLE,
  SITE_NAME,
  SITE_TITLE_TEMPLATE_SUFFIX,
} from "@/lib/brand"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CANONICAL_URL),
  title: {
    default: SITE_METADATA_DEFAULT_TITLE,
    template: `%s | ${SITE_TITLE_TEMPLATE_SUFFIX}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [...SITE_KEYWORDS],
  openGraph: {
    title: SITE_METADATA_DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_CANONICAL_URL,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_METADATA_DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  themeColor: "#12101f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
        <SonnerToaster richColors position="top-center" closeButton />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: SITE_NAME,
              alternateName: [...SITE_ALTERNATE_NAMES],
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              description: SITE_DESCRIPTION,
              offers: {
                "@type": "Offer",
                priceCurrency: "USD",
                price: "19",
              },
              url: SITE_CANONICAL_URL,
            }),
          }}
        />
        <VercelWebAnalytics />
      </body>
    </html>
  )
}
