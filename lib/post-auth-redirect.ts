// Central post-login / post-signup redirect paths by account role.

import type { User } from "@/lib/types"
import { isLyncrAdminUser } from "@/lib/lyncr-admin"
import { isPlatformAdminUser } from "@/lib/platform-admin"

export type PostAuthContext = {
  user?: Pick<User, "email" | "account_role"> | null
  operator_access?: boolean
  redirect?: string
}

/** Default landing path after authentication. */
export function resolvePostAuthPath(ctx?: PostAuthContext, nextPath?: string | null): string {
  if (ctx?.redirect?.startsWith("/")) return ctx.redirect

  const isOperator = ctx?.operator_access ?? isPlatformAdminUser(ctx?.user ?? { email: "" })
  const isAdmin = ctx?.user ? isLyncrAdminUser(ctx.user) : false
  const role = ctx?.user?.account_role ?? "owner"

  if (isOperator || isAdmin) {
    if (nextPath?.startsWith("/admin")) return nextPath
    return "/admin"
  }
  if (role === "receptionist") {
    if (nextPath?.startsWith("/receptionist")) return nextPath
    return "/receptionist"
  }
  if (role === "field_tech") {
    if (nextPath?.startsWith("/tech")) return nextPath
    return "/tech/dashboard"
  }
  if (nextPath?.startsWith("/dashboard") || nextPath?.startsWith("/onboarding")) return nextPath
  return "/dashboard"
}

/** Build API/session payload field for clients. */
export function postAuthPayload(user: User): {
  operator_access: boolean
  account_role: User["account_role"]
  redirect: string
} {
  const operator_access = isPlatformAdminUser(user)
  return {
    operator_access,
    account_role: user.account_role,
    redirect: resolvePostAuthPath({ user, operator_access }),
  }
}
