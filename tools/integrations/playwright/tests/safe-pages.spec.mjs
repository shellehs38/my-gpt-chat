import { test, expect } from '@playwright/test';

// Read-only routes, no credentials, no production writes.
test('landing page responds without a server failure', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(500);
  await expect(page.locator('body')).toBeVisible();
});

test('facade calculator static page is served', async ({ page }) => {
  const response = await page.goto('/facade-calculator/index.html', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response.status()).toBe(200);
  await expect(page.locator('body')).toBeVisible();
});

test('public memory route does not leak credentials', async ({ request }) => {
  const response = await request.get('/api/project-memory');
  expect([200, 503]).toContain(response.status());
  const text = await response.text();
  expect(text).not.toMatch(/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  expect(text).not.toMatch(/sk-proj-[A-Za-z0-9_-]{16,}/);
});
