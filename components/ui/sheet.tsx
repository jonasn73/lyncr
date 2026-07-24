'use client'

import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay> & {
  variant?: 'default' | 'drawer'
}) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        // Above Map tab overlays (z-[2000–2100]) and Leaflet panes so Settings never sits under the map.
        'fixed inset-0 z-[6000]',
        variant === 'drawer'
          ? 'sigo-sheet-drawer-overlay bg-zinc-950/70 transform-gpu will-change-[opacity] backface-hidden'
          : 'bg-black/60 transform-gpu will-change-[opacity] backface-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = 'right',
  variant,
  overlayClassName,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** `drawer` = GPU translate3d slide, no backdrop blur, lighter shadow */
  variant?: 'default' | 'drawer'
  /** Raise above another open sheet (e.g. Get paid over Settings). */
  overlayClassName?: string
}) {
  const motionVariant = variant ?? (side === 'right' ? 'drawer' : 'default')
  const isDrawer = motionVariant === 'drawer'

  return (
    <SheetPortal>
      <SheetOverlay variant={motionVariant} className={overlayClassName} />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'bg-background fixed z-[6010] flex flex-col',
          isDrawer
            ? cn(
                'sigo-sheet-drawer-panel inset-y-0 h-full w-full border-l border-border/60 shadow-lg transform-gpu will-change-transform backface-hidden',
                side === 'right' && 'right-0 sm:max-w-md md:max-w-lg lg:max-w-xl',
                side === 'left' && 'left-0 w-3/4 border-r border-l-0 sm:max-w-sm',
              )
            : cn(
                'shadow-2xl transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out',
                side === 'right' &&
                  'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-full border-l border-border/60 sm:max-w-md md:max-w-lg lg:max-w-xl',
                side === 'left' &&
                  'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
                side === 'top' &&
                  'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b',
                side === 'bottom' &&
                  'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 flex h-[min(88dvh,800px)] max-h-[94dvh] flex-col rounded-t-3xl border-x border-t border-border/70',
              ),
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 p-4', className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-foreground font-semibold', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
