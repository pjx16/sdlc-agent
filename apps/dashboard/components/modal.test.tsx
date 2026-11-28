import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal, type ModalProps } from './modal';

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.overflow = '';
});

const dialogEl = () => document.querySelector('dialog') as HTMLDialogElement;

function Harness(props: Partial<ModalProps> & { startOpen?: boolean }) {
  const [open, setOpen] = useState(props.startOpen ?? true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      <Modal title="New thing" open={open} onClose={() => setOpen(false)} {...props}>
        <input aria-label="Name" />
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('is a labelled, described dialog that is open, and holds its content', () => {
    render(<Harness description="Say what it is" />);
    expect(dialogEl()).toHaveAttribute('open');
    expect(screen.getByRole('dialog', { name: 'New thing' })).toHaveAccessibleDescription('Say what it is');
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('mounts its content only while open, so a form starts empty each time', async () => {
    render(<Harness startOpen={false} />);
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await userEvent.type(screen.getByLabelText('Name'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialogEl()).not.toHaveAttribute('open');
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('closes with the ✕ button, with Esc, and with a click on the backdrop', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialogEl()).not.toHaveAttribute('open');
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    fireEvent(dialogEl(), new Event('cancel', { cancelable: true })); // what Esc does
    expect(dialogEl()).not.toHaveAttribute('open');
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    fireEvent.click(dialogEl()); // the backdrop is the dialog's own box
    expect(dialogEl()).not.toHaveAttribute('open');
  });

  it('a click inside the content does not close it', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText('Name'));
    expect(dialogEl()).toHaveAttribute('open');
  });

  it('Esc is cancelled so the page cannot close it before the "discard" question', () => {
    render(<Harness />);
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialogEl(), cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });

  describe('when there is something to lose', () => {
    it('asks first, and stays open if the person says no', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      render(<Harness dirty />);
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(confirm).toHaveBeenCalledWith('Discard your changes?');
      expect(dialogEl()).toHaveAttribute('open');
      fireEvent(dialogEl(), new Event('cancel', { cancelable: true }));
      fireEvent.click(dialogEl());
      expect(dialogEl()).toHaveAttribute('open');
    });

    it('closes when the person says yes', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<Harness dirty />);
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(dialogEl()).not.toHaveAttribute('open');
    });

    it('does not ask when nothing changed', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      render(<Harness />);
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  it('puts the focus back on what opened it', async () => {
    render(<Harness startOpen={false} />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(opener).toHaveFocus();
  });

  it('keeps the page behind from scrolling while open, and lets it scroll again after', async () => {
    render(<Harness />);
    expect(document.documentElement.style.overflow).toBe('hidden');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('lets go of the page when it is removed while open', () => {
    const { unmount } = render(<Harness />);
    unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it.each([
    ['sm', 'w-[28rem]'],
    ['md', 'w-[36rem]'],
    ['lg', 'w-[48rem]'],
    ['xl', 'w-[90vw] h-[88vh]'],
    ['full', 'w-[90vw] h-[90vh]'],
  ] as const)('size %s', (size, classes) => {
    render(<Harness size={size} />);
    for (const c of classes.split(' ')) expect(dialogEl()).toHaveClass(c);
  });

  it('a flush body has no padding and does not scroll itself, so the content can lay out two panes', () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByLabelText('Name').parentElement).toHaveClass('overflow-y-auto', 'px-5');
    rerender(<Harness flush />);
    expect(screen.getByLabelText('Name').parentElement).toHaveClass('overflow-hidden');
    expect(screen.getByLabelText('Name').parentElement).not.toHaveClass('px-5');
  });

  it('shows the footer when given one', () => {
    render(<Harness footer={<button>Save it</button>} />);
    expect(screen.getByRole('button', { name: 'Save it' })).toBeInTheDocument();
  });
});
