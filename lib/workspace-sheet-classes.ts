/** GPU-friendly drawer motion — shared by workspace + routing slide-overs. */
export const DRAWER_SHEET_GPU =
  "transform-gpu will-change-transform [backface-visibility:hidden]"

/** Shared right-drawer width classes (decoupled from dashboard-call-flow to avoid import cycles). */
export const WORKSPACE_SHEET_CLASS =
  "gap-0 flex h-full flex-col p-0 sm:max-w-lg md:max-w-xl lg:max-w-2xl [&>button]:top-5 [&>button]:right-5 " +
  DRAWER_SHEET_GPU
