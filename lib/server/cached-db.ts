import { cache } from "react"
import { getAllRoutingConfigs, getPhoneNumbers, getReceptionists } from "@/lib/db"

/** Dedupe hot-path DB reads within one RSC request. */
export const getCachedPhoneNumbers = cache((userId: string) => getPhoneNumbers(userId, null))

export const getCachedReceptionists = cache((userId: string) => getReceptionists(userId))

export const getCachedAllRoutingConfigs = cache((userId: string) => getAllRoutingConfigs(userId))
