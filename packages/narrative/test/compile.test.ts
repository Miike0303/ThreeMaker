import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Story } from 'inkjs';
import { Compiler, CompilerOptions } from 'inkjs/compiler/Compiler';
import type { ErrorType } from 'inkjs/compiler/Parser/ErrorType';
import { Story as EngineStory } from 'inkjs/engine/Story';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearInkCompileCacheForTests, compileInk, InkCompileError } from '../src/compile.js';

vi.mock('inkjs/compiler/Compiler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('inkjs/compiler/Compiler')>();
  return {
    ...actual,
    Compiler: vi.fn(
      class MockCompiler {
        constructor(...args: ConstructorParameters<typeof actual.Compiler>) {
          const compiler = new actual.Compiler(...args);
          Object.assign(this, compiler);
          Object.setPrototypeOf(this, actual.Compiler.prototype);
        }
      },
    ),
  };
});

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
  it('explains an Ink compilation failure with no reported issues', () => {
    expect(new InkCompileError([]).message).toBe('Ink compilation failed with no reported issues.');
  });

  beforeEach(() => {
    clearInkCompileCacheForTests();
    vi.mocked(Compiler).mockClear();
  });

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

  it('constructs the compiler once for repeated source', () => {
    compileInk(goodSource);
    compileInk(goodSource);

    expect(Compiler).toHaveBeenCalledTimes(1);
  });

  it('returns independent stories from the compiler engine module', () => {
    const first = compileInk(goodSource);
    const second = compileInk(goodSource);

    expect(first === second).toBe(false);
    expect(first.constructor === EngineStory).toBe(true);
    expect(second.constructor === first.constructor).toBe(true);
    expect(first.Continue()).toBe('Hello, traveler.\n');
    expect(first.canContinue).toBe(false);
    expect(second.canContinue).toBe(true);
    expect(second.Continue()).toBe('Hello, traveler.\n');
  });

  it('keeps external bindings independent on cache hits', () => {
    const source = 'EXTERNAL greeting()\n{greeting()}\n-> END';
    const first = compileInk(source);
    first.BindExternalFunction('greeting', () => 'First');
    const second = compileInk(source);
    second.BindExternalFunction('greeting', () => 'Second');

    expect(first.Continue()).toBe('First\n');
    expect(second.Continue()).toBe('Second\n');
    expect(Compiler).toHaveBeenCalledTimes(1);
  });

  it('compiles again when the source changes', () => {
    compileInk(goodSource);
    const changed = compileInk('Hello, again.\n-> END');

    expect(Compiler).toHaveBeenCalledTimes(2);
    expect(changed.Continue()).toBe('Hello, again.\n');
  });

  it('recompiles invalid source and preserves its issues on every call', () => {
    const failures: InkCompileError[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => {
        try {
          compileInk(badSource);
        } catch (error) {
          if (error instanceof InkCompileError) failures.push(error);
          throw error;
        }
      }).toThrow(InkCompileError);
    }

    expect(Compiler).toHaveBeenCalledTimes(2);
    expect(failures).toHaveLength(2);
    expect(failures[0]?.issues.some((issue) => issue.type === 'error')).toBe(true);
    expect(failures[1]?.issues).toEqual(failures[0]?.issues);
  });

  it('evicts the first source after compiling nine distinct sources', () => {
    for (let index = 0; index < 9; index++) {
      compileInk(`Story ${index}.\n-> END`);
    }
    expect(Compiler).toHaveBeenCalledTimes(9);

    compileInk('Story 0.\n-> END');
    expect(Compiler).toHaveBeenCalledTimes(10);
  });

  it('refreshes recency on a cache hit', () => {
    for (let index = 0; index < 8; index++) {
      compileInk(`Story ${index}.\n-> END`);
    }
    compileInk('Story 0.\n-> END');
    compileInk('Story 8.\n-> END');
    compileInk('Story 0.\n-> END');
    expect(Compiler).toHaveBeenCalledTimes(9);

    compileInk('Story 1.\n-> END');
    expect(Compiler).toHaveBeenCalledTimes(10);
  });

  it('evicts by the combined source and JSON size below the entry limit', () => {
    const padding = 'x'.repeat(400 * 1024);
    const sources = Array.from({ length: 3 }, (_, index) => `${index} ${padding}\n-> END`);
    const [firstSource, , thirdSource] = sources;
    if (firstSource === undefined || thirdSource === undefined) {
      throw new Error('Expected three source fixtures.');
    }
    for (const source of sources) compileInk(source);
    expect(Compiler).toHaveBeenCalledTimes(3);

    compileInk(thirdSource);
    expect(Compiler).toHaveBeenCalledTimes(3);
    compileInk(firstSource);
    expect(Compiler).toHaveBeenCalledTimes(4);
  });

  it('does not retain a source larger than the size bound', () => {
    const source = `// ${'x'.repeat(2 * 1024 * 1024)}\nHello.\n-> END`;
    compileInk(source);
    compileInk(source);

    expect(Compiler).toHaveBeenCalledTimes(2);
  });
});

it('includes the only compiler issue in the failure message', () => {
  const error = new InkCompileError([{ type: 'error', message: 'Missing divert target.' }]);

  expect(error.message).toBe('Ink compilation failed with 1 issue(s): Missing divert target.');
});

it('compiles a playable story containing an author TODO note', () => {
  const story = compileInk('TODO: Expand this greeting.\nHello, traveler.\n-> END\n');

  expect(story.Continue()).toBe('Hello, traveler.\n');
});

it('separates multiple compiler issues in the failure message', () => {
  const error = new InkCompileError([
    { type: 'error', message: 'Unknown divert target.' },
    { type: 'error', message: 'Missing knot.' },
  ]);

  expect(error.message).toBe(
    'Ink compilation failed with 2 issue(s): Unknown divert target.; Missing knot.',
  );
});

it('preserves author note severity alongside a compilation error', () => {
  expect.assertions(1);
  try {
    compileInk('TODO: Finish the greeting.\n-> missing\n');
  } catch (error) {
    if (!(error instanceof InkCompileError)) throw error;
    expect(error.issues).toContainEqual({
      type: 'author',
      message: expect.stringContaining('Finish the greeting.'),
    });
  }
});

it('preserves warning severity alongside a compilation error', () => {
  expect.assertions(1);
  try {
    compileInk('=== intro ===\nHello.\n=== broken ===\n-> missing\n');
  } catch (error) {
    if (!(error instanceof InkCompileError)) throw error;
    expect(error.issues).toContainEqual({
      type: 'warning',
      message: expect.stringContaining('Apparent loose end'),
    });
  }
});

it('plays a finished knot when another knot has a compiler warning', () => {
  const story = compileInk(
    '-> greeting\n=== draft ===\nUnfinished.\n=== greeting ===\nWelcome back.\n-> END\n',
  );

  expect(story.Continue()).toBe('Welcome back.\n');
});

it('rejects unknown compiler diagnostic severities', async () => {
  clearInkCompileCacheForTests();
  const actual =
    await vi.importActual<typeof import('inkjs/compiler/Compiler')>('inkjs/compiler/Compiler');
  vi.mocked(Compiler).mockImplementationOnce(
    class extends actual.Compiler {
      constructor(...args: ConstructorParameters<typeof actual.Compiler>) {
        super(...args);
        Object.setPrototypeOf(this, actual.Compiler.prototype);
        args[1]?.errorHandler?.('Unknown diagnostic severity.', -1 as ErrorType);
      }
    },
  );

  expect(() => compileInk('Unknown severity fixture.\n-> END\n')).toThrowError(
    new InkCompileError([{ type: 'error', message: 'Unknown diagnostic severity.' }]),
  );
});

it('identifies Ink compilation failures in the displayed error string', () => {
  expect.assertions(1);
  try {
    compileInk('-> missing_display_target\n');
  } catch (error) {
    if (!(error instanceof InkCompileError)) throw error;
    expect(String(error)).toMatch(/^InkCompileError: Ink compilation failed with \d+ issue\(s\):/);
  }
});

it('evicts the next oldest story after repeated size limit evictions', () => {
  clearInkCompileCacheForTests();
  vi.mocked(Compiler).mockClear();
  const padding = 'x'.repeat(400 * 1024);
  const sourceAt = (index: number) => `Eviction ${index}. ${padding}\n-> END`;

  for (let index = 0; index < 4; index++) compileInk(sourceAt(index));
  expect(Compiler).toHaveBeenCalledTimes(4);

  compileInk(sourceAt(1));
  expect(Compiler).toHaveBeenCalledTimes(5);
});

it('retains a compilation that exactly fills the cache size limit', async () => {
  const actual =
    await vi.importActual<typeof import('inkjs/compiler/Compiler')>('inkjs/compiler/Compiler');
  const body = 'Cache boundary.\n-> END\n';
  const json = new actual.Compiler(body).Compile().ToJson();
  if (typeof json !== 'string') throw new Error('Expected serialized Ink story JSON.');
  const sizeLimit = 2 * 1024 * 1024;
  const source = `${body}//${'x'.repeat(sizeLimit - body.length - 2 - json.length)}`;
  clearInkCompileCacheForTests();
  vi.mocked(Compiler).mockClear();

  expect(compileInk(source).ToJson()).toBe(json);
  const cached = compileInk(source);

  expect(Compiler).toHaveBeenCalledTimes(1);
  expect(cached.Continue()).toBe('Cache boundary.\n');
});

it('reports non-string story serialization before caching the compilation', () => {
  clearInkCompileCacheForTests();
  const serialize = vi.spyOn(EngineStory.prototype, 'ToJson').mockReturnValueOnce(undefined);

  try {
    expect(() => compileInk('Serialization guard fixture.\n-> END\n')).toThrow(
      'Ink story serialization did not return JSON.',
    );
  } finally {
    serialize.mockRestore();
    clearInkCompileCacheForTests();
  }
});

it('caches a small story after evicting an oversized source', () => {
  clearInkCompileCacheForTests();
  vi.mocked(Compiler).mockClear();

  try {
    const oversized = `// ${'x'.repeat(3 * 1024 * 1024)}\nOversized.\n-> END\n`;
    const source = 'After eviction.\n-> END\n';
    compileInk(oversized);
    compileInk(source);
    const cached = compileInk(source);

    expect(Compiler).toHaveBeenCalledTimes(2);
    expect(cached.Continue()).toBe('After eviction.\n');
  } finally {
    clearInkCompileCacheForTests();
  }
});

it('enforces the cache size bound after evicting a comment-heavy source', () => {
  clearInkCompileCacheForTests();
  vi.mocked(Compiler).mockClear();

  try {
    const oversized = `// ${'x'.repeat(3 * 1024 * 1024)}\nComment-heavy.\n-> END\n`;
    const padding = 'x'.repeat(600 * 1024);
    const firstSource = `First ${padding}\n-> END\n`;
    const secondSource = `Second ${padding}\n-> END\n`;

    compileInk(oversized);
    compileInk(firstSource);
    compileInk(secondSource);
    compileInk(firstSource);

    expect(Compiler).toHaveBeenCalledTimes(4);
  } finally {
    clearInkCompileCacheForTests();
  }
});
