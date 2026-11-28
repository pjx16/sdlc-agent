'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { OnboardForm } from '@/components/onboard-form';
import { ProjectForm } from '@/components/project-form';

export type NewProjectMode = 'quick' | 'manual';

const MODES: { id: NewProjectMode; label: string }[] = [
  { id: 'quick', label: 'Quick start (recommended)' },
  { id: 'manual', label: 'Manual' },
];

/**
 * Creates a project (one repository sdlc-agent works on) without leaving the page. Quick start asks for the repository and proposes the
 * rest; Manual is every setting by hand, in folding sections because the form is long.
 */
export function NewProjectModal({ open, onClose, onCreated, mode: initialMode = 'quick' }: { open: boolean; onClose: () => void; onCreated: (id: string) => void; mode?: NewProjectMode }) {
  const [mode, setMode] = useState<NewProjectMode>(initialMode);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setDirty(false);
    }
  }, [open, initialMode]);

  return (
    <Modal open={open} onClose={onClose} title="New project" description="A project is one repository sdlc-agent works on. You can add as many as you like." size={mode === 'manual' ? 'lg' : 'md'} dirty={dirty}>
      <div role="tablist" aria-label="How to create it" className="mb-5 inline-flex rounded-md border border-border text-sm">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => {
              setMode(m.id);
              setDirty(false); // each form starts empty
            }}
            className={`px-4 py-1.5 first:rounded-l-md last:rounded-r-md ${mode === m.id ? 'bg-accent text-accent-text' : 'text-muted hover:text-text'}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'quick' ? <OnboardForm onCreated={onCreated} onDirtyChange={setDirty} /> : <ProjectForm collapsible onCreated={onCreated} onDirtyChange={setDirty} />}
    </Modal>
  );
}
