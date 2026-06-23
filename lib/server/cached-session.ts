import { cache } from "react"
import { getSessionUser } from "@/lib/server-session-user"

/** One session lookup per RSC request (layout + nested server components). */
export const getCachedSessionUser = cache(getSessionUser)
