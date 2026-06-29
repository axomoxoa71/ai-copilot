import { test, expect } from '@playwright/test';

test.describe('Chatbot Page - Chat Messaging', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display welcome screen on initial load', async ({ page }) => {
    const welcome = page.locator('.cb-welcome-title');
    await expect(welcome).toContainText('How can I help you?');
  });

  test('should display starter prompt buttons', async ({ page }) => {
    const buttons = page.locator('.cb-starter-btn');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should send a text message and receive a response', async ({ page }) => {
    // Click a starter prompt button
    const starterBtn = page.locator('.cb-starter-btn').first();
    await starterBtn.click();

    // Wait for message to be sent and response to appear
    await page.waitForTimeout(2000); // Mock response latency
    const messages = page.locator('.cb-bubble');
    const count = await messages.count();
    expect(count).toBeGreaterThanOrEqual(2); // At least user and assistant message
  });

  test('should disable send button when loading', async ({ page }) => {
    const textarea = page.locator('.cb-textarea');
    await textarea.fill('Hello');

    const sendBtn = page.locator('.cb-send-btn');
    await sendBtn.click();

    // Send button should be disabled while loading
    await expect(sendBtn).toBeDisabled();
  });

  test('should update textarea height when text exceeds one line', async ({ page }) => {
    const textarea = page.locator('.cb-textarea');
    const initialHeight = await textarea.boundingBox();

    // Fill with multi-line text
    await textarea.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6');
    const afterHeight = await textarea.boundingBox();

    expect(afterHeight?.height).toBeGreaterThan(initialHeight?.height || 0);
  });

  test('should clear input after sending message', async ({ page }) => {
    const textarea = page.locator('.cb-textarea');
    await textarea.fill('Test message');

    const sendBtn = page.locator('.cb-send-btn');
    await sendBtn.click();

    await page.waitForTimeout(1500);
    const value = await textarea.inputValue();
    expect(value).toBe('');
  });
});

test.describe('Chatbot Page - Session Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should create new session when clicking new conversation button', async ({ page }) => {
    const newChatBtn = page.locator('button[aria-label="New conversation"]').first();
    await newChatBtn.click();

    const sessions = page.locator('.cb-session-item');
    const count = await sessions.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should display conversation in sidebar', async ({ page }) => {
    const sidebarBtn = page.locator('.cb-icon-btn').first(); // sidebar toggle
    await sidebarBtn.click();

    await expect(page.locator('.cb-sidebar--open')).toBeVisible();

    // Send a message to create a session
    const textarea = page.locator('.cb-textarea');
    await textarea.fill('Hello');
    await page.locator('.cb-send-btn').click();

    await page.waitForTimeout(1500);

    const sessionList = page.locator('.cb-session-list');
    await expect(sessionList).toBeVisible();
  });

  test('should delete session when clicking delete button', async ({ page }) => {
    const sidebarBtn = page.locator('.cb-icon-btn').first();
    await sidebarBtn.click();

    // Create a session first
    const newChatBtn = page.locator('button[aria-label="New conversation"]').first();
    await newChatBtn.click();

    // Hover to reveal delete button
    const sessionItem = page.locator('.cb-session-item').first();
    await sessionItem.hover();

    const deleteBtn = page.locator('.cb-session-del').first();
    await deleteBtn.click();

    // Session should be removed from list
    const sessions = page.locator('.cb-session-item');
    const count = await sessions.count();
    expect(count).toBe(0);
  });
});

test.describe('Chatbot Page - Voice Output', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should toggle voice output button', async ({ page }) => {
    const voiceBtn = page.locator('.cb-icon-btn[title*="Voice output"]');
    await expect(voiceBtn).not.toHaveClass(/is-active/);

    await voiceBtn.click();
    await expect(voiceBtn).toHaveClass(/is-active/);

    await voiceBtn.click();
    await expect(voiceBtn).not.toHaveClass(/is-active/);
  });

  test('should display language selector when voice output is enabled', async ({ page }) => {
    const voiceBtn = page.locator('.cb-icon-btn[title*="Voice output"]');
    await voiceBtn.click();

    const langSelect = page.locator('.cb-voice-lang-select');
    await expect(langSelect).toBeVisible();
  });

  test('should hide language selector when voice output is disabled', async ({ page }) => {
    const voiceBtn = page.locator('.cb-icon-btn[title*="Voice output"]');

    // Enable voice
    await voiceBtn.click();
    const langSelect = page.locator('.cb-voice-lang-select');
    await expect(langSelect).toBeVisible();

    // Disable voice
    await voiceBtn.click();
    await expect(langSelect).not.toBeVisible();
  });

  test('should change language in selector', async ({ page }) => {
    const voiceBtn = page.locator('.cb-icon-btn[title*="Voice output"]');
    await voiceBtn.click();

    const langSelect = page.locator('.cb-voice-lang-select');
    await langSelect.selectOption('de-DE');

    const value = await langSelect.inputValue();
    expect(value).toBe('de-DE');
  });

  test('should support English and German language options', async ({ page }) => {
    const voiceBtn = page.locator('.cb-icon-btn[title*="Voice output"]');
    await voiceBtn.click();

    const langSelect = page.locator('.cb-voice-lang-select');
    const options = await langSelect.locator('option').allTextContents();

    expect(options).toContain('🇬🇧 English');
    expect(options).toContain('🇩🇪 Deutsch');
  });
});

test.describe('Chatbot Page - File Attachment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display attachment badge when file is selected', async ({ page }) => {
    const attachBtn = page.locator('.cb-input-btn').first(); // attach button
    await attachBtn.click();

    // Select a test file (using fixture if available)
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('./tests/fixtures/test.json');

    const badge = page.locator('.cb-attached');
    await expect(badge).toBeVisible();
  });

  test('should remove attachment when clicking remove button', async ({ page }) => {
    const attachBtn = page.locator('.cb-input-btn').first();
    await attachBtn.click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('./tests/fixtures/test.json');

    const badge = page.locator('.cb-attached');
    await expect(badge).toBeVisible();

    const removeBtn = page.locator('.cb-remove-attach');
    await removeBtn.click();

    await expect(badge).not.toBeVisible();
  });
});

test.describe('Chatbot Page - UI and Styling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should have dark color scheme applied', async ({ page }) => {
    // Check root has dark color-scheme
    const root = page.locator('html');
    const bgColor = await root.evaluate((el) => window.getComputedStyle(el).colorScheme);
    expect(bgColor).toContain('dark');
  });

  test('should display scrollbars in chat messages area', async ({ page }) => {
    const messagesArea = page.locator('.cb-messages');
    // Just verify it exists and has overflow-y: auto
    const styles = await messagesArea.evaluate((el) => window.getComputedStyle(el).overflowY);
    expect(styles).toContain('auto');
  });

  test('should have sidebar toggle button', async ({ page }) => {
    const sidebarBtn = page.locator('.cb-icon-btn').first();
    await expect(sidebarBtn).toBeVisible();
  });

  test('should toggle sidebar visibility', async ({ page }) => {
    const sidebarBtn = page.locator('.cb-icon-btn').first();
    const sidebar = page.locator('.cb-sidebar');

    // Initially closed
    await expect(sidebar).not.toHaveClass(/cb-sidebar--open/);

    // Click to open
    await sidebarBtn.click();
    await expect(sidebar).toHaveClass(/cb-sidebar--open/);

    // Click to close
    await sidebarBtn.click();
    await expect(sidebar).not.toHaveClass(/cb-sidebar--open/);
  });

  test('should display help/capabilities info in welcome screen', async ({ page }) => {
    const capabilities = page.locator('.cb-welcome-sub');
    await expect(capabilities).toContainText('Message');
  });
});

test.describe('Chatbot Page - Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should send message on Ctrl+Enter', async ({ page }) => {
    const textarea = page.locator('.cb-textarea');
    await textarea.fill('Test message');

    // Press Ctrl+Enter
    await textarea.press('Control+Enter');

    // Wait for message to be processed
    await page.waitForTimeout(1500);

    const messages = page.locator('.cb-bubble');
    const count = await messages.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('should send message on Cmd+Enter on Mac', async ({ page, browserName }) => {
    if (browserName === 'webkit') {
      // Safari/WebKit specific behavior
      const textarea = page.locator('.cb-textarea');
      await textarea.fill('Test message');

      await textarea.press('Meta+Enter');

      await page.waitForTimeout(1500);

      const messages = page.locator('.cb-bubble');
      const count = await messages.count();
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });
});

test.describe('Chatbot Page - Voice Input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display mic button', async ({ page }) => {
    const micBtn = page.locator('.cb-input-btn').last(); // Assuming mic is last before send
    await expect(micBtn).toBeVisible();
  });

  test('should show error message if speech recognition not supported', async ({ page }) => {
    // This would require mocking SpeechRecognition to be unavailable
    // Skipping for now as it requires browser-specific configuration
    test.skip(true, 'Requires mocking speechRecognition');
  });
});
