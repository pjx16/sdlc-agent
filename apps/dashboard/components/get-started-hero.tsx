import Link from 'next/link';
import { CreateTicketButton } from '@/components/create-ticket/create-ticket-button';
import { NewProjectButton } from '@/components/new-project/new-project-button';
import type { HeroState } from '@/lib/hero-state';
import type { TicketFormData } from '@/lib/ticket-form-data';

const STEPS = ['Connect a repository', 'Write a ticket', 'Approve the plan'] as const;
const ONBOARDING_LINE = {
  profiling: 'It is being profiled now. This takes a few minutes.',
  proposed: 'The proposal is ready for your review.',
  draft: 'Profiling did not finish. Open it to see why and try again.',
} as const;

/** The step of the way in that this state is at, so the strip can mark it. */
const stepOf = (state: HeroState): number => (state.kind === 'ready' ? 1 : 0);

/**
 * The band at the top of the Dashboard: one line about where to go next and one button, always 20% of the screen high (never less than
 * about 150px), so a new person sees at once how to start, and a regular one has a way to start a ticket at hand.
 */
export function GetStartedHero({ state, formData }: { state: HeroState; formData: TicketFormData }) {
  const copy = (() => {
    switch (state.kind) {
      case 'setup':
        return { eyebrow: 'Setup', title: 'Connect GitHub and Anthropic', text: 'The agents need both before they can work.', primary: <Link href="/setup/connections" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text">Finish setup →</Link>, secondary: null };
      case 'no-project':
        return {
          eyebrow: 'Get started',
          title: 'Connect a repository',
          text: 'sdlc-agent profiles it and proposes the setup. About three minutes.',
          primary: <NewProjectButton />,
          secondary: (
            <a href="https://github.com/pjx16/sdlc-agent#how-it-works" target="_blank" rel="noopener noreferrer" className="text-sm text-muted hover:text-text">
              How it works ↗
            </a>
          ),
        };
      case 'onboarding':
        return {
          eyebrow: 'Almost there',
          title: `Finish setting up ${state.name}`,
          text: ONBOARDING_LINE[state.status],
          primary: <Link href={`/projects/${state.projectId}`} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text">Open the project →</Link>,
          secondary: null,
        };
      case 'ready':
        return {
          eyebrow: 'Next up',
          title: 'What should we build next?',
          text: 'Describe it. The agents plan it, you approve, and a pull request follows.',
          primary: <CreateTicketButton data={formData} />,
          secondary: (
            <Link href="/tickets" className="text-sm text-muted hover:text-text">
              View tickets
            </Link>
          ),
        };
    }
  })();
  const current = stepOf(state);

  return (
    <section aria-label="Get started" data-state={state.kind} className="panel relative flex h-[20vh] min-h-[148px] items-center justify-between gap-6 overflow-hidden px-8">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-2/3" style={{ background: 'radial-gradient(40rem 14rem at 100% 50%, var(--accent-soft), transparent 70%)' }} />
      <div className="relative min-w-0">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2 className="mt-1 text-xl font-semibold">{copy.title}</h2>
        <p className="mt-1 text-sm text-muted">{copy.text}</p>
        {state.kind !== 'setup' && (
          <ol aria-label="The way in" className="mt-3 hidden gap-2 font-mono text-xs lg:flex">
            {STEPS.map((step, i) => (
              <li key={step} aria-current={i === current ? 'step' : undefined} className={i === current ? 'text-accent' : 'text-muted'}>
                {i + 1}. {step}
                {i < STEPS.length - 1 && <span aria-hidden> →</span>}
              </li>
            ))}
            <li className="text-muted">
              <span aria-hidden>→ </span>PR
            </li>
          </ol>
        )}
      </div>
      <div className="relative flex shrink-0 items-center gap-4">
        {copy.secondary}
        {copy.primary}
      </div>
    </section>
  );
}
