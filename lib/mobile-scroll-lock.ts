/** Toggle vertical scroll on the dashboard `<main>` pane (mobile scheduler map uses a fixed shell). */
export function setMainScrollLocked(locked: boolean): void {
  const main = document.querySelector<HTMLElement>("main")
  if (!main) return
  if (locked) {
    main.setAttribute("data-scroll-locked", "")
    return
  }
  main.removeAttribute("data-scroll-locked")
}

/** Always clear scroll lock — e.g. when leaving the scheduler tab. */
export function clearMainScrollLock(): void {
  setMainScrollLocked(false)
}
