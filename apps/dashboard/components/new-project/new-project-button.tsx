'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NewProjectModal, type NewProjectMode } from './new-project-modal';

const VARIANT = {
  primary: 'rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text',
  secondary: 'rounded-md border border-border px-4 py-2 text-sm',
} as const;

/**
 * Opens the New project modal in place. With `defaultOpen` it starts open (a link to /projects/new, or /projects/new?manual=1), and closing
 * it goes back to /projects so the address bar matches what is on the screen.
 */
export function NewProjectButton({ variant = 'primary', defaultOpen, label = 'New project', defaultGithubAuth }: { variant?: keyof typeof VARIANT; defaultOpen?: NewProjectMode; label?: string; defaultGithubAuth?: 'token' | 'bot' }) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const close = () => {
    setOpen(false);
    if (defaultOpen) router.replace('/projects');
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={VARIANT[variant]}>
        {label}
      </button>
      <NewProjectModal
        open={open}
        mode={defaultOpen ?? 'quick'}
        defaultGithubAuth={defaultGithubAuth}
        onClose={close}
        onCreated={(id) => {
          setOpen(false);
          router.push(`/projects/${id}`); // the page profiles it, and shows its progress
        }}
      />
    </>
  );
}
