import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  FileText,
  Heart,
  HelpCircle,
  Info,
  Lightbulb,
  PanelLeft,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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

const SIDEBAR_LESSONS = [
  { title: 'What is Claude Code?', duration: '5 min', icon: 'video', completed: true, current: false },
  { title: 'Managing Context in Claude Code', duration: '6 min', icon: 'document', completed: false, current: true },
  { title: 'Managing Context: Quiz', duration: '4 min', icon: 'quiz', completed: false, current: false },
  { title: 'Skills and Subagents', duration: '8 min', icon: 'video', completed: false, current: false },
] as const;

function useActiveSection(scrollRef: RefObject<HTMLElement>) {
  const [active, setActive] = useState<string>(SECTION_IDS[0]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const marker = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.3;
      let current = SECTION_IDS[0];
      for (const id of SECTION_IDS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= marker) current = id;
      }
      if (Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight - 2) {
        current = SECTION_IDS[SECTION_IDS.length - 1];
      }
      setActive(current);
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [scrollRef]);

  return active;
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

function LessonTypeIcon({ kind }: { kind: string }) {
  if (kind === 'video') return <Play className="h-3.5 w-3.5" />;
  if (kind === 'quiz') return <HelpCircle className="h-3.5 w-3.5" />;
  return <FileText className="h-3.5 w-3.5" />;
}

function CourseSidebar() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-[#eceef3] px-[18px] pb-3.5 pt-[18px]">
        <h2 className="mb-3 font-display text-[15px] font-extrabold leading-[1.3]">Working with Claude Code</h2>
        <div className="mb-[7px] flex justify-between text-xs font-semibold text-muted-foreground">
          <span>Progress</span>
          <span className="text-foreground">1/4 · 25%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#eceef3]">
          <div className="h-full rounded-full bg-primary" style={{ width: '25%' }} />
        </div>
        <Button variant="outline" size="sm" className="mt-3.5 w-full rounded-[10px] text-[12.5px] font-bold">
          <Heart aria-hidden="true" className="mr-2 h-4 w-4" />
          Add to favorites
        </Button>
      </div>
      <div className="max-h-[520px] overflow-y-auto">
        <div className="bg-[#f7f8fa] px-[18px] py-[9px] text-[11.5px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
          Module 1: Working with Claude Code
        </div>
        {SIDEBAR_LESSONS.map((lesson) => (
          <button
            key={lesson.title}
            className={cn(
              'flex w-full items-center gap-[11px] border-l-[3px] px-[18px] py-[11px] text-left transition-colors',
              lesson.current ? 'border-l-primary bg-accent' : 'border-l-transparent hover:bg-[#f3f4f8]'
            )}
          >
            <span
              className={cn(
                'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full',
                lesson.completed ? 'bg-success text-success-foreground' : 'bg-[#eceef3] text-muted-foreground'
              )}
            >
              {lesson.completed ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <LessonTypeIcon kind={lesson.icon} />}
            </span>
            <span
              className={cn(
                'flex-1 text-[13px] font-semibold',
                lesson.completed && !lesson.current ? 'text-[#9aa0af]' : 'text-foreground'
              )}
            >
              {lesson.title}
            </span>
            <span className="text-[11px] text-[#9aa0af]">{lesson.duration}</span>
          </button>
        ))}
      </div>
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

function LessonContent() {
  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card px-[26px] py-6">
      <div className="flex items-center gap-2.5">
        <span className="rounded-[7px] bg-accent px-[11px] py-[5px] text-[11px] font-bold uppercase tracking-[0.06em] text-accent-foreground">
          Document
        </span>
        <h1 className="flex-1 text-[28px] font-extrabold tracking-tight text-foreground">
          Managing Context in Claude Code
        </h1>
        <span className="whitespace-nowrap text-xs text-[#9aa0af]">6 min read</span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-primary">Summary</span>
        <Body>
          Claude Code keeps your full session in a limited space. This space is the context window. When the window
          becomes full, the quality of Claude's work decreases. This lesson shows you how to monitor the window, how
          to reset it correctly, and how to use less of it.
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
          Everything that Claude works with must fit on the surface. In Claude Code, the window holds approximately
          200,000 tokens. This is the size of a 500-page book. That sounds large. It is not, because many items
          count against it.
        </Body>
        <Body>Your typed messages are the smallest part. The window also holds:</Body>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-[1.7] text-foreground">
          <li>The system prompt and your CLAUDE.md files. Claude Code loads them at the start of each session.</li>
          <li>Each reply that Claude writes.</li>
          <li>Each tool result. This includes each file that Claude reads and each command output.</li>
        </ul>
        <Body>
          Tool results use the most space in real sessions. When Claude reads a file of 2,000 lines to examine one
          function, the full file goes into the window. When a test run prints 800 lines of output, all 800 lines go
          into the window. They stay there.
        </Body>
        <Body>
          <strong className="font-bold">Everything accumulates.</strong> The window keeps the full history of the
          session. Nothing leaves the window on its own.
        </Body>
      </div>

      <div className="flex flex-col gap-2.5">
        <SectionHeading id="quality" title={SECTIONS[1].title} />
        <Body>
          You see the problem indirectly at first. Claude asks again about a decision that you made before. Claude
          does not obey a constraint that you set at the start. The instruction is still in the window. But it must
          compete with all the data that came after it.
        </Body>
        <Body>
          When the window is almost full, Claude Code starts <strong className="font-bold">auto-compaction</strong>.
          Auto-compaction replaces the older history with a summary. The summary keeps the thread of your work. But
          the summary loses detail. It can lose an exact error message or the reason for a decision. Auto-compaction
          also occurs at a time that you did not select.
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
          Open a session from earlier today and run /context. Compare the space that your instructions use with the
          space that the conversation and the tool results use. The ratio surprises most people.
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
          The /compact command replaces the history with a summary and continues. Without instructions, the command
          guesses what is important. With instructions, it does not guess:
        </Body>
        <pre className="overflow-x-auto rounded-lg border border-border bg-background px-3.5 py-2.5">
          <code className="font-mono text-[12.5px] text-foreground">
            /compact Keep the failing test, the root cause we found, and the fix we agreed on
          </code>
        </pre>
        <Body>Tell the command what the summary must keep: decisions, constraints, and the current plan.</Body>
        <Callout tone="tip" label="We recommend" icon={<Check className="h-4 w-4" />}>
          When you complete a task, use /clear. When you are deep in a task, use /compact with instructions. Do not
          wait for auto-compaction.
        </Callout>
      </div>

      <div className="flex flex-col gap-2.5">
        <SectionHeading id="design" title={SECTIONS[4].title} />
        <Body>The two commands manage a full window. Two design choices keep the window from filling quickly.</Body>
        <Body>
          <strong className="font-bold">Put durable knowledge in CLAUDE.md.</strong> Do you explain the same facts
          in each session? Put the build commands, the conventions, and the rules in a CLAUDE.md file. Claude Code
          loads this file automatically at the start of each session. You explain the facts one time. Keep the file
          below 200 lines, because each line loads in each session.
        </Body>
        <Body>
          <strong className="font-bold">Send large searches to subagents.</strong> Ask Claude to use a subagent for
          a large search task. The subagent does the search in its own context window. It returns only a short
          report. The many lines of search results do not touch your session.
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

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#eceef3] pt-[18px]">
        <Button variant="outline" className="rounded-[10px] border-[#dcdee6] text-[13px] font-bold">
          <ArrowLeft aria-hidden="true" />
          Previous
        </Button>
        <Button className="h-auto rounded-[10px] px-[18px] py-2.5 text-[13.5px] font-bold">
          <CheckCircle2 aria-hidden="true" />
          Mark as complete
        </Button>
        <Button variant="outline" className="rounded-[10px] border-[#dcdee6] text-[13px] font-bold">
          Next
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export default function LessonCompassPrototype() {
  const scrollRef = useRef<HTMLElement>(null);
  const active = useActiveSection(scrollRef);

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background font-sans">
      <header className="flex h-[58px] shrink-0 items-center gap-2 border-b bg-card px-7">
        <Button variant="ghost" size="icon" className="-ml-2 h-7 w-7" aria-label="Toggle sidebar">
          <PanelLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <span className="text-[13px] font-bold text-foreground">Working with Claude Code</span>
        <div className="flex-1" />
        <span className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-[7px] border border-[#d7ddf4] bg-accent px-[13px] py-1.5 text-xs font-bold text-accent-foreground">
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          Viewing as: Learner
        </span>
      </header>
      <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1140px] px-8 pb-14 pt-[30px]">
          <div className="grid items-start gap-5 lg:grid-cols-[320px,1fr]">
            <CourseSidebar />
            <LessonContent />
          </div>
        </div>
      </main>
      <DotsCompass active={active} />
    </div>
  );
}
