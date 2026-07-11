import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Story } from 'inkjs';
import { Compiler, CompilerOptions } from 'inkjs/compiler/Compiler';
import { describe, expect, it } from 'vitest';
import { compileInk, InkCompileError } from '../src/compile.js';

// NOTE: our own authored `.ink` test content lives under `test/ink/`, not
// `test/fixtures/` — the repo-root `fixtures/` gitignore pattern is reserved
// for real, copyrighted, third-party RPG Maker data (see .gitignore), not
// our own committed test data.
const inkFixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ink');
const goodSource = readFileSync(path.join(inkFixturesDir, 'good.ink'), 'utf-8');
const badSource = readFileSync(path.join(inkFixturesDir, 'bad.ink'), 'utf-8');

describe('inkjs import paths', () => {
  it('resolves the root "inkjs" entrypoint (Story)', () => {
    expect(typeof Story).toBe('function');
  });

  it('resolves the "inkjs/compiler/Compiler" subpath (Compiler, CompilerOptions)', () => {
    expect(typeof Compiler).toBe('function');
    expect(typeof CompilerOptions).toBe('function');
  });
});

describe('compileInk', () => {
  // NOTE: assert the returned Story is runnable via duck-typed checks
  // (canContinue/Continue), not `toBeInstanceOf(Story)`. A live inkjs Story
  // instance's internal object graph is too deep for Vitest's fork/thread
  // IPC to serialize when attaching the value to a test result — asserting
  // instanceof against it reliably crashes the worker with "RangeError:
  // Maximum call stack size exceeded" during result reporting, even when
  // the assertion itself passes.
  it('compiles a valid .ink source into a runnable Story', () => {
    const story = compileInk(goodSource);

    expect(typeof story.Continue).toBe('function');
    expect(story.canContinue).toBe(true);
    expect(story.Continue()).toBe('Hello, traveler.\n');
  });

  it('throws InkCompileError for invalid .ink source', () => {
    expect(() => compileInk(badSource)).toThrow(InkCompileError);
  });

  it('collects at least one error-type issue for invalid source', () => {
    expect.assertions(3);
    try {
      compileInk(badSource);
    } catch (error) {
      expect(error).toBeInstanceOf(InkCompileError);
      const issues = (error as InkCompileError).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((issue) => issue.type === 'error')).toBe(true);
    }
  });
});
