import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, SETUP_CODE } from './constants.ts';

// Runs first, against a stack that starts without DASHBOARD_PASSWORD, with a fixed SETUP_CODE and a fake GitHub.
// It creates the admin account the other specs sign in with, and leaves the credentials complete.
test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Until GitHub and Anthropic are connected every page leads to the setup, so this spec cannot wait for the overview.
  await expect(page).not.toHaveURL(/\/login/);
}

const github = (page: Page) => page.getByTestId('setup-github');
const anthropic = (page: Page) => page.getByTestId('setup-anthropic');

test('a first visit goes to the setup wizard; a wrong code is refused; the right one creates the admin', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByLabel('Setup code').fill('WRONG-CODE-0000');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create admin' }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('Wrong setup code');

  await page.getByLabel('Setup code').fill(SETUP_CODE);
  await page.getByRole('button', { name: 'Create admin' }).click();
  await expect(page).toHaveURL(/\/setup\/connections$/);

  await page.goto('/setup');
  await expect(page).not.toHaveURL(/\/setup$/); // the wizard closes once an admin exists (this session is signed in, so it lands on the overview)
});

test('save and test the GitHub token; the banner stays until every required credential is set', async ({ page }) => {
  await login(page);
  await page.goto('/setup/connections');

  // Two cards, one step open in each, nothing to skip, and the way out is closed.
  await expect(github(page)).toBeVisible();
  await expect(anthropic(page)).toBeVisible();
  await expect(page.getByText(/skip/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Go to dashboard' })).toBeDisabled();

  await github(page).getByLabel('GitHub token').fill('ghp_e2eFakeTokenForTheSetupSpec1234');
  await github(page).getByRole('button', { name: 'Save & test' }).click();
  // The step folds to a line with who the token is, and the next one opens.
  await expect(github(page)).toContainText('Personal token ••••1234');
  await expect(github(page).getByLabel('Git author name')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('ghp_e2eFakeToken'); // the secret is never rendered back

  // The Anthropic API key and the git identity are still missing.
  await expect(page.getByRole('alert').filter({ hasText: 'Setup incomplete' })).toContainText('the Anthropic API key');
});

test('finishing the setup removes the banner and opens the way to the dashboard', async ({ page }) => {
  await login(page);
  await page.goto('/setup/connections');
  await anthropic(page).getByLabel('Anthropic API key').fill('sk-ant-api03-e2eFakeAnthropicKey');
  await anthropic(page).getByRole('button', { name: 'Save & test' }).click();
  await expect(anthropic(page)).toContainText('Connected');
  await github(page).getByLabel('Git author name').fill('E2E Bot');
  await github(page).getByLabel('Git author email').fill('e2e@example.com');
  await github(page).getByRole('button', { name: 'Save' }).click();
  await expect(github(page)).toContainText('E2E Bot');
  await page.getByRole('link', { name: 'Go to dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Setup incomplete')).toHaveCount(0);
});
