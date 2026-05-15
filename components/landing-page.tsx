"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  PhoneForwarded,
  Users,
  Bot,
  BarChart3,
  ArrowRight,
  Clock,
  Shield,
  Zap,
  ChevronDown,
  Check,
} from "lucide-react"
import { BrandMark } from "@/components/brand-mark"
import { BrandWordmark } from "@/components/brand-wordmark"
import { SITE_NAME, SITE_TAGLINE } from "@/lib/brand"

const features = [
  {
    icon: PhoneForwarded,
    title: "One-Tap Call Routing",
    description:
      "Instantly switch who answers your business line. Route to yourself, a receptionist, or let AI handle it.",
  },
  {
    icon: Users,
    title: "Receptionist Management",
    description:
      "Add receptionists, track their talk time, and auto-calculate pay. Know exactly what you owe.",
  },
  {
    icon: Bot,
    title: "AI Fallback Assistant",
    description:
      "When no one answers, AI picks up. It greets callers, takes messages, shares hours, and books appointments.",
  },
  {
    icon: BarChart3,
    title: "Analytics & Pay Tracking",
    description:
      "See call volume, talk minutes, and costs in real time. Export reports and stay on top of your numbers.",
  },
]

const steps = [
  {
    number: "01",
    title: "Sign Up & Get a Number",
    description: "Create your account in 30 seconds. Buy a new local or toll-free number, or port your existing business line.",
  },
  {
    number: "02",
    title: "Add Your Team",
    description: "Add receptionists with their phone numbers and per-minute rates. They get calls on their own phone.",
  },
  {
    number: "03",
    title: "Start Routing Calls",
    description: "Choose who answers. Switch instantly from the dashboard. Set fallback rules for missed calls.",
  },
]

const pricing = [
  {
    name: "Starter",
    price: "$19",
    period: "/mo",
    description: "For solo operators",
    features: [
      "1 business number",
      "Call routing to your phone",
      "Basic call log",
      "Voicemail fallback",
    ],
    cta: "Get Started",
    highlighted: false,
  },
  {
    name: "Professional",
    price: "$49",
    period: "/mo",
    description: "For growing businesses",
    features: [
      "Up to 3 numbers",
      "Unlimited receptionists",
      "AI assistant fallback",
      "Talk time & pay tracking",
      "Analytics dashboard",
      "Priority support",
    ],
    cta: "Start Free Trial",
    highlighted: true,
  },
  {
    name: "Business",
    price: "$99",
    period: "/mo",
    description: "For teams & agencies",
    features: [
      "Unlimited numbers",
      "Unlimited receptionists",
      "Advanced AI with custom scripts",
      "Full analytics & exports",
      "API access",
      "Dedicated account manager",
    ],
    cta: "Contact Sales",
    highlighted: false,
  },
]

const faqs = [
  {
    q: "Can I keep my existing business number?",
    a: `Yes. You can port your current number to ${SITE_NAME} in 24-48 hours with zero downtime. Your callers won't notice a thing.`,
  },
  {
    q: "How does the AI assistant work?",
    a: "When a call goes unanswered, AI picks up using your custom greeting. It can take messages, share your business hours, answer FAQs, and even book appointments -- all configurable from your dashboard.",
  },
  {
    q: "How does receptionist pay tracking work?",
    a: `Set a per-minute rate for each receptionist. ${SITE_NAME} logs every second of talk time and calculates what you owe automatically. Export pay reports anytime.`,
  },
  {
    q: "Do my receptionists need to install anything?",
    a: `No. Calls forward to their personal cell phone. They answer like a normal call. You manage everything from the ${SITE_NAME} app.`,
  },
]

const testimonials = [
  {
    quote: "We stopped missing calls after hours. The AI fallback alone paid for itself in week one.",
    name: "Lena M.",
    role: "Owner, Home Services",
  },
  {
    quote: "Routing by business number is exactly what our multi-location team needed.",
    name: "Carlos R.",
    role: "Ops Lead, Medical Office",
  },
  {
    quote: "Payroll and talk-time tracking removed so much manual work every Friday.",
    name: "Danielle T.",
    role: "Founder, Agency",
  },
]

// Standalone landing page for the marketing website.
// In the marketing site, link "Get Started" / "Log in" buttons to your app URL (e.g. app.getzingapp.com).
// The appUrl prop defaults to "/app" but you can pass "https://app.getzingapp.com" in production.

interface LandingPageProps {
  appUrl?: string
}

export function LandingPage({ appUrl = "/app" }: LandingPageProps) {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="fixed top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <BrandMark className="h-4 w-4 text-primary-foreground" />
            </div>
            <BrandWordmark size="md" />
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#how-it-works" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              How it Works
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
              href={appUrl}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Log in
            </a>
            <a
              href={appUrl}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get Started
            </a>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-screen flex-col items-center justify-center px-6 pt-20 text-center">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 28%, oklch(0.66 0.18 268 / 0.12) 0%, transparent 58%), radial-gradient(ellipse at 80% 10%, oklch(0.78 0.09 25 / 0.06) 0%, transparent 50%)",
          }}
        />
        <div className="relative mx-auto max-w-3xl animate-sigo-page-enter">
          <div className="mb-5 flex justify-center">
            <BrandWordmark size="lg" className="justify-center" />
          </div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium text-primary">
              {SITE_TAGLINE}
            </span>
          </div>
          <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight text-foreground md:text-6xl md:leading-tight">
            Route your business calls{" "}
            <span className="text-primary">with one tap</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground md:text-xl">
            Buy a number, add receptionists, set up AI fallback. {SITE_NAME} handles your calls so you can run your business.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href={appUrl}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground transition-[background-color,transform,box-shadow] duration-200 ease-out hover:bg-primary/90 motion-safe:hover:scale-[1.02] sm:w-auto"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#how-it-works"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-8 py-3.5 text-base font-semibold text-foreground transition-[background-color,border-color,transform] duration-200 ease-out hover:bg-secondary motion-safe:hover:scale-[1.01] sm:w-auto"
            >
              See How It Works
            </a>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border px-2.5 py-1">No hardware needed</span>
            <span className="rounded-full border border-border px-2.5 py-1">Setup in minutes</span>
            <span className="rounded-full border border-border px-2.5 py-1">Built for small teams</span>
          </div>
        </div>

        {/* App preview mockup */}
        <div className="relative mx-auto mt-16 w-full max-w-sm">
          <div className="rounded-3xl border border-border bg-card p-6 shadow-2xl shadow-primary/5">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary bg-primary/10">
                <PhoneForwarded className="h-7 w-7 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-foreground">Calls Are Being Routed</p>
                <p className="mt-1 text-sm text-muted-foreground">Ringing first to</p>
              </div>
              <div className="flex items-center gap-2.5 rounded-full border border-primary/30 bg-primary/10 px-4 py-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                  SM
                </div>
                <span className="text-sm font-semibold text-primary">Sarah Miller</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Falls back to your phone if no answer</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
              Features
            </p>
            <h2 className="text-3xl font-bold text-foreground md:text-4xl">
              Everything you need to manage calls
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            {features.map((feature) => {
              const Icon = feature.icon
              return (
                <div
                  key={feature.title}
                  className="group rounded-2xl border border-border bg-card p-6 transition-[transform,border-color,background-color] duration-200 ease-out hover:-translate-y-1 hover:border-primary/30 hover:bg-card/80 motion-reduce:hover:translate-y-0"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <div className="mb-16 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
              How it Works
            </p>
            <h2 className="text-3xl font-bold text-foreground md:text-4xl">
              Up and running in minutes
            </h2>
          </div>
          <div className="flex flex-col gap-8">
            {steps.map((step, i) => (
              <div
                key={step.number}
                className="flex gap-6"
              >
                <div className="flex flex-col items-center">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                    {step.number}
                  </div>
                  {i < steps.length - 1 && (
                    <div className="mt-2 h-full w-px bg-border" />
                  )}
                </div>
                <div className="pb-8">
                  <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-border bg-card px-6 py-12">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-12 text-center md:justify-between">
          {[
            { value: "10k+", label: "Calls routed" },
            { value: "500+", label: "Businesses" },
            { value: "99.9%", label: "Uptime" },
            { value: "<1s", label: "Routing time" },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-2xl font-bold text-primary md:text-3xl">{stat.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
              Customer Stories
            </p>
            <h2 className="text-3xl font-bold text-foreground md:text-4xl">
              Teams using {SITE_NAME} every day
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {testimonials.map((t) => (
              <div key={t.name} className="rounded-2xl border border-border bg-card p-6">
                <p className="text-sm leading-relaxed text-foreground">"{t.quote}"</p>
                <div className="mt-4">
                  <p className="text-sm font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
              Pricing
            </p>
            <h2 className="text-3xl font-bold text-foreground md:text-4xl">
              Simple, transparent pricing
            </h2>
            <p className="mx-auto mt-4 max-w-md text-muted-foreground">
              Start free for 14 days. No credit card required.
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
                    <li key={feature} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="text-sm text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={appUrl}
                  className={cn(
                    "block w-full rounded-lg py-2.5 text-center text-sm font-semibold transition-colors",
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
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
              FAQ
            </p>
            <h2 className="text-3xl font-bold text-foreground md:text-4xl">
              Common questions
            </h2>
          </div>
          <div className="flex flex-col gap-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
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
                  <div className="border-t border-border px-5 pb-4 pt-3">
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
            Ready to take control of your calls?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Join hundreds of small businesses using {SITE_NAME} to route calls, track pay, and never miss a customer.
          </p>
          <a
            href={appUrl}
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground transition-[background-color,transform] duration-200 ease-out hover:bg-primary/90 motion-safe:hover:scale-[1.02]"
          >
            Start Your Free Trial
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <BrandMark className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <BrandWordmark size="sm" />
          </div>
          <div className="flex gap-6">
            <a href="/privacy" className="text-xs text-muted-foreground hover:text-foreground">Privacy</a>
            <a href="/support" className="text-xs text-muted-foreground hover:text-foreground">Support</a>
            <a href={appUrl} className="text-xs text-muted-foreground hover:text-foreground">Log in</a>
          </div>
          <p className="text-xs text-muted-foreground">
            2026 {SITE_NAME}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
