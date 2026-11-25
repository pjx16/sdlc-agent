import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommitSigningCard } from './commit-signing-card';

describe('CommitSigningCard', () => {
  it('shows the public key, tells where to add it, and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CommitSigningCard publicKey="ssh-ed25519 AAAAC3Nz test" />);
    expect(screen.getByLabelText('Public signing key')).toHaveValue('ssh-ed25519 AAAAC3Nz test');
    expect(screen.getByRole('link', { name: /Signing Key/ })).toHaveAttribute('href', 'https://github.com/settings/ssh/new');
    await userEvent.click(screen.getByRole('button', { name: 'Copy the key' }));
    expect(writeText).toHaveBeenCalledWith('ssh-ed25519 AAAAC3Nz test');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('says what to check while there is no key yet', () => {
    render(<CommitSigningCard publicKey={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('ENCRYPTION_KEY');
    expect(screen.queryByLabelText('Public signing key')).not.toBeInTheDocument();
  });
});
