import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Info, Lightbulb, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { id: 'window', title: "The context window is Claude's working memory" },
  { id: 'quality', title: "A full window decreases the quality of Claude's work" },
  { id: 'monitor', title: 'Monitor the window with /context' },
  { id: 'reset', title: 'Reset with /clear between tasks, /compact in a task' },
  { id: 'design', title: 'Use less context by design' },
  { id: 'recap', title: 'Recap' },
] as const;

const SECTION_IDS: string[] = SECTIONS.map((s) => s.id);

const VARIANTS = [
  { key: 'A', name: 'Dots' },
  { key: 'B', name: 'Rail' },
  { key: 'C', name: 'Spine' },
] as const;

type VariantKey = (typeof VARIANTS)[number]['key'];

function useCompassState() {
  const [active, setActive] = useState<string>(SECTION_IDS[0]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const marker = window.innerHeight * 0.3;
      let current: string = SECTION_IDS[0];
      for (const id of SECTION_IDS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= marker) current = id;
      }
      setActive(current);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return { active, progress };
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function DotsCompass({ active }: { active: string }) {
  return (
    <nav className="fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-center gap-3 lg:flex">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          aria-label={s.title}
          aria-current={active === s.id ? 'true' : undefined}
          onClick={() => scrollToSection(s.id)}
          className="group relative flex items-center justify-center"
        >
          <span
            className={cn(
              'block rounded-full transition-all duration-300',
              active === s.id ? 'h-7 w-2 bg-primary' : 'h-2 w-2 bg-[#c9ccd6] group-hover:bg-[#9aa0af]'
            )}
          />
          <span className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
            {s.title}
          </span>
        </button>
      ))}
    </nav>
  );
}

function RailCompass({ active }: { active: string }) {
  const [open, setOpen] = useState(false);
  return (
    <nav
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      className="fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 lg:block"
    >
      {open ? (
        <div className="flex w-[280px] flex-col gap-0.5 rounded-xl border border-border bg-card p-2 shadow-lg">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className={cn(
                'rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors',
                active === s.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {s.title}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-1 pl-4">
          {SECTIONS.map((s) => (
            <span
              key={s.id}
              className={cn(
                'block h-2 w-2 rounded-full transition-colors',
                active === s.id ? 'bg-primary' : 'bg-[#c9ccd6]'
              )}
            />
          ))}
        </div>
      )}
    </nav>
  );
}

function SpineCompass({ active, progress }: { active: string; progress: number }) {
  const activeIndex = SECTION_IDS.indexOf(active);
  return (
    <nav className="fixed right-6 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-center gap-3 lg:flex">
      <div className="relative h-[240px] w-3">
        <span className="absolute left-1/2 top-0 h-full w-[3px] -translate-x-1/2 rounded-full bg-[#e2e4ec]" />
        <span
          className="absolute left-1/2 top-0 w-[3px] -translate-x-1/2 rounded-full bg-primary transition-[height] duration-200"
          style={{ height: `${Math.round(progress * 100)}%` }}
        />
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            aria-label={s.title}
            aria-current={active === s.id ? 'true' : undefined}
            onClick={() => scrollToSection(s.id)}
            style={{ top: `${(i / (SECTIONS.length - 1)) * 100}%` }}
            className="group absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            <span
              className={cn(
                'block rounded-full border-2 transition-all duration-200',
                i <= activeIndex ? 'border-primary bg-primary' : 'border-[#c9ccd6] bg-card',
                active === s.id ? 'h-3.5 w-3.5 ring-4 ring-primary/15' : 'h-2.5 w-2.5'
              )}
            />
            <span className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
              {s.title}
            </span>
          </button>
        ))}
      </div>
      <span className="text-[11px] font-bold text-muted-foreground">
        {activeIndex + 1} / {SECTIONS.length}
      </span>
    </nav>
  );
}

function PrototypeSwitcher({ variant }: { variant: VariantKey }) {
  const [, setSearchParams] = useSearchParams();
  const index = VARIANTS.findIndex((v) => v.key === variant);

  const cycle = (delta: number) => {
    const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length];
    setSearchParams({ variant: next.key }, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#171a26] px-2 py-1.5 text-white shadow-xl">
      <button
        aria-label="Previous variant"
        onClick={() => cycle(-1)}
        className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[110px] px-1 text-center text-xs font-bold tracking-wide">
        {variant} · {VARIANTS[index].name}
      </span>
      <button
        aria-label="Next variant"
        onClick={() => cycle(1)}
        className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function InlineCode({ children }: { children: string }) {
  return (
    <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-[12.5px] text-accent-foreground">
      {children}
    </code>
  );
}

function Callout({
  tone,
  label,
  icon,
  children,
}: {
  tone: 'note' | 'tip';
  label: string;
  icon: React.ReactNode;
  children: string;
}) {
  return (
    <div className={cn('flex gap-2.5 rounded-[10px] p-3.5', tone === 'note' ? 'bg-accent' : 'bg-[#e8f5ef]')}>
      <span className={cn('mt-0.5 shrink-0', tone === 'note' ? 'text-accent-foreground' : 'text-[#157a52]')}>
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <span
          className={cn(
            'text-[11px] font-bold uppercase tracking-[0.06em]',
            tone === 'note' ? 'text-accent-foreground' : 'text-[#157a52]'
          )}
        >
          {label}
        </span>
        <p className="text-[13.5px] leading-relaxed text-foreground">{children}</p>
      </div>
    </div>
  );
}

function SectionHeading({ id, title }: { id: string; title: string }) {
  return (
    <h2 id={id} className="scroll-mt-8 text-[25px] font-bold tracking-tight text-foreground">
      {title}
    </h2>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-[1.7] text-foreground">{children}</p>;
}

export default function LessonCompassPrototype() {
  const [searchParams] = useSearchParams();
  const raw = searchParams.get('variant');
  const variant: VariantKey = raw === 'B' || raw === 'C' ? raw : 'A';
  const { active, progress } = useCompassState();

  return (
    <div className="min-h-screen bg-background py-10 font-sans">
      <div className="mx-auto max-w-[880px] px-7">
        <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card px-[26px] py-6">
          <div className="flex items-center gap-2.5">
            <span className="rounded-[7px] bg-accent px-[11px] py-[5px] text-[11px] font-bold uppercase tracking-[0.06em] text-accent-foreground">
              Lesson
            </span>
            <h1 className="flex-1 text-[28px] font-extrabold tracking-tight text-foreground">
              Managing Context in Claude Code
            </h1>
            <span className="whitespace-nowrap text-xs text-[#9aa0af]">6 min read</span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-primary">Summary</span>
            <Body>
              Claude Code keeps your full session in a limited space. This space is the context window. When the
              window becomes full, the quality of Claude's work decreases. This lesson shows you how to monitor the
              window, how to reset it correctly, and how to use less of it.
            </Body>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex aspect-video flex-col items-center justify-center gap-2.5 rounded-[14px] bg-muted">
              <Play className="h-12 w-12 text-muted-foreground" />
              <span className="text-[13.5px] text-muted-foreground">The Workbench</span>
            </div>
            <span className="text-xs text-[#9aa0af]">
              Video: 2 min 30 s. The video repeats the main idea of this lesson. You can read the lesson without it.
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionHeading id="window" title={SECTIONS[0].title} />
            <Body>
              The context window is all the information that Claude can see at one time. Think of it as a workbench.
              Everything that Claude works with must fit on the surface. In Claude Code, the window holds
              approximately 200,000 tokens. This is the size of a 500-page book. That sounds large. It is not,
              because many items count against it.
            </Body>
            <Body>Your typed messages are the smallest part. The window also holds:</Body>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-[1.7] text-foreground">
              <li>The system prompt and your CLAUDE.md files. Claude Code loads them at the start of each session.</li>
              <li>Each reply that Claude writes.</li>
              <li>Each tool result. This includes each file that Claude reads and each command output.</li>
            </ul>
            <Body>
              Tool results use the most space in real sessions. When Claude reads a file of 2,000 lines to examine
              one function, the full file goes into the window. When a test run prints 800 lines of output, all 800
              lines go into the window. They stay there.
            </Body>
            <Body>
              <strong className="font-bold">Everything accumulates.</strong> The window keeps the full history of the
              session. Nothing leaves the window on its own.
            </Body>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionHeading id="quality" title={SECTIONS[1].title} />
            <Body>
              You see the problem indirectly at first. Claude asks again about a decision that you made before.
              Claude does not obey a constraint that you set at the start. The instruction is still in the window.
              But it must compete with all the data that came after it.
            </Body>
            <Body>
              When the window is almost full, Claude Code starts{' '}
              <strong className="font-bold">auto-compaction</strong>. Auto-compaction replaces the older history with
              a summary. The summary keeps the thread of your work. But the summary loses detail. It can lose an
              exact error message or the reason for a decision. Auto-compaction also occurs at a time that you did
              not select.
            </Body>
            <Callout tone="note" label="Note" icon={<Info className="h-4 w-4" />}>
              Auto-compaction is a safety net. It is not a strategy. Stay ahead of it with the two commands in this
              lesson.
            </Callout>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionHeading id="monitor" title={SECTIONS[2].title} />
            <Body>
              Use the <InlineCode>/context</InlineCode> command to see what uses the window. The command shows the
              system prompt, the memory files, the conversation history, and the tool results.
            </Body>
            <Body>Use the command at these two times:</Body>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-[1.7] text-foreground">
              <li>Before you start a large task in an open session. Make sure that there is space for the task.</li>
              <li>When Claude does not obey your instructions. Make sure that your CLAUDE.md file loaded.</li>
            </ul>
            <Callout tone="tip" label="Tip" icon={<Lightbulb className="h-4 w-4" />}>
              Open a session from earlier today and run /context. Compare the space that your instructions use with
              the space that the conversation and the tool results use. The ratio surprises most people.
            </Callout>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionHeading id="reset" title={SECTIONS[3].title} />
            <Body>
              Two commands make space in the window. Ask one question to select the correct command: does my next
              message depend on the messages above it?
            </Body>
            <Body>
              <strong className="font-bold">
                If the answer is no, use <InlineCode>/clear</InlineCode>.
              </strong>{' '}
              You get a new, empty window immediately. This is safe. Claude Code saves the old conversation. You can
              open it again with <InlineCode>/resume</InlineCode>. Your CLAUDE.md files load again automatically. Use
              /clear each time you change to an unrelated task.
            </Body>
            <Body>
              <strong className="font-bold">
                If the answer is yes, use <InlineCode>/compact</InlineCode> and give it instructions.
              </strong>{' '}
              The /compact command replaces the history with a summary and continues. Without instructions, the
              command guesses what is important. With instructions, it does not guess:
            </Body>
            <pre className="overflow-x-auto rounded-lg border border-border bg-background px-3.5 py-2.5">
              <code className="font-mono text-[12.5px] text-foreground">
                /compact Keep the failing test, the root cause we found, and the fix we agreed on
              </code>
            </pre>
            <Body>Tell the command what the summary must keep: decisions, constraints, and the current plan.</Body>
            <Callout tone="tip" label="We recommend" icon={<Check className="h-4 w-4" />}>
              When you complete a task, use /clear. When you are deep in a task, use /compact with instructions. Do
              not wait for auto-compaction.
            </Callout>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionHeading id="design" title={SECTIONS[4].title} />
            <Body>The two commands manage a full window. Two design choices keep the window from filling quickly.</Body>
            <Body>
              <strong className="font-bold">Put durable knowledge in CLAUDE.md.</strong> Do you explain the same
              facts in each session? Put the build commands, the conventions, and the rules in a CLAUDE.md file.
              Claude Code loads this file automatically at the start of each session. You explain the facts one
              time. Keep the file below 200 lines, because each line loads in each session.
            </Body>
            <Body>
              <strong className="font-bold">Send large searches to subagents.</strong> Ask Claude to use a subagent
              for a large search task. The subagent does the search in its own context window. It returns only a
              short report. The many lines of search results do not touch your session.
            </Body>
            <Body>
              <strong className="font-bold">Give paths, not pastes.</strong> Point Claude to a file. Do not paste the
              content of the file into the chat. Claude reads what it needs, when it needs it.
            </Body>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionHeading id="recap" title={SECTIONS[5].title} />
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-[1.7] text-foreground">
              <li>The context window holds everything: your instructions, Claude's replies, and all tool results.</li>
              <li>Use /context to see what uses the window.</li>
              <li>Use /clear between tasks. Use /compact with instructions in a task.</li>
              <li>Put durable knowledge in CLAUDE.md. Send large searches to subagents.</li>
            </ul>
          </div>
        </div>
      </div>

      {variant === 'A' && <DotsCompass active={active} />}
      {variant === 'B' && <RailCompass active={active} />}
      {variant === 'C' && <SpineCompass active={active} progress={progress} />}
      <PrototypeSwitcher variant={variant} />
    </div>
  );
}
