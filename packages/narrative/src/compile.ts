import { Compiler, CompilerOptions } from 'inkjs/compiler/Compiler';
import { ErrorType } from 'inkjs/compiler/Parser/ErrorType';
import { Story } from 'inkjs/engine/Story';

// ponytail: Limit the LRU cache to 8 entries and 2 MiB of source.length + json.length to bound retained compilation data.
const maxCacheEntries = 8;
const maxCacheSize = 2 * 1024 * 1024;
const compileCache = new Map<string, string>();
let compileCacheSize = 0;

export function clearInkCompileCacheForTests(): void {
  compileCache.clear();
  compileCacheSize = 0;
}

/** Severity of a single compiler-reported issue, mirroring inkjs's `ErrorType`. */
export type InkIssueType = 'author' | 'warning' | 'error';

/** One message reported by the ink compiler while processing a source string. */
export type InkIssue = {
  readonly type: InkIssueType;
  readonly message: string;
};

/**
 * Thrown by {@link compileInk} when a source fails to compile. Carries every
 * issue the compiler reported (not just the first), so callers (e.g. a
 * desktop error overlay) can show the full list rather than a single message.
 */
export class InkCompileError extends Error {
  readonly issues: readonly InkIssue[];

  constructor(issues: readonly InkIssue[]) {
    super(
      issues.length > 0
        ? `Ink compilation failed with ${issues.length} issue(s): ${issues.map((issue) => issue.message).join('; ')}`
        : 'Ink compilation failed with no reported issues.',
    );
    this.name = 'InkCompileError';
    this.issues = issues;
  }
}

function toIssueType(type: ErrorType): InkIssueType {
  switch (type) {
    case ErrorType.Error:
      return 'error';
    case ErrorType.Warning:
      return 'warning';
    case ErrorType.Author:
      return 'author';
    default:
      return 'error';
  }
}

/**
 * Compiles a single-file `.ink` source string into a runnable inkjs
 * {@link Story}. v1 scope: single-file stories only — no `INCLUDE`
 * `fileHandler` is configured, so `.ink` sources that use `INCLUDE` will fail
 * to compile.
 * Successful compilations are cached by source with bounded LRU eviction;
 * cache hits return a fresh Story with independent state and external bindings.
 *
 * Every issue the compiler reports (author notes, warnings, errors) is
 * collected via `CompilerOptions.errorHandler`. On a source with any
 * error-level issue, `Compiler.Compile()` itself throws a generic error
 * (inkjs's own `"Compilation failed."`) — this wrapper catches that and
 * re-throws {@link InkCompileError} carrying the full structured issue list
 * instead of inkjs's opaque message.
 */
export function compileInk(source: string): Story {
  const cachedJson = compileCache.get(source);
  if (cachedJson !== undefined) {
    compileCache.delete(source);
    compileCache.set(source, cachedJson);
    return new Story(cachedJson);
  }

  const issues: InkIssue[] = [];
  const options = new CompilerOptions(null, [], false, (message, type) => {
    issues.push({ type: toIssueType(type), message });
  });
  const compiler = new Compiler(source, options);

  let story: Story;
  try {
    story = compiler.Compile();
  } catch {
    throw new InkCompileError(issues);
  }

  if (issues.some((issue) => issue.type === 'error')) {
    throw new InkCompileError(issues);
  }

  const json = story.ToJson();
  if (typeof json !== 'string') {
    throw new Error('Ink story serialization did not return JSON.');
  }
  compileCache.set(source, json);
  compileCacheSize += source.length + json.length;
  while (compileCache.size > maxCacheEntries || compileCacheSize > maxCacheSize) {
    const oldest = compileCache.entries().next().value;
    if (!oldest) break;
    const [oldestSource, oldestJson] = oldest;
    compileCache.delete(oldestSource);
    compileCacheSize -= oldestSource.length + oldestJson.length;
  }

  return story;
}
