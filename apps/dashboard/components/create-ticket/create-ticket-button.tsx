'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { TicketFormData } from '@/lib/ticket-form-data';
import { CreateTicketModal } from './create-ticket-modal';

const VARIANT = {
  primary: 'rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text',
  secondary: 'rounded-md border border-border px-4 py-2 text-sm',
} as const;

/**
 * Opens the New ticket window in place. With `defaultOpen` it starts open (the old /tickets/new address), and closing it goes back to
 * /tickets so the address bar matches what is on the screen.
 */
export function CreateTicketButton({ data, variant = 'primary', defaultOpen = false, label = 'New ticket' }: { data: TicketFormData; variant?: keyof typeof VARIANT; defaultOpen?: boolean; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const close = () => {
    setOpen(false);
    if (defaultOpen) router.replace('/tickets');
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={VARIANT[variant]}>
        {label}
      </button>
      <CreateTicketModal
        {...data}
        open={open}
        onClose={close}
        onCreated={(id) => {
          setOpen(false);
          router.push(`/tickets/${id}`);
        }}
      />
    </>
  );
}
