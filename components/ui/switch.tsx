'use client'

/**
 * Toggle switch — plain button (not Radix Switch).
 *
 * ROOT CAUSE (React #185 on lyncr.app /dashboard):
 * Production crash stacks always ended at `button` → Radix `Primitive.button`
 * → our Switch wrapper. Radix Switch mounts a hidden "bubble" checkbox that
 * dispatches synthetic click events + ResizeObserver size sync. Under the
 * Lines dashboard's rapid re-renders that loop hit "Maximum update depth".
 *
 * Safe-mode (Presence only) often survived because fewer parent updates hit
 * the Switch at once; restoring call-flow/telemetry brought the storm back.
 * Replacing Radix here removes that loop for every Switch in the app.
 */

import * as React from 'react'

import { cn } from '@/lib/utils'

function Switch({
  className,
  checked,
  defaultChecked,
  disabled,
  onCheckedChange,
  id,
  name,
  value = 'on',
  required,
  onClick,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onChange' | 'value'> & {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  name?: string
  value?: string
  required?: boolean
}) {
  // Support uncontrolled usage (defaultChecked) without Radix useControllableState.
  const [uncontrolled, setUncontrolled] = React.useState(Boolean(defaultChecked))
  const isControlled = checked !== undefined
  const isOn = isControlled ? Boolean(checked) : uncontrolled

  return (
    <button
      type="button"
      role="switch"
      id={id}
      name={name}
      value={value}
      disabled={disabled}
      aria-checked={isOn}
      aria-required={required}
      data-slot="switch"
      data-state={isOn ? 'checked' : 'unchecked'}
      data-disabled={disabled ? '' : undefined}
      // Same visual tokens as the old Radix Switch so existing classNames keep working.
      className={cn(
        'peer data-[state=checked]:bg-primary data-[state=checked]:shadow-[var(--electric-glow)] data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-[background-color,box-shadow,opacity] duration-200 ease-out outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || disabled) return
        const next = !isOn
        if (!isControlled) setUncontrolled(next)
        onCheckedChange?.(next)
      }}
    >
      {/* Thumb — slides with data-state like the old Radix thumb. */}
      <span
        data-slot="switch-thumb"
        aria-hidden
        className={
          'bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0'
        }
        data-state={isOn ? 'checked' : 'unchecked'}
      />
    </button>
  )
}

export { Switch }
