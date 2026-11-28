import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Stepper, type Step } from './stepper';

const step = (id: string, over: Partial<Step> = {}): Step => ({ id, title: `Step ${id}`, done: false, render: () => <p>content of {id}</p>, ...over });
const item = (id: string) => screen.getByText(`Step ${id}`).closest('li') as HTMLElement;

describe('Stepper', () => {
  it('opens the first step that is not done, folds the finished ones to a line, and keeps the later ones waiting', () => {
    render(<Stepper steps={[step('a', { done: true, summary: 'Connected as octocat' }), step('b'), step('c')]} />);
    expect(item('a')).toHaveAttribute('data-state', 'done');
    expect(within(item('a')).getByText('· Connected as octocat')).toBeInTheDocument();
    expect(within(item('a')).getByText('✔')).toBeInTheDocument();
    expect(within(item('a')).queryByText('content of a')).not.toBeInTheDocument();
    expect(item('b')).toHaveAttribute('data-state', 'open');
    expect(screen.getByText('content of b')).toBeInTheDocument();
    expect(item('c')).toHaveAttribute('data-state', 'waiting');
    expect(screen.queryByText('content of c')).not.toBeInTheDocument();
  });

  it('only one step has content at a time', () => {
    render(<Stepper steps={[step('a'), step('b'), step('c')]} />);
    expect(screen.getAllByText(/^content of/)).toHaveLength(1);
  });

  it('a step that is waiting cannot be opened', async () => {
    render(<Stepper steps={[step('a'), step('b')]} />);
    expect(within(item('b')).queryByRole('button')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Step b'));
    expect(screen.queryByText('content of b')).not.toBeInTheDocument();
  });

  it('a finished step is opened again with Edit, and closes the one that was open', async () => {
    render(<Stepper steps={[step('a', { done: true }), step('b')]} />);
    await userEvent.click(within(item('a')).getByRole('button'));
    expect(screen.getByText('content of a')).toBeInTheDocument();
    expect(screen.queryByText('content of b')).not.toBeInTheDocument();
    expect(item('a')).toHaveAttribute('data-state', 'open');
  });

  it('clicking the header of a finished step that was opened again closes it, and the current step is open again', async () => {
    render(<Stepper steps={[step('a', { done: true }), step('b')]} />);
    await userEvent.click(within(item('a')).getByRole('button'));
    await userEvent.click(within(item('a')).getByRole('button'));
    expect(screen.queryByText('content of a')).not.toBeInTheDocument();
    expect(screen.getByText('content of b')).toBeInTheDocument();
  });

  it('the current step can be brought back after a finished one was opened', async () => {
    render(<Stepper steps={[step('a', { done: true }), step('b')]} />);
    await userEvent.click(within(item('a')).getByRole('button'));
    await userEvent.click(within(item('b')).getByRole('button'));
    expect(screen.getByText('content of b')).toBeInTheDocument();
    expect(screen.queryByText('content of a')).not.toBeInTheDocument();
  });

  it('moves on by itself when the open step becomes done', () => {
    const { rerender } = render(<Stepper steps={[step('a'), step('b')]} />);
    expect(screen.getByText('content of a')).toBeInTheDocument();
    rerender(<Stepper steps={[step('a', { done: true, summary: 'ok' }), step('b')]} />);
    expect(screen.queryByText('content of a')).not.toBeInTheDocument();
    expect(screen.getByText('content of b')).toBeInTheDocument();
  });

  it('with every step done, none is open, and any can be opened to change it', async () => {
    render(<Stepper steps={[step('a', { done: true }), step('b', { done: true })]} />);
    expect(screen.queryAllByText(/^content of/)).toHaveLength(0);
    await userEvent.click(within(item('b')).getByRole('button'));
    expect(screen.getByText('content of b')).toBeInTheDocument();
  });

  it('marks the state for assistive technology: expanded on the open step, collapsed on a finished one, and a labelled region', () => {
    render(<Stepper steps={[step('a', { done: true }), step('b')]} />);
    expect(within(item('a')).getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(within(item('b')).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(within(item('b')).getByRole('button')).toHaveAttribute('aria-controls', within(item('b')).getByRole('region', { name: 'Step b' }).id);
  });

  it('works from the keyboard: Enter on a finished step opens it', async () => {
    render(<Stepper steps={[step('a', { done: true }), step('b')]} />);
    within(item('a')).getByRole('button').focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('content of a')).toBeInTheDocument();
  });

  it('shows an optional tag, and numbers the steps that are not done', () => {
    render(<Stepper steps={[step('a', { done: true }), step('b', { optional: true }), step('c')]} />);
    expect(within(item('b')).getByText('optional')).toBeInTheDocument();
    expect(within(item('b')).getByText('2')).toBeInTheDocument();
    expect(within(item('c')).getByText('3')).toBeInTheDocument();
  });
});
