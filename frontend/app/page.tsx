import Link from 'next/link';
import { ExampleCarousel, type ExampleQuestion } from '@/components/ExampleCarousel';
import { NewsletterForm } from '@/components/NewsletterForm';
import { ScrollFeatures } from '@/components/ScrollFeatures';
import { SmoothScrollLink } from '@/components/SmoothScrollLink';
import { HomeAuthRedirect } from '@/components/HomeAuthRedirect';
import examplesData from '@/examples.json';

const questions = examplesData.questions as unknown as ExampleQuestion[];

const EXAMS = ['NSAA', 'TMUA', 'ENGAA', 'ESAT'];

export default function LandingPage() {
  return (
    <main className="flex flex-col bg-white dark:bg-gray-950">
      <HomeAuthRedirect />

      {/* ── HERO ──────────────────────────────────────────────────── */}
      <section className="relative min-h-[calc(100vh-52px)] flex flex-col items-center justify-center text-center px-6 overflow-hidden">
        {/* Radial glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/4 w-[800px] h-[800px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(45,140,240,0.08) 0%, transparent 65%)' }}
        />

        <div className="relative z-10 max-w-3xl mx-auto">
          {/* Exam pills */}
          <div className="flex flex-wrap justify-center gap-2 mb-10">
            {EXAMS.map(e => (
              <span key={e} className="text-xs font-bold bg-accent text-white px-3 py-1 rounded-full shadow-sm">
                {e}
              </span>
            ))}
          </div>

          <h1 className="text-7xl sm:text-9xl font-black tracking-tight text-gray-900 dark:text-white mb-6 leading-none">
            Ox<span className="text-accent">AI</span>
          </h1>

          <p className="text-xl sm:text-2xl font-medium text-gray-600 dark:text-gray-300 mb-4 leading-snug">
            5,000+ NSAA &amp; TMUA questions,<br className="hidden sm:block" /> every past paper, full worked solutions.
          </p>

          <p className="text-base text-gray-400 dark:text-gray-500 mb-10 max-w-xl mx-auto leading-relaxed">
            A frontier model trained on real past papers that generates unlimited exam-style questions. Every official past and specimen paper is built in. Full worked solutions included.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 bg-accent text-white font-bold px-8 py-3.5 rounded-full text-base hover:bg-accent-light transition-colors shadow-lg shadow-accent/20"
            >
              Get started &#8594;
            </Link>
            <SmoothScrollLink
              target="#examples"
              className="inline-flex items-center justify-center gap-2 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-semibold px-8 py-3.5 rounded-full text-base border border-gray-200 dark:border-gray-700 hover:border-accent/40 hover:text-accent transition-colors cursor-pointer"
            >
              See example questions
            </SmoothScrollLink>
            <Link
              href="/about"
              className="inline-flex items-center justify-center gap-2 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 font-semibold px-8 py-3.5 rounded-full text-base border border-gray-200 dark:border-gray-700 hover:border-accent/40 hover:text-accent transition-colors"
            >
              About us
            </Link>
          </div>

          <p className="mt-5 text-xs text-gray-400 dark:text-gray-600">
            1 month free &bull; No credit card required &bull; Cancel any time
          </p>
        </div>

        {/* Scroll indicator */}
        <SmoothScrollLink
          target="#examples"
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-gray-300 dark:text-gray-600 cursor-pointer hover:text-accent transition-colors"
        >
          <span className="text-xs tracking-widest uppercase">Scroll</span>
          <svg width="16" height="20" viewBox="0 0 16 20" fill="none" className="animate-bounce">
            <path d="M8 2v16M2 12l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </SmoothScrollLink>
      </section>

      {/* ── CAROUSEL ──────────────────────────────────────────────── */}
      <section id="examples" className="py-20 px-6 bg-gray-50/60 dark:bg-gray-900/40">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-3">Live examples</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Questions that actually challenge you
            </h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-lg mx-auto">
              Generated by a frontier model trained on real NSAA and TMUA past papers. Multiple-choice format, full worked solutions, instant marking.
            </p>
          </div>
          <ExampleCarousel questions={questions} />
        </div>
      </section>

      {/* ── SCROLL FEATURES ───────────────────────────────────────── */}
      <ScrollFeatures />

      {/* ── STATS BAND ────────────────────────────────────────────── */}
      <section className="py-16 px-6 bg-accent text-white">
        <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-10 text-center">
          {[
            { n: '5,000+', label: 'AI-generated questions' },
            { n: 'Every paper', label: 'NSAA · TMUA built in' },
            { n: '100%', label: 'Full worked solutions' },
            { n: '1 month', label: 'Free trial' },
          ].map((s, i) => (
            <div key={i}>
              <div className="text-2xl sm:text-3xl font-black mb-1 leading-tight">{s.n}</div>
              <div className="text-xs text-blue-100 font-medium uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRICING ───────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-6 bg-white dark:bg-gray-950">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-3">Pricing</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
              Simple, honest pricing
            </h2>
          </div>

          <div className="relative rounded-3xl border-2 border-accent bg-white dark:bg-gray-900 shadow-xl shadow-accent/10 p-8 text-center">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2">
              <span className="bg-accent text-white text-xs font-bold px-4 py-1.5 rounded-full shadow">
                1 month FREE trial
              </span>
            </div>

            <div className="mt-4">
              <div className="flex items-baseline justify-center gap-2 mb-1">
                <span className="text-5xl font-black text-gray-900 dark:text-white">&pound;17.99</span>
                <span className="text-gray-400 text-sm">/&nbsp;month</span>
              </div>
              <div className="text-sm text-gray-400 mb-6">
                Was <span className="line-through">&pound;20.00</span> &mdash; save 10% at launch
              </div>
            </div>

            <ul className="text-left space-y-3 mb-8 text-sm text-gray-700 dark:text-gray-300">
              {[
                'All NSAA, TMUA, ENGAA &amp; ESAT past and specimen papers',
                'Full worked solutions for every question',
                'AI tutor with built-in whiteboard vision',
                'Unlimited question generation on any topic',
                'Quick fire &amp; timed past paper modes',
                'Export custom exam papers to PDF',
                'Performance analytics &amp; weak-topic tracker',
              ].map(item => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 text-emerald-500 text-base leading-none shrink-0">&#10003;</span>
                  <span dangerouslySetInnerHTML={{ __html: item }} />
                </li>
              ))}
            </ul>

            <Link
              href="/quick"
              className="block w-full text-center bg-accent text-white font-bold py-3.5 rounded-2xl hover:bg-accent-light transition-colors text-base shadow-md shadow-accent/20"
            >
              Start your free month &#8594;
            </Link>
            <p className="mt-4 text-xs text-gray-400">Cancel any time. No hidden fees.</p>
          </div>
        </div>
      </section>

      {/* ── FOOTER + NEWSLETTER ───────────────────────────────────── */}
      <footer className="bg-gray-950 text-gray-400 pt-16 pb-8 px-6">
        <div className="max-w-5xl mx-auto">
          {/* Newsletter */}
          <div className="bg-gray-900 rounded-2xl p-8 mb-14 text-center border border-gray-800">
            <h3 className="text-white font-bold text-xl mb-2">Stay in the loop</h3>
            <p className="text-gray-400 text-sm mb-6 max-w-md mx-auto">
              Get new question packs, exam tips and product updates straight to your inbox.
            </p>
            <NewsletterForm />
          </div>

          {/* Footer links */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-10 mb-12 text-sm">
            <div>
              <div className="text-white font-bold mb-3 text-lg">OxAI</div>
              <p className="text-xs leading-relaxed">
                AI-powered exam prep built by Oxford engineering students.
              </p>
            </div>
            <div>
              <div className="text-white font-semibold mb-3">Exams</div>
              <ul className="space-y-1.5 text-xs">
                <li><a href="https://www.admissionstesting.org/for-test-takers/nsaa/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">NSAA</a></li>
                <li><a href="https://www.admissionstesting.org/for-test-takers/tmua/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">TMUA</a></li>
                <li><a href="https://www.admissionstesting.org/for-test-takers/engaa/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">ENGAA</a></li>
                <li><a href="https://www.admissionstesting.org/for-test-takers/esat/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">ESAT</a></li>
              </ul>
            </div>
            <div>
              <div className="text-white font-semibold mb-3">Product</div>
              <ul className="space-y-1.5 text-xs">
                <li><Link href="/quick" className="hover:text-white transition-colors">Quick Mode</Link></li>
                <li><Link href="/paper" className="hover:text-white transition-colors">Paper Mode</Link></li>
<li><a href="mailto:hello@oxai.app" className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs">&copy; 2026 OxAI. All rights reserved.</span>
            <span className="text-xs">Made with &hearts; in Oxford</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
