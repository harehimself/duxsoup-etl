---
paths: "**/*.test.js"
---

# Testing Standards (Jest)

## Mandatory Behavior
**When adding or changing business logic in files matching these paths, ALWAYS:**
1. Add or update the corresponding `.test.js` file in `__tests__/` (unit) or `src/__tests__/` (integration)
2. Run `npm test -- <path-to-test-file>` before marking the task complete
3. Verify all tests pass before proceeding to the next task

**If ANY test fails:**
- Fix the issue immediately
- DO NOT mark the task as complete
- DO NOT move on to other tasks

## Do / Don't Rules

### ✅ DO
- **DO** use `async/await` for all async tests (never `.then()`)
- **DO** test both success and error paths for every function
- **DO** mock external dependencies (MongoDB, HTTP calls, file I/O)
- **DO** use descriptive test names: "should update snapshot when observation has new role"
- **DO** organize tests with `describe()` blocks by feature/method
- **DO** test the Observation-Snapshot pattern: verify observations → snapshots correctly
- **DO** test identity resolution: Sales Navigator ID, Numeric ID, missing ID scenarios
- **DO** verify `AppError` is thrown with correct error codes

### ❌ DON'T
- **DON'T** skip tests because "it's a small change"
- **DON'T** test third-party library internals (Mongoose, Express)
- **DON'T** write vague test names like "works correctly" or "test function"
- **DON'T** use real database connections in tests (always mock)
- **DON'T** leave commented-out test code
- **DON'T** commit failing or skipped tests (`.skip()`)

## Test Structure Template
```javascript
describe('FeatureName', () => {
  describe('methodName()', () => {
    it('should [expected behavior] when [condition]', async () => {
      // Arrange
      const input = { salesNavId: 'ACwAAABCDEF', fullName: 'Jane Doe' };

      // Act
      const result = await processObservation(input);

      // Assert
      expect(result.snapshot.fullName).toBe('Jane Doe');
    });

    it('should throw AppError when [error condition]', async () => {
      const invalidInput = { profileUrl: 'https://linkedin.com/in/someone' };

      await expect(processObservation(invalidInput))
        .rejects.toThrow(AppError);
    });
  });
});
```

## Critical Test Scenarios

### Identity Resolution
```javascript
it('should use Sales Navigator ID as primary identity', async () => {
  const obs = { salesNavId: 'ACwAAABCDEF', numericId: '12345' };
  const person = await processObservation(obs);
  expect(person._id).toBe('ACwAAABCDEF');
});

it('should log warning and skip when no stable ID exists', async () => {
  const obs = { profileUrl: 'https://linkedin.com/in/someone' };
  const warnSpy = jest.spyOn(logger, 'warn');

  await processObservation(obs);

  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining('no stable ID')
  );
});
```

### Observation-Snapshot Pattern
```javascript
it('should append to observations array and update snapshot', async () => {
  const obs1 = { salesNavId: 'ACwAAABCDEF', fullName: 'Jane Doe' };
  const obs2 = { salesNavId: 'ACwAAABCDEF', fullName: 'Jane Smith' };

  await processObservation(obs1);
  const person = await processObservation(obs2);

  expect(person.observations).toHaveLength(2);
  expect(person.snapshot.fullName).toBe('Jane Smith'); // Latest
});
```

### Error Handling
```javascript
it('should return AppError with correct code and message', async () => {
  const invalidObs = { salesNavId: null };

  await expect(processObservation(invalidObs))
    .rejects.toMatchObject({
      name: 'AppError',
      code: 'INVALID_IDENTITY',
      message: expect.stringContaining('stable ID')
    });
});
```

## Running Tests
- Full suite: `npm test`
- Single file: `npm test -- __tests__/models/person.test.js`
- Watch mode: `npm run test:watch`
- Coverage: `npm run test:coverage`

## Pre-Completion Checklist
Before marking a task as complete:
- [ ] Added/updated `.test.js` file for changed logic
- [ ] Ran `npm test -- <test-file>` and all tests pass
- [ ] Tested both success and error paths
- [ ] Verified Observation-Snapshot pattern if applicable
- [ ] Verified identity resolution logic if applicable
- [ ] No `.skip()` or commented-out tests
- [ ] Test names are descriptive and specific
