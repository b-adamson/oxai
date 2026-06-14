'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// ── Scroll reveal ──────────────────────────────────────────────────────────
function useReveal(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'} ${className}`}>
      {children}
    </div>
  );
}

// ── Pie chart ───────────────────────────────────────────────────────────────
const SUBJECTS = [
  { name: 'Mathematics', count: 2000, color: '#6366f1' },
  { name: 'Physics',     count: 1000, color: '#3b82f6' },
  { name: 'Chemistry',   count: 1000, color: '#10b981' },
  { name: 'Biology',     count: 1000, color: '#f59e0b' },
];
const TOTAL = SUBJECTS.reduce((s, x) => s + x.count, 0);

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as [number, number];
}
function arc(cx: number, cy: number, r: number, a1: number, a2: number) {
  const [x1, y1] = polar(cx, cy, r, a1);
  const [x2, y2] = polar(cx, cy, r, a2);
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${a2 - a1 > 180 ? 1 : 0},1 ${x2},${y2} Z`;
}

function PieChart() {
  const [hovered, setHovered] = useState<number | null>(null);
  let cursor = 0;
  const slices = SUBJECTS.map((s, i) => {
    const deg = (s.count / TOTAL) * 360;
    const slice = { ...s, startDeg: cursor, endDeg: cursor + deg, i };
    cursor += deg;
    return slice;
  });

  return (
    <div className="flex flex-col md:flex-row items-center gap-10">
      <svg viewBox="0 0 200 200" className="w-52 h-52 shrink-0 drop-shadow-xl">
        {slices.map((s) => (
          <path
            key={s.i}
            d={arc(100, 100, hovered === s.i ? 88 : 80, s.startDeg, s.endDeg)}
            fill={s.color}
            className="transition-all duration-200 cursor-pointer"
            onMouseEnter={() => setHovered(s.i)}
            onMouseLeave={() => setHovered(null)}
            style={{ filter: hovered === s.i ? 'brightness(1.15)' : undefined }}
          />
        ))}
        <circle cx="100" cy="100" r="40" fill="white" className="dark:fill-gray-900" />
        <text x="100" y="97" textAnchor="middle" className="fill-gray-700 dark:fill-gray-300" fontSize="11" fontWeight="700">5,000+</text>
        <text x="100" y="111" textAnchor="middle" fill="#6b7280" fontSize="7.5">questions</text>
      </svg>

      <div className="flex flex-col gap-3">
        {slices.map((s) => (
          <div key={s.i}
            className={`flex items-center gap-3 cursor-pointer transition-opacity ${hovered !== null && hovered !== s.i ? 'opacity-40' : ''}`}
            onMouseEnter={() => setHovered(s.i)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 w-28">{s.name}</span>
            <span className="text-sm font-black" style={{ color: s.color }}>{s.count.toLocaleString()}</span>
            <span className="text-xs text-gray-400">{Math.round(s.count / TOTAL * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── University table ────────────────────────────────────────────────────────
const UNI_DATA: Record<string, { course: string; exam: string }[]> = {
  Oxford: [
    { course: 'Mathematics', exam: 'TMUA' },
    { course: 'Mathematics & Statistics', exam: 'TMUA' },
    { course: 'Mathematics & Computer Science', exam: 'TMUA' },
    { course: 'Computer Science', exam: 'TMUA' },
    { course: 'Computer Science & Philosophy', exam: 'TMUA' },
    { course: 'Physics', exam: 'ESAT' },
    { course: 'Physics & Philosophy', exam: 'ESAT' },
    { course: 'Engineering Science', exam: 'ESAT' },
    { course: 'Chemistry', exam: 'ESAT' },
    { course: 'Biochemistry (Molecular & Cellular)', exam: 'ESAT' },
    { course: 'Biomedical Sciences', exam: 'ESAT' },
    { course: 'Medicine', exam: 'UCAT' },
    { course: 'Most non-STEM courses (previously TSA)', exam: 'TARA' },
    { course: 'Materials Science', exam: '—' },
  ],
  Cambridge: [
    { course: 'Mathematics', exam: 'TMUA + STEP offer' },
    { course: 'Computer Science', exam: 'TMUA' },
    { course: 'Economics', exam: 'TMUA' },
    { course: 'Engineering', exam: 'ESAT' },
    { course: 'Natural Sciences', exam: 'ESAT' },
    { course: 'Chemical Engineering & Biotechnology', exam: 'ESAT' },
    { course: 'Veterinary Medicine', exam: 'ESAT' },
    { course: 'Medicine', exam: 'UCAT' },
  ],
  Imperial: [
    { course: 'Mathematics', exam: 'TMUA' },
    { course: 'Mathematics with Statistics', exam: 'TMUA' },
    { course: 'Mathematics with Applied Maths / Mathematical Physics', exam: 'TMUA' },
    { course: 'Computing', exam: 'TMUA' },
    { course: 'Joint Mathematics & Computer Science programmes', exam: 'TMUA' },
    { course: 'Aeronautical Engineering', exam: 'ESAT' },
    { course: 'Chemical Engineering', exam: 'ESAT' },
    { course: 'Civil Engineering', exam: 'ESAT' },
    { course: 'Design Engineering', exam: 'ESAT' },
    { course: 'Electrical & Electronic Engineering', exam: 'ESAT' },
    { course: 'Mechanical Engineering', exam: 'ESAT' },
    { course: 'Physics', exam: 'ESAT' },
    { course: 'Materials Science & Engineering', exam: 'ESAT' },
    { course: 'Medical Biosciences / selected life sciences', exam: 'ESAT' },
    { course: 'Medicine', exam: 'UCAT' },
  ],
};

const EXAM_PILL: Record<string, string> = {
  TMUA: 'bg-accent text-white',
  ESAT: 'bg-emerald-500 text-white',
  UCAT: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  TARA: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  'TMUA + STEP offer': 'bg-accent text-white',
  '—': 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
};

function examPill(exam: string) {
  const base = 'text-xs font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap';
  const cls = EXAM_PILL[exam] ?? 'bg-gray-100 text-gray-500';
  return `${base} ${cls}`;
}

function UniTable() {
  const [tab, setTab] = useState<keyof typeof UNI_DATA>('Oxford');
  return (
    <div>
      <div className="flex gap-2 mb-5">
        {Object.keys(UNI_DATA).map(u => (
          <button key={u} onClick={() => setTab(u as keyof typeof UNI_DATA)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              tab === u ? 'bg-accent text-white shadow-md shadow-accent/20' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}>
            {u}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900 text-left">
              <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 w-full">Course</th>
              <th className="px-4 py-3 font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Admissions Test</th>
            </tr>
          </thead>
          <tbody>
            {UNI_DATA[tab].map((row, i) => (
              <tr key={i} className="border-t border-gray-100 dark:border-gray-800 even:bg-gray-50/40 dark:even:bg-gray-900/40">
                <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{row.course}</td>
                <td className="px-4 py-3">
                  <span className={examPill(row.exam)}>{row.exam}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function AboutPage() {
  return (
    <main className="bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-x-hidden">

      {/* ── HERO ── */}
      <section className="relative min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-24 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/4 w-[900px] h-[900px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(45,140,240,0.07) 0%, transparent 65%)' }} />
        <Reveal className="relative z-10 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-accent/10 text-accent text-xs font-bold px-4 py-1.5 rounded-full mb-6">
            🎓 Undergraduate students at New College, Oxford
          </div>
          <h1 className="text-4xl sm:text-6xl font-black tracking-tight mb-6 leading-tight">
            Built by students,<br />
            <span className="text-accent">for students.</span>
          </h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
            We sat the PAT and TMUA to get into New College, Oxford. We know how it feels. So we built the tool we wish we had.
          </p>
        </Reveal>
      </section>

      {/* ── STORY ── */}
      <section className="py-20 px-6 bg-gray-50 dark:bg-gray-900/50">
        <div className="max-w-3xl mx-auto space-y-8">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-3">Our story</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-6">We felt the gap ourselves.</h2>
          </Reveal>
          <Reveal delay={100}>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed text-lg">
              As students who studied for the PAT recently, we know how stressful exam-time can be. The biggest constraint we faced was a lack of past-paper material that was actually <em>relevant</em>.
            </p>
          </Reveal>
          <Reveal delay={150}>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { icon: '📅', text: 'Papers from pre-2016 are outdated. The syllabus has changed significantly since then and the old material reflects it.' },
                { icon: '📝', text: 'Most PAT/MAT questions are long-form. Helpful for interviews, but not the punchy MCQ format of the modern ESAT or TMUA.' },
                { icon: '➗', text: 'MAT questions only cover maths, and sometimes assume calculus knowledge that is not relevant for the ESAT.' },
                { icon: '🧪', text: 'Very little chemistry and biology material exists outside of NSAA past papers. That is a huge gap for ESAT candidates.' },
              ].map((item, i) => (
                <Reveal key={i} delay={i * 60}>
                  <div className="flex gap-3 bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
                    <span className="text-2xl shrink-0">{item.icon}</span>
                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{item.text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </Reveal>
          <Reveal delay={200}>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed text-lg">
              What you really need is a large, <strong className="text-gray-800 dark:text-gray-200">unending corpus</strong>{' '}of maths, physics, chemistry and biology questions trained on the latest NSAA, ENGAA, ESAT and TMUA past papers, grounded against each exam&apos;s official syllabus as a hard guideline, with full worked solutions, variable difficulty, and an intelligent tutor to guide you through each one. That is what we built.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── QUESTION BANK ── */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-3">The question bank</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">5,000+ questions and growing.</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-2xl leading-relaxed">
              The database is ever-expanding. Every time you generate a question it gets added to our database and queued for manual review, so the total corpus keeps growing. Need 100 questions on circuits at difficulty 5? We have you covered.
            </p>
          </Reveal>

          <Reveal delay={60}>
            <div className="grid sm:grid-cols-3 gap-4 mb-12">
              {[
                {
                  icon: '🏆',
                  title: 'Trained on olympiad material',
                  body: 'To push difficulty to the top end, the model was also trained on IMO, BMO and Physics Olympiad problems. Higher-difficulty questions draw on this to produce genuinely hard, multi-step problems.',
                },
                {
                  icon: '✅',
                  title: 'Automatic answer verification',
                  body: 'Every generated question goes through an automated post-verification step that independently solves the problem and checks the result matches the provided answer key. Questions that fail are discarded and regenerated.',
                },
                {
                  icon: '📋',
                  title: 'Worked solution coherence check',
                  body: 'A second verification pass checks that the worked solution is logically consistent with both the question stem and the correct answer. This catches cases where the solution explains a different route to the right answer.',
                },
              ].map((card, i) => (
                <Reveal key={i} delay={i * 80}>
                  <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm h-full">
                    <span className="text-3xl mb-3 block">{card.icon}</span>
                    <p className="font-bold text-gray-800 dark:text-gray-200 mb-2 text-sm">{card.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{card.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </Reveal>

          <Reveal delay={80}>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-12 max-w-2xl">
              Generation takes around 25 seconds per question because of these verification steps. Until your custom set is ready, 5,000 pre-generated and verified questions are waiting for you right now.
            </p>
          </Reveal>

          <Reveal delay={100}>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-3xl border border-gray-100 dark:border-gray-800 p-8 sm:p-12 shadow-sm">
              <PieChart />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 2024 CHANGES ── */}
      <section className="py-24 px-6 bg-gray-50 dark:bg-gray-900/50">
        <div className="max-w-3xl mx-auto">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-3">Exam landscape</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-6">What exams will I need to sit?</h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed text-lg mb-8">
              In 2024 the system changed significantly. Previously, STEM entrance exams ranged across the PAT, MAT, NSAA, TMUA, ENGAA and STEP. Now, all science-based ones have been consolidated into just <strong className="text-gray-800 dark:text-gray-200">two exams</strong>: the ESAT and the TMUA.
            </p>
          </Reveal>

          {/* Discontinued callout */}
          <Reveal delay={120}>
            <div className="rounded-2xl border border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-900/10 px-6 py-5 mb-8 flex gap-4 items-start">
              <span className="text-2xl shrink-0 mt-0.5">🪦</span>
              <div>
                <p className="font-bold text-red-700 dark:text-red-400 mb-1">Discontinued as of 2024</p>
                <p className="text-sm text-red-600 dark:text-red-400/80">
                  The <strong>MAT</strong> (Mathematics Admissions Test), <strong>PAT</strong> (Physics Aptitude Test), and <strong>BMAT</strong> (BioMedical Admissions Test) have all been discontinued. Do not rely on them as your primary prep material.
                </p>
              </div>
            </div>
          </Reveal>

          {/* ESAT + TMUA highlight */}
          <Reveal delay={160}>
            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              {[
                {
                  name: 'ESAT',
                  color: 'emerald',
                  icon: '🔬',
                  desc: 'Engineering & Science Admissions Test. Covers maths, physics, chemistry, and biology. Required for most STEM courses at Oxford, Cambridge, and Imperial.',
                  tag: 'We can help ✓',
                },
                {
                  name: 'TMUA',
                  color: 'accent',
                  icon: '📐',
                  desc: 'Test of Mathematics for University Admission. Required for maths, computer science, and economics courses at Oxford, Cambridge, and Imperial.',
                  tag: 'We can help ✓',
                },
              ].map((exam) => (
                <div key={exam.name} className={`rounded-2xl border-2 p-6 ${
                  exam.color === 'emerald'
                    ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10'
                    : 'border-accent/30 bg-accent/5 dark:bg-accent/10'
                }`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">{exam.icon}</span>
                    <span className={`text-xl font-black ${exam.color === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' : 'text-accent'}`}>{exam.name}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">{exam.desc}</p>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                    exam.color === 'emerald'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-accent text-white'
                  }`}>{exam.tag}</span>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={180}>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Check the course page for your chosen university to confirm which test you need. A full breakdown is below.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── UNIVERSITY TABLE ── */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-widest text-accent mb-3">By university</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Course → exam lookup</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-8 text-sm">Select your university to see which test each course requires.</p>
          </Reveal>
          <Reveal delay={80}>
            <UniTable />
          </Reveal>
          <Reveal delay={120}>
            <div className="flex flex-wrap gap-3 mt-6 text-xs">
              {[
                { label: 'ESAT', cls: 'bg-emerald-500 text-white' },
                { label: 'TMUA', cls: 'bg-accent text-white' },
                { label: 'UCAT / TARA', cls: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
                { label: 'No test required', cls: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500' },
              ].map(l => (
                <span key={l.label} className={`px-3 py-1 rounded-full font-semibold ${l.cls}`}>{l.label}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 bg-accent text-white text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl font-black mb-4">Ready to start?</h2>
          <p className="text-blue-100 mb-8 max-w-md mx-auto">5,000+ questions, every past paper, full worked solutions. One month free.</p>
          <Link href="/quick"
            className="inline-flex items-center gap-2 bg-white text-accent font-bold px-8 py-3.5 rounded-full text-base hover:bg-blue-50 transition-colors shadow-lg">
            Get started →
          </Link>
        </Reveal>
      </section>
    </main>
  );
}
