import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { UiComponentGallery } from "@/components/dev/ui-component-gallery"

export const dynamic = "force-dynamic"
export const metadata = {
  title: "UI components · Dev",
  robots: { index: false, follow: false },
}

/** Session cookie name — must match lib/auth.ts COOKIE_NAME. */
const ZING_SESSION = "zing_session"

/**
 * Internal developer gallery for presentation components.
 * Requires a signed-in session (same cookie shape as dashboard).
 */
export default async function DevComponentsPage() {
  const jar = await cookies()
  const raw = jar.get(ZING_SESSION)?.value
  // Soft gate — full signature check still happens on API routes; this keeps the gallery off public crawlers.
  if (!raw || !raw.includes(".")) {
    redirect("/login?next=/dev/components")
  }

  return <UiComponentGallery />
}
