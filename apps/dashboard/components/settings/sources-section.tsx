'use client';

import { Check, Section, Select } from '@/components/form';

/** Where new tickets come from, and what to do about a GitHub issue for a ticket written in the dashboard. Saved with the rest, by Save. */
export function SourcesSection({ intakePaused }: { intakePaused: boolean }) {
  return (
    <Section
      title="Ticket sources"
      description={intakePaused ? 'Intake is paused as a whole: nothing is taken from any source. Resume it from the bar at the top.' : 'Where new tickets come from. Switch one off to stop taking tickets from it. Work already in the pipeline is not affected.'}
    >
      <Check path="intakeGithubEnabled" label="GitHub" hint="Issues and GitHub Projects boards, per project (recommended: a Projects board)" />
      <Check path="intakeJiraEnabled" label="Jira" hint="The projects that use Jira" />
      <Check path="intakePasteEnabled" label="Pasted tickets" hint="Tickets written in the dashboard" />
      <Select
        path="githubIssueOnCreate"
        label="GitHub issue for a new ticket"
        options={[
          { value: 'ask', label: 'Ask me each time' },
          { value: 'always', label: 'Always create one' },
          { value: 'never', label: 'Never' },
        ]}
        hint="For a ticket written in the dashboard, in a project that uses GitHub. The same for every project."
      />
    </Section>
  );
}
