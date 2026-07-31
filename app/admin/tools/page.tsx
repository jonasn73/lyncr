import { AdminToolsBoard } from "@/components/admin/admin-tools-board"
import { getSandboxEnvironment, listSandboxIntakeLogs } from "@/lib/sandbox-engine"

export const dynamic = "force-dynamic"

export default async function AdminToolsPage() {
  let environment: Awaited<ReturnType<typeof getSandboxEnvironment>> = null
  let intakeLogs: Awaited<ReturnType<typeof listSandboxIntakeLogs>> = []

  try {
    ;[environment, intakeLogs] = await Promise.all([
      getSandboxEnvironment(),
      listSandboxIntakeLogs(30),
    ])
  } catch (e) {
    console.error("[admin/tools] page load:", e)
  }

  return <AdminToolsBoard initialEnvironment={environment} initialIntakeLogs={intakeLogs} />
}
