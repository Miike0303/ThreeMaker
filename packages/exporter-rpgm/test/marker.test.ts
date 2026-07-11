import { describe, expect, it } from 'vitest';
import {
  buildMarkerFileContents,
  EMPIRICAL_FALLBACK_MARKER,
  isValidMarkerLine,
  MARKER_FILE_NAME,
  resolveMarkerValue,
} from '../src/marker.js';

describe('marker (game.rmmzproject resolution)', () => {
  it('MARKER_FILE_NAME is the lowercase, one-word MZ project marker filename', () => {
    expect(MARKER_FILE_NAME).toBe('game.rmmzproject');
  });

  it('buildMarkerFileContents writes exactly the version string, no trailing newline', () => {
    expect(buildMarkerFileContents('RPGMZ 0.9.4')).toBe('RPGMZ 0.9.4');
  });

  it('isValidMarkerLine accepts the "RPGMZ x.y.z" format', () => {
    expect(isValidMarkerLine('RPGMZ 0.9.4')).toBe(true);
    expect(isValidMarkerLine('RPGMZ 0.9.5')).toBe(true);
  });

  it('isValidMarkerLine rejects malformed lines', () => {
    expect(isValidMarkerLine('')).toBe(false);
    expect(isValidMarkerLine('RPGMV 1.6.2')).toBe(false);
    expect(isValidMarkerLine('RPGMZ')).toBe(false);
    expect(isValidMarkerLine('rpgmz 0.9.4')).toBe(false);
  });

  it('resolveMarkerValue prefers a cheaply-detected installed-engine version when valid', () => {
    expect(resolveMarkerValue('RPGMZ 0.9.5')).toBe('RPGMZ 0.9.5');
  });

  it('resolveMarkerValue falls back to the empirically-observed format-compatible value when detection yields null', () => {
    expect(resolveMarkerValue(null)).toBe(EMPIRICAL_FALLBACK_MARKER);
    expect(EMPIRICAL_FALLBACK_MARKER).toBe('RPGMZ 0.9.4');
  });

  it('resolveMarkerValue falls back when the detected value does not match the validated format', () => {
    expect(resolveMarkerValue('garbage')).toBe(EMPIRICAL_FALLBACK_MARKER);
  });
});
