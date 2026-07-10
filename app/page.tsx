'use client'

import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import {
  Sparkles,
  ShieldCheck,
  Eye,
  Lock,
  UserCircle2,
  ImagePlus,
  ListChecks,
  FileCheck2,
  ArrowRight,
  CalendarCheck,
  Palette,
  Shirt,
  CloudSun,
  Heart,
  MessageSquareOff,
  BadgeCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import ExampleReportPreview from '@/components/fashion/ExampleReportPreview'
import { fadeUp, fadeIn, staggerContainer, viewportOnce } from '@/lib/motion'

const VALUE_PROPS = [
  { icon: Eye, title: 'Explainable AI', description: 'Every rating comes with a plain-language reason — nothing is a black box.' },
  { icon: Lock, title: 'Privacy-First', description: 'Your photos and preferences are used only to generate your report.' },
  { icon: ShieldCheck, title: 'Decision Support', description: 'Not a chatbot, not a stylist — a structured verdict you can act on.' },
  { icon: BadgeCheck, title: 'Professional Recommendations', description: 'Consulting-grade reports, calculated from a fixed weighted formula.' },
]

const FEATURES = [
  { icon: UserCircle2, title: 'Style Profile', description: 'Tell us your preferred style, favorite colors, and go-to occasions in under a minute.' },
  { icon: ImagePlus, title: 'Photo + Garment Upload', description: 'Upload a photo of yourself and the item you are considering buying.' },
  { icon: ListChecks, title: 'Multi-Dimension Evaluation', description: 'Occasion, color, formality, seasonality, style, and preference match — rated independently.' },
  { icon: FileCheck2, title: 'Decision Report', description: 'A clear, confident verdict with the reasoning behind every rating.' },
]

const STEPS = [
  { number: '01', title: 'Create your style profile', description: 'Preferred style, favorite colors, occasion preferences.' },
  { number: '02', title: 'Upload two photos', description: 'Your photo and the clothing item you are deciding on.' },
  { number: '03', title: 'Select the occasion', description: 'Interview, wedding, date night, work, and more.' },
  { number: '04', title: 'Get your decision report', description: 'A calculated verdict with full reasoning, not a guess.' },
]

const DIMENSIONS = [
  { icon: CalendarCheck, label: 'Occasion' },
  { icon: Palette, label: 'Color Harmony' },
  { icon: Shirt, label: 'Formality' },
  { icon: CloudSun, label: 'Seasonality' },
  { icon: Sparkles, label: 'Style' },
  { icon: Heart, label: 'Style Preference Match' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="focus-ring flex items-center gap-2 rounded-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Sparkles className="h-4 w-4 text-primary-foreground" aria-hidden="true" />
            </div>
            <span className="text-lg font-semibold tracking-tight">Verdict</span>
          </Link>
          <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
            <a href="#features" className="focus-ring rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground">Features</a>
            <a href="#how-it-works" className="focus-ring rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground">How it works</a>
            <a href="#example-report" className="focus-ring rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground">Example Report</a>
          </nav>
          <Button asChild size="sm" className="focus-ring">
            <Link href="/dashboard">Open Dashboard</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-grid-fade opacity-[0.12]" />
        <div className="absolute left-1/2 top-0 -z-10 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="container grid gap-16 py-20 md:grid-cols-2 md:py-28">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="flex flex-col justify-center">
            <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              AI Fashion Decision Assistant
            </div>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-[3.4rem]">
              Know before <br />
              <span className="text-gradient">you buy.</span>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
              Upload a photo, upload the garment, pick an occasion. Verdict rates it across six dimensions and
              calculates one confident, explainable decision — before you spend a dollar.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button asChild size="lg" className="focus-ring group">
                <Link href="/dashboard">
                  Get Started <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="focus-ring">
                <a href="#how-it-works">See how it works</a>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> 6 evaluation dimensions</span>
              <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Verdict is calculated, not guessed</span>
              <span className="flex items-center gap-1.5"><MessageSquareOff className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Not a chatbot</span>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.1 }} className="relative flex items-center justify-center">
            <div className="relative aspect-[4/5] w-full max-w-sm overflow-hidden rounded-3xl border border-border shadow-2xl shadow-black/40">
              <Image src="https://images.unsplash.com/photo-1574015974293-817f0ebebb74" alt="A confident, minimal editorial fashion portrait" fill className="object-cover" priority sizes="(max-width: 768px) 100vw, 400px" />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
            </div>
            <motion.div
              initial={{ opacity: 0, x: -16, y: -16 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35 }}
              className="absolute -top-6 -right-4 hidden w-52 rounded-2xl border border-border bg-card p-4 shadow-xl shadow-black/30 sm:-right-8 sm:block"
              aria-hidden="true"
            >
              <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">How it works</p>
              <div className="flex items-center justify-between">
                {[
                  { icon: UserCircle2, label: 'Photo' },
                  { icon: Shirt, label: 'Garment' },
                  { icon: Sparkles, label: 'AI' },
                  { icon: FileCheck2, label: 'Report' },
                ].map((step, i, arr) => (
                  <div key={step.label} className="flex items-center">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
                        <step.icon className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <span className="text-[9px] text-muted-foreground">{step.label}</span>
                    </div>
                    {i < arr.length - 1 && <div className="mx-1 h-px w-3 shrink-0 bg-border" />}
                  </div>
                ))}
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 20, y: 20 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="animate-float-slow absolute -bottom-6 -left-6 w-56 rounded-2xl border border-border bg-card p-4 shadow-xl shadow-black/30 sm:-left-10"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-emerald-400">Highly Recommended</span>
                <span className="text-sm font-semibold text-emerald-400">4.7/5</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-[94%] rounded-full bg-emerald-400" />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Calculated across all six evaluation dimensions</p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Value props */}
      <section className="border-y border-border bg-card/40">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          className="container grid gap-8 py-14 sm:grid-cols-2 lg:grid-cols-4"
        >
          {VALUE_PROPS.map((item) => (
            <motion.div variants={fadeUp} key={item.title} className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <item.icon className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">{item.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Features */}
      <section id="features" className="container py-24">
        <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce} className="mx-auto mb-16 max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">A decision engine, not a chatbot</h2>
          <p className="mt-4 text-muted-foreground">Every report is built from a structured evaluation, not a freeform conversation.</p>
        </motion.div>
        <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={viewportOnce} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <motion.div key={f.title} variants={fadeUp} className="card-hover rounded-2xl border border-border bg-card p-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-secondary">
                <f.icon className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <h3 className="font-medium text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-border bg-card/30 py-24">
        <div className="container grid gap-16 md:grid-cols-2 md:items-center">
          <div>
            <motion.h2 variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce} className="text-3xl font-semibold tracking-tight sm:text-4xl">How it works</motion.h2>
            <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={viewportOnce} className="mt-10 space-y-8">
              {STEPS.map((step) => (
                <motion.div key={step.number} variants={fadeUp} className="flex gap-5">
                  <span className="font-mono text-sm text-primary">{step.number}</span>
                  <div>
                    <h3 className="font-medium text-foreground">{step.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
          <motion.div variants={fadeIn} initial="hidden" whileInView="visible" viewport={viewportOnce} className="relative aspect-square overflow-hidden rounded-3xl border border-border">
            <Image src="https://images.unsplash.com/photo-1497997092403-f091fcf5b6c4" alt="Close-up editorial garment detail" fill className="object-cover" sizes="(max-width: 768px) 100vw, 500px" />
            <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
          </motion.div>
        </div>
      </section>

      {/* Example report preview */}
      <section id="example-report" className="container py-24">
        <div className="grid gap-16 md:grid-cols-2 md:items-center">
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce}>
            <p className="text-xs font-medium uppercase tracking-wide text-primary">Example Report</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">See exactly how a decision is made</h2>
            <p className="mt-4 max-w-md text-muted-foreground">
              Every report shows the rating, the reason, and the confidence behind it — dimension by dimension.
              The overall verdict is calculated from a fixed weighted formula, never invented after the fact.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-primary" aria-hidden="true" /> Six dimensions, rated independently</li>
              <li className="flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-primary" aria-hidden="true" /> Style conflicts named directly, never hidden</li>
              <li className="flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-primary" aria-hidden="true" /> Full transparency on what was and was not considered</li>
            </ul>
          </motion.div>
          <ExampleReportPreview />
        </div>
      </section>

      {/* Dimensions preview */}
      <section className="border-t border-border py-24">
        <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce} className="container mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Six dimensions. One calculated verdict.</h2>
          <p className="mt-4 text-muted-foreground">Ratings are computed by a fixed, weighted formula — never invented after the fact.</p>
        </motion.div>
        <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={viewportOnce} className="container flex flex-wrap items-center justify-center gap-3">
          {DIMENSIONS.map((d) => (
            <motion.div key={d.label} variants={fadeUp} className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2">
              <d.icon className="h-4 w-4 text-primary" aria-hidden="true" />
              <span className="text-sm text-foreground">{d.label}</span>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* CTA */}
      <section className="container pb-24">
        <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce} className="relative overflow-hidden rounded-3xl border border-border bg-card px-8 py-16 text-center">
          <div className="absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl" aria-hidden="true" />
          <h2 className="relative text-3xl font-semibold tracking-tight sm:text-4xl">Ready to shop with confidence?</h2>
          <p className="relative mx-auto mt-4 max-w-md text-muted-foreground">Set up your style profile and run your first analysis in minutes.</p>
          <Button asChild size="lg" className="focus-ring relative mt-8">
            <Link href="/dashboard">Open Dashboard <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
          </Button>
        </motion.div>
      </section>

      <footer className="border-t border-border py-10">
        <div className="container flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary">
              <Sparkles className="h-3 w-3 text-primary-foreground" aria-hidden="true" />
            </div>
            <span className="text-sm font-medium">Verdict</span>
          </div>
          <p className="text-xs text-muted-foreground">Phase 1 preview · Mock analysis for demonstration</p>
        </div>
      </footer>
    </div>
  )
}
