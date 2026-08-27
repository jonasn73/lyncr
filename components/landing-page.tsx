"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  PhoneForwarded,
  MapPinned,
  CreditCard,
  CalendarClock,
  ArrowRight,
  ChevronDown,
  Check,
  Users,
} from "lucide-react"
import { BrandMark } from "@/components/brand-mark"
import { BrandWordmark } from "@/components/brand-wordmark"
import { SITE_NAME, SITE_TAGLINE } from "@/lib/brand"

// Product pillars — what Lyncr actually ships for service businesses.
const features = [
  {
    icon: PhoneForwarded,
    title: "Business phone & call routing",
    description:
      "Buy or port a number. Choose who answers—you, a receptionist, or your team. Set Available/Busy, hold queue, and press-1 booking SMS so callers reach the right place.",
  },
  {
    icon: CalendarClock,
    title: "Dispatch, scheduler & CRM",
    description:
      "Turn calls into jobs. Schedule techs, keep customer records, and run the day from one workspace instead of sticky notes and group texts.",
  },
  {
    icon: MapPinned,
    title: "Live map for field work",
    description:
      "See jobs and techs on a map so dispatch stays clear when your crew is on the road—built for locksmiths, mobile techs, and similar trades.",
  },
  {
    icon: CreditCard,
    title: "Payments that fit the job",
    description:
      "Collect in person, use Tap to Pay, or send a pay link—powered by Stripe Connect. Lyncr also bills your SaaS subscription so software and job payments stay separate and clear.",
  },
]

const steps = [
  {
    number: "01",
    title: "Create your account",
    description:
      "Sign up in minutes. Tell us about your service business so routing and workspace defaults fit how you work.",
  },
  {
    number: "02",
    title: "Connect your line & team",
    description:
      "Buy a local or toll-free number, or port the one customers already know. Add receptionists and field techs.",
  },
  {
    number: "03",
    title: "Route, dispatch, get paid",
    description:
      "Set who answers, schedule jobs in CRM, and collect with Tap to Pay or pay links when the work is done.",
  },
]

// Retail tiers already used at checkout — keep prices; describe the full product.
const pricing = [
  {
    tier: "starter" as const,
    name: "Starter",
    price: "$19",
    period: "/mo",
    description: "For solo operators",
    features: [
      "1 business number",
      "Call routing to your phone",
      "Scheduler & CRM basics",
      "Pay links & Collect",
      "Voicemail fallback",
    ],
    cta: "Get Started",
    highlighted: false,
  },
  {
    tier: "professional" as const,
    name: "Professional",
    price: "$49",
    period: "/mo",
    description: "For growing crews",
    features: [
      "Up to 3 numbers",
      "Receptionists & hold queue",
      "Dispatch, map & CRM",
      "Tap to Pay & pay links",
      "AI / owner fallback",
      "Talk time & pay tracking",
    ],
    cta: "Start Free Trial",
    highlighted: true,
  },
  {
    tier: "business" as const,
    name: "Business",
    price: "$99",
    period: "/mo",
    description: "For larger teams",
    features: [
      "Unlimited numbers",
      "Full routing & IVR tools",
      "Dispatch, map & CRM",
      "Payments via Stripe Connect",
      "Advanced AI scripts",
      "Priority support",
    ],
    cta: "Get Started",
    highlighted: false,
  },
]

const faqs = [
  {
    q: "What is Lyncr?",
    a: `${SITE_NAME} is B2B software for small service businesses—not a consumer marketplace or storefront. You get a business phone with call routing, plus dispatch, scheduler, CRM, and payments (Tap to Pay and pay links via Stripe Connect). We also bill your monthly Lyncr subscription.`,
  },
  {
    q: "Who is it for?",
    a: "Locksmiths, mobile technicians, and similar field-service operators who need one place for calls, jobs, customers, and getting paid—without a complicated PBX.",
  },
  {
    q: "Can I keep my existing business number?",
    a: `Yes. You can port your current number to ${SITE_NAME}, usually within a few business days. Callers keep dialing the same line.`,
  },
  {
    q: "How do payments work?",
    a: "Job payments run through Stripe Connect: Collect in the app, Tap to Pay on a compatible device, or send a customer pay link. Your Lyncr SaaS plan is billed separately as a subscription.",
  },
  {
    q: "Do receptionists or techs need special hardware?",
    a: `No desk phone required. Calls can ring a cell. Field payments use phone Tap to Pay or a pay link. You manage routing and dispatch from the ${SITE_NAME} web app.`,
  },
]

const audiences = [
  {
    title: "Locksmiths",
    blurb: "Answer lockouts fast, dispatch the closest tech, and take payment on site.",
  },
  {
    title: "Mobile technicians",
    blurb: "Keep the business line professional while you are under a hood or on a ladder.",
  },
  {
    title: "Small service teams",
    blurb: "One workspace for who answers, who is on the job, and who has paid.",
  },
]

interface LandingPageProps {
  /** Primary conversion — “Get started”, hero, pricing, bottom CTA (default `/signup`). */
  signupUrl?: string
  /** Returning users — nav, footer (default `/login`). */
  loginUrl?: string
  /** @deprecated Prefer `signupUrl`; if `signupUrl` is omitted, used as the signup target. */
  appUrl?: string
}

export function LandingPage({ signupUrl, loginUrl, appUrl }: LandingPageProps) {
  const join = signupUrl ?? appUrl ?? "/signup"
  const signin = loginUrl ?? "/login"
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="fixed top-0 z-50 w-full border-b border-border/40 bg-background/75 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <BrandMark className="h-4 w-4 text-primary-foreground" />
            </div>
            <BrandWordmark size="md" />
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Product
            </a>
            <a href="#who" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Who it&apos;s for
            </a>
            <a href="#pricing" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Pricing
            </a>
            <a href="#faq" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              FAQ
            </a>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={signin}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Log in
            </a>
            <a
              href={join}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-[background-color,box-shadow] hover:bg-primary/90"
            >
              Get started
            </a>
          </div>
        </nav>
      </header>

      {/* Hero — brand-first, one composition: brand, headline, support, CTAs, full-bleed visual */}
      <section className="relative isolate flex min-h-[100dvh] flex-col justify-end overflow-hidden px-4 pb-[calc(env(safe-area-inset-bottom)+2.5rem)] pt-24 sm:px-6 sm:pt-28 md:justify-center">
        {/* Full-bleed teal atmosphere (not purple glow) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 110% 70% at 50% -10%, oklch(0.87 0.14 181 / 0.28) 0%, transparent 58%), radial-gradient(ellipse 55% 45% at 100% 40%, oklch(0.55 0.08 200 / 0.18) 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 0% 80%, oklch(0.35 0.05 181 / 0.35) 0%, transparent 50%), oklch(0.13 0.022 268)",
          }}
        />
        {/* Subtle grid texture for field-ops depth */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.14]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(0.87 0.14 181 / 0.35) 1px, transparent 1px), linear-gradient(90deg, oklch(0.87 0.14 181 / 0.35) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse 80% 70% at 50% 40%, black 20%, transparent 75%)",
          }}
        />
        {/* Soft moving glow — intentional motion #1 */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-1/4 top-1/4 -z-10 h-[42vmin] w-[42vmin] rounded-full bg-primary/20 blur-3xl motion-safe:animate-landing-drift"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-[12%] bottom-0 -z-10 h-[36vmin] w-[36vmin] rounded-full bg-primary/10 blur-3xl motion-safe:animate-landing-drift-slow"
        />

        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:gap-10 lg:gap-16">
          <div className="animate-sigo-page-enter text-left">
            <BrandWordmark
              size="lg"
              className="mb-6 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl md:text-6xl"
            />
            <h1 className="max-w-xl text-balance text-3xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-4xl md:text-5xl">
              Calls, dispatch, and payments—linked for service businesses.
            </h1>
            <p className="mt-5 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              {SITE_TAGLINE} Business phone routing, field dispatch &amp; CRM, and Stripe payments in one B2B app—not a marketplace.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={join}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-8 py-4 text-base font-semibold text-primary-foreground shadow-[0_0_40px_-12px_oklch(0.87_0.14_181_/0.7)] transition-[background-color,transform,box-shadow] duration-200 ease-out hover:bg-primary/90 motion-safe:hover:scale-[1.02] sm:text-lg"
              >
                Create your account
                <ArrowRight className="h-5 w-5" aria-hidden />
              </a>
              <a
                href={signin}
                className="inline-flex items-center justify-center rounded-xl border border-border/80 bg-background/30 px-6 py-4 text-sm font-semibold text-foreground backdrop-blur-sm transition-[border-color,background-color,transform] hover:border-primary/40 hover:bg-background/50 motion-safe:hover:scale-[1.01]"
              >
                Log in
              </a>
            </div>
          </div>

          {/* Dominant visual — routing → job → pay (not a dashboard dump) */}
          <div
            aria-hidden
            className="relative mx-auto w-full max-w-md animate-sigo-page-enter md:max-w-none"
            style={{ animationDelay: "120ms" }}
          >
            <div className="relative aspect-[4/5] w-full sm:aspect-[5/4] md:aspect-square">
              {/* Soft plane behind the motif */}
              <div className="absolute inset-[8%] rounded-[2rem] border border-primary/20 bg-gradient-to-br from-primary/15 via-transparent to-card/40 backdrop-blur-sm" />
              {/* Pulse ring — intentional motion #2 */}
              <div className="absolute left-1/2 top-[28%] h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/40 motion-safe:animate-landing-ring sm:h-32 sm:w-32" />
              <div className="absolute left-1/2 top-[28%] h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/25 motion-safe:animate-landing-ring-delay sm:h-24 sm:w-24" />
              <div className="absolute left-1/2 top-[28%] flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_48px_-8px_oklch(0.87_0.14_181_/0.85)] sm:h-20 sm:w-20">
                <PhoneForwarded className="h-7 w-7 sm:h-8 sm:w-8" />
              </div>
              {/* Link lines */}
              <svg
                className="absolute inset-0 h-full w-full text-primary/50"
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M50 36 C50 48, 28 52, 22 68"
                  stroke="currentColor"
                  strokeWidth="0.6"
                  strokeDasharray="2 2"
                  className="motion-safe:animate-landing-dash"
                />
                <path
                  d="M50 36 C50 48, 72 52, 78 68"
                  stroke="currentColor"
                  strokeWidth="0.6"
                  strokeDasharray="2 2"
                  className="motion-safe:animate-landing-dash"
                />
              </svg>
              {/* End nodes */}
              <div className="absolute bottom-[18%] left-[8%] flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-3 py-2 backdrop-blur-md sm:left-[12%]">
                <Users className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-medium text-foreground">Receptionist</span>
              </div>
              <div className="absolute bottom-[18%] right-[8%] flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-3 py-2 backdrop-blur-md sm:right-[12%]">
                <MapPinned className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-medium text-foreground">Field tech</span>
              </div>
              <div className="absolute bottom-[4%] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-2 backdrop-blur-md">
                <CreditCard className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-semibold text-primary">Collect · Tap to Pay · Pay link</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Product */}
      <section id="features" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Product</p>
            <h2 className="text-3xl font-bold text-foreground md:text-4xl">
              What {SITE_NAME} actually does
            </h2>
            <p className="mt-4 text-muted-foreground">
              One SaaS workspace for the phone line, the schedule, the customer record, and the payment—built for field service, not retail e‑commerce or crypto.
            </p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2">
            {features.map((feature, i) => {
              const Icon = feature.icon
              return (
                <div
                  key={feature.title}
                  className="group border-t border-border pt-6 transition-[transform] duration-200 ease-out motion-safe:hover:-translate-y-0.5"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="who" className="border-y border-border bg-card/40 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Who it&apos;s for</p>
            <h2 className="text-3xl font-bold text-foreground md:text-4xl">
              Built for small service businesses
            </h2>
            <p className="mt-4 text-muted-foreground">
              If customers call you for on-site work, {SITE_NAME} links that call to the right answer—then to the job and the payment.
            </p>
          </div>
          <div className="grid gap-10 md:grid-cols-3">
            {audiences.map((a) => (
              <div key={a.title}>
                <h3 className="text-lg font-semibold text-foreground">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{a.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <div className="mb-16 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">How it works</p>
            <h2 className="text-3xl font-bold text-foreground md:text-4xl">Up and running in minutes</h2>
          </div>
          <div className="flex flex-col gap-8">
            {steps.map((step, i) => (
              <div key={step.number} className="flex gap-6">
                <div className="flex flex-col items-center">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                    {step.number}
                  </div>
                  {i < steps.length - 1 && <div className="mt-2 h-full w-px bg-border" />}
                </div>
                <div className="pb-8">
                  <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing — existing retail tiers */}
      <section id="pricing" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Pricing</p>
            <h2 className="text-3xl font-bold text-foreground md:text-4xl">Simple SaaS plans</h2>
            <p className="mx-auto mt-4 max-w-md text-muted-foreground">
              Software subscription for your team. Job payments to your customers run separately through Stripe Connect.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {pricing.map((plan) => (
              <div
                key={plan.name}
                className={cn(
                  "relative flex flex-col rounded-2xl border p-6",
                  plan.highlighted
                    ? "border-primary bg-primary/5 shadow-xl shadow-primary/10"
                    : "border-border bg-card"
                )}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                    Most Popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                    <span className="text-muted-foreground">{plan.period}</span>
                  </div>
                </div>
                <ul className="mb-8 flex flex-1 flex-col gap-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="text-sm text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={`${join}${join.includes("?") ? "&" : "?"}plan=${plan.tier}`}
                  className={cn(
                    "block w-full rounded-lg py-3 text-center text-sm font-semibold transition-colors",
                    plan.highlighted
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border border-border bg-secondary text-foreground hover:bg-secondary/80"
                  )}
                >
                  {plan.cta}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-6 py-24">
        <div className="mx-auto max-w-2xl">
          <div className="mb-12 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">FAQ</p>
            <h2 className="text-3xl font-bold text-foreground md:text-4xl">Common questions</h2>
          </div>
          <div className="flex flex-col gap-3">
            {faqs.map((faq, i) => (
              <div key={i} className="rounded-xl border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex w-full items-center justify-between px-6 py-4 text-left"
                >
                  <span className="pr-4 text-sm font-medium text-foreground">{faq.q}</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      openFaq === i && "rotate-180"
                    )}
                  />
                </button>
                {openFaq === i && (
                  <div className="border-t border-border px-6 pb-4 pt-3">
                    <p className="text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-foreground md:text-4xl">
            Ready to link every call to the right answer?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Start with your business line, then grow into dispatch, CRM, and payments as your crew grows.
          </p>
          <a
            href={join}
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-4 text-base font-semibold text-primary-foreground transition-[background-color,transform] duration-200 ease-out hover:bg-primary/90 motion-safe:hover:scale-[1.02]"
          >
            Create your account
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-10 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <BrandMark className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <BrandWordmark size="sm" />
          </div>
          <div className="flex flex-wrap justify-center gap-6">
            <a href="/privacy" className="text-xs text-muted-foreground hover:text-foreground">
              Privacy
            </a>
            <a href="/terms" className="text-xs text-muted-foreground hover:text-foreground">
              Terms
            </a>
            <a href="/support" className="text-xs text-muted-foreground hover:text-foreground">
              Support
            </a>
            <a href={signin} className="text-xs text-muted-foreground hover:text-foreground">
              Log in
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            © 2026 {SITE_NAME}. All rights reserved.
          </p>
        </div>
      </footer>

    </div>
  )
}
