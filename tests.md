# Tests

## Table of Contents

1. [Test Framework](#test-framework)
2. [Test Coverage](#test-coverage)
3. [Test Inventory](#test-inventory)
4. [How to Run](#how-to-run)
5. [Continuous Integration](#continuous-integration)
6. [Best Practices](#best-practices)

## Test Framework

- **Framework**: Playwright (`@playwright/test`) for end-to-end tests
- **Configuration**: `playwright.config.js`
- **Test Location**: `tests/`
- **Test Fixtures**: `tests/fixtures/`
- **Browsers**: Chromium, Firefox, WebKit (parallel execution)
- **Retries**: 2 retries on CI environment

## Test Coverage

The test suite covers the following features:

### Chat Messaging
- Welcome screen display
- Starter prompts
- Text message sending and response
- Loading states
- Auto-resize textarea
- Input clearing after send

### Session Management
- Create new sessions
- Display conversations in sidebar
- Delete sessions
- Active session tracking

### Voice Features
- Voice output toggle
- Language selector (English/Deutsch)
- Language persistence during session
- Language option visibility control

### File Attachment
- File selection and badge display
- File attachment removal
- Unsupported file handling

### UI & Styling
- Dark color scheme application
- Scrollbar styling (chat and sidebar)
- Sidebar toggle functionality
- Help information display

### Keyboard Shortcuts
- Ctrl+Enter to send message
- Cmd+Enter on macOS

### Voice Input
- Microphone button display
- Speech recognition error handling

## Test Inventory

### Test File: `tests/chatbot.spec.ts`

This is the main test suite covering the chatbot functionality and user interactions.

**Key Test Cases**:

| Test Name | Scenario | Assertions |
|-----------|----------|-----------|
| Chat message sending | User enters message and clicks send | Message appears in chat history, input clears |
| Session creation | User clicks "New Chat" | New session created, sidebar updated |
| Session deletion | User deletes a session | Session removed from sidebar, main chat resets |
| Voice output toggle | User toggles voice feature | Toggle state persists across refreshes |
| Language selection | User changes language | Language persists in session, UI updates |
| File attachment | User selects file | File badge appears, file can be removed |
| Loading state | Message sent to backend | Loading indicator visible, disabled state during request |
| Keyboard shortcuts | User presses Ctrl+Enter | Message sends without mouse click |

**Fixture Usage**: Test data loaded from `tests/fixtures/test.json`

## How to Run

### Install Dependencies

```bash
npm install
```

This includes Playwright browser binaries automatically.

### Run All E2E Tests

```bash
npm run test:e2e
```

Starts the dev server and runs Playwright tests against all browsers.

### Run Tests in Headed Mode

```bash
npx playwright test --headed
```

Opens actual browser windows so you can see interactions.

### Run Tests in Debug Mode

```bash
npx playwright test --debug
```

Launches Playwright Inspector for step-by-step debugging with network inspection.

### Run Specific Test File

```bash
npx playwright test tests/chatbot.spec.ts
```

### Run Specific Test

```bash
npx playwright test -g "Chat message sending"
```

The `-g` flag filters tests by name pattern.

### Run with Specific Browser

```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

### Generate HTML Report

```bash
npx playwright show-report
```

Displays interactive report with screenshots and traces.

## Continuous Integration

Tests are configured to run in CI pipelines with:

- **Retries**: 2 retries on failure to handle flaky tests
- **Workers**: Single worker (default in CI) to avoid resource contention
- **Output**: HTML report generation
- **Artifacts**: Screenshots on failure, full trace on first retry
- **Timeout**: 30 seconds per test (configurable in `playwright.config.js`)

**CI Configuration** (e.g., GitHub Actions):

```yaml
- name: Run Tests
  run: npm run test:e2e

- name: Upload Test Results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## Best Practices

### 1. Test Naming

Use descriptive, user-focused names:

```typescript
// ✓ Good
test('User can send a chat message and see it appear in history');

// ✗ Poor
test('send message');
```

### 2. Assertions

Use explicit, readable assertions:

```typescript
// ✓ Good
await expect(chatInput).toHaveValue('');  // Message input clears after send
await expect(messageList).toContainText(userMessage);  // Message appears in history

// ✗ Poor
await expect(chatInput).toHaveValue('');
```

### 3. Wait Strategies

Use reliable wait conditions:

```typescript
// ✓ Good - Wait for element state
await expect(loadingSpinner).toBeHidden();

// ✓ Good - Wait for network if needed
await page.waitForResponse(response => 
  response.url().includes('/agent-api') && response.status() === 200
);

// ✗ Poor - Arbitrary waits
await page.waitForTimeout(2000);
```

### 4. Test Independence

Each test should be independent:

```typescript
// ✓ Good - Each test sets up its own state
test('Delete session removes from sidebar', async ({ page }) => {
  await page.goto('/');
  // Create and delete session within test
});

// ✗ Poor - Depends on previous test
test('New session created', async ({ page }) => {
  // assumes previous test ran
});
```

### 5. Fixture Usage

Use fixtures for shared setup:

```typescript
// ✓ Good - DRY test code
test.use({ 
  baseURL: 'http://localhost:5173',
});

// Test data from fixture
import testData from './fixtures/test.json';
```

### 6. Error Messages

Include context in error messages:

```typescript
// ✓ Good
await expect(element, 'Button should be visible for admin users')
  .toBeVisible();

// ✗ Poor
await expect(element).toBeVisible();
```

## Adding New Tests

When implementing new features, follow this process:

1. **Write requirement**: Add test case to requirement document in `requirements/`
2. **Write test**: Create test in `tests/chatbot.spec.ts` (should fail initially)
3. **Implement feature**: Write feature code
4. **Test passes**: Verify test passes consistently
5. **Update this file**: Document new test in Test Inventory above

## Test Maintenance

### Running Tests Locally

Before committing, always run:

```bash
npm run typecheck  # Type checking
npm run lint       # Linting
npm run test:e2e   # Test suite
```

### Updating Tests

When UI changes:
1. Update test selectors if element names change
2. Update assertions if behavior changes
3. Update Test Inventory section in this file

### Debugging Failed Tests

If tests fail:

1. **Check logs**: `npx playwright show-report`
2. **Replay trace**: Open `.trace` file from report
3. **Debug mode**: `npx playwright test --debug -g "test name"`
4. **Local run**: Run test locally with `--headed` to watch

## Future Enhancements

- [ ] Visual regression tests (Percy, Chromatic)
- [ ] Performance benchmarks
- [ ] API integration tests (Jest)
- [ ] Accessibility tests (axe)
- [ ] Load testing (k6, Artillery)
