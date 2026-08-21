/**
 * L4 WU-02/03: Ink sidecar text editor + knot graph for story ids on the map.
 * Text is the source of truth; graph drag rewrites `@tm-node` layout comments.
 */

import { type MutableRefObject, useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildInkStoryOpenModel,
  isSafeStoryId,
  listInkSidecars,
  listInkStoryIdsFromEvents,
  loadInkSidecar,
  saveInkSidecar,
  tryCompileInkSource,
} from '../ink-sidecar.js';
import type { PainterState } from '../painter-store.js';
import type { StatusReport } from '../status-feedback.js';
import { InkGraph } from './InkGraph.js';

/** Result of flushing the unsaved Ink buffer. `clean` = nothing to write. */
export type InkFlushResult = 'clean' | 'saved' | 'blocked' | 'failed';

export interface InkSaveHandle {
  saveIfDirty: () => Promise<InkFlushResult>;
}

export interface InkPanelProps {
  readonly t: (key: string) => string;
  readonly painterState: PainterState | null;
  readonly mapName: string;
  readonly onStatus: (report: StatusReport) => void;
  readonly onStorySaved?: (storyId: string) => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly saveHandleRef?: MutableRefObject<InkSaveHandle | null>;
}

export function InkPanel({
  t,
  painterState,
  mapName,
  onStatus,
  onStorySaved,
  onDirtyChange,
  saveHandleRef,
}: InkPanelProps) {
  const referencedIds = useMemo(
    () => (painterState ? listInkStoryIdsFromEvents(painterState.events) : []),
    [painterState],
  );

  const [manualStoryId, setManualStoryId] = useState('');
  const [extraIds, setExtraIds] = useState<readonly string[]>([]);
  const [diskStoryIds, setDiskStoryIds] = useState<readonly string[]>([]);
  const storyIds = useMemo(() => {
    const merged: string[] = [];
    for (const id of [...diskStoryIds, ...referencedIds, ...extraIds]) {
      if (!merged.includes(id)) merged.push(id);
    }
    return merged;
  }, [diskStoryIds, referencedIds, extraIds]);
  const openModel = useMemo(
    () => buildInkStoryOpenModel([...diskStoryIds, ...referencedIds], manualStoryId),
    [diskStoryIds, referencedIds, manualStoryId],
  );

  const refreshDiskStories = useCallback(() => {
    let cancelled = false;
    void listInkSidecars(mapName)
      .then((ids) => {
        if (!cancelled) setDiskStoryIds(ids);
      })
      .catch((err) => {
        console.error('Failed to list ink sidecars:', err);
        if (!cancelled) {
          onStatus({ message: t('painter.ink.loadFailed'), severity: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mapName, onStatus, t]);

  useEffect(() => refreshDiskStories(), [refreshDiskStories]);

  const [selectedStoryId, setSelectedStoryId] = useState<string | undefined>(undefined);
  const [source, setSource] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedStoryId !== undefined && storyIds.includes(selectedStoryId)) return;
    setSelectedStoryId(storyIds[0]);
  }, [storyIds, selectedStoryId]);

  useEffect(() => {
    if (selectedStoryId === undefined) {
      setSource('');
      setDirty(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadInkSidecar(selectedStoryId, mapName)
      .then((text) => {
        if (cancelled) return;
        setSource(text ?? `=== start ===\n`);
        setDirty(false);
      })
      .catch((err) => {
        console.error('Failed to load ink sidecar:', err);
        if (!cancelled) {
          onStatus({ message: t('painter.ink.loadFailed'), severity: 'error' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStoryId, mapName, onStatus, t]);

  /** Block story/map switches that would discard the unsaved buffer. */
  const confirmDiscardIfDirty = useCallback((): boolean => {
    if (!dirty) return true;
    return window.confirm(t('painter.ink.discardConfirm'));
  }, [dirty, t]);

  const compile = useMemo(() => tryCompileInkSource(source), [source]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const persistInk = useCallback(
    async (quiet: boolean): Promise<InkFlushResult> => {
      if (selectedStoryId === undefined || !isSafeStoryId(selectedStoryId)) return 'clean';
      if (!compile.ok) {
        if (!quiet) onStatus({ message: t('painter.ink.saveBlocked'), severity: 'warning' });
        return 'blocked';
      }
      try {
        await saveInkSidecar(selectedStoryId, source, mapName);
        setDirty(false);
        onStorySaved?.(selectedStoryId);
        refreshDiskStories();
        if (!quiet) onStatus({ message: t('painter.ink.saveSuccess'), severity: 'success' });
        return 'saved';
      } catch (err) {
        console.error('Failed to save ink sidecar:', err);
        if (!quiet) onStatus({ message: t('painter.ink.saveFailed'), severity: 'error' });
        return 'failed';
      }
    },
    [selectedStoryId, compile.ok, source, mapName, onStatus, onStorySaved, t, refreshDiskStories],
  );

  const handleSave = useCallback(async () => {
    await persistInk(false);
  }, [persistInk]);

  const saveIfDirty = useCallback(async (): Promise<InkFlushResult> => {
    if (!dirty) return 'clean';
    return persistInk(true);
  }, [dirty, persistInk]);

  useEffect(() => {
    if (!saveHandleRef) return;
    saveHandleRef.current = { saveIfDirty };
    return () => {
      saveHandleRef.current = null;
    };
  }, [saveHandleRef, saveIfDirty]);

  if (!painterState) return null;

  const openStoryId = (id: string) => {
    if (!isSafeStoryId(id)) {
      onStatus({ message: t('painter.ink.invalidStoryId'), severity: 'warning' });
      return;
    }
    if (id === selectedStoryId) return;
    if (!confirmDiscardIfDirty()) return;
    if (!extraIds.includes(id) && !referencedIds.includes(id) && !diskStoryIds.includes(id)) {
      setExtraIds([...extraIds, id]);
    }
    setSelectedStoryId(id);
  };

  const openStory = () => {
    const id = manualStoryId.trim();
    openStoryId(id);
    if (isSafeStoryId(id)) setManualStoryId('');
  };

  const typedWarning =
    openModel.status === 'unsafe-story-id'
      ? t('painter.ink.invalidStoryId')
      : openModel.status === 'unknown-story'
        ? t('painter.ink.unknownStory')
        : undefined;

  return (
    <section className="ink-workbench" aria-label={t('painter.ink')}>
      <h3 className="ide-section-title">{t('painter.ink')}</h3>
      <p className="ide-hint">{t('painter.ink.help')}</p>
      <div className="ide-welcome-path">
        <h4 className="ide-section-title">{t('painter.ink.existing')}</h4>
        {diskStoryIds.length === 0 ? (
          <p className="ide-hint">{t('painter.ink.existingEmpty')}</p>
        ) : (
          <ul className="ide-list" aria-label={t('painter.ink.existing')}>
            {diskStoryIds.map((id) => (
              <li key={id} className={id === selectedStoryId ? 'ide-list-active' : undefined}>
                <span className="ide-welcome-map-name">{id}</span>
                <button type="button" onClick={() => openStoryId(id)}>
                  {t('painter.ink.open')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="painter-events-add-event">
        <input
          type="text"
          list="ink-existing-stories"
          value={manualStoryId}
          placeholder={t('painter.ink.storyPlaceholder')}
          aria-invalid={typedWarning !== undefined}
          aria-describedby={typedWarning ? 'ink-story-open-warning' : undefined}
          onChange={(e) => setManualStoryId(e.target.value)}
        />
        <datalist id="ink-existing-stories">
          {openModel.storyOptions.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <button type="button" className="primary" onClick={openStory}>
          {t('painter.ink.open')}
        </button>
      </div>
      {typedWarning && (
        <p id="ink-story-open-warning" className="painter-events-soft-warning">
          {typedWarning}
        </p>
      )}
      {storyIds.length === 0 ? (
        <p className="ide-hint">{t('painter.ink.none')}</p>
      ) : (
        <div className="ink-split">
          <label>
            {t('painter.ink.story')}
            <select
              value={selectedStoryId ?? ''}
              onChange={(e) => {
                const next = e.target.value;
                if (next === selectedStoryId) return;
                if (!confirmDiscardIfDirty()) return;
                setSelectedStoryId(next);
              }}
            >
              {storyIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          {loading ? (
            <p className="ide-hint">{t('painter.ink.loading')}</p>
          ) : (
            <>
              <textarea
                className="ink-source"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setDirty(true);
                }}
                rows={10}
                spellCheck={false}
                aria-label={t('painter.ink.source')}
              />
              <p className="ide-hint">{t('painter.ink.graphHint')}</p>
              <div className="ink-graph-wrap">
                <InkGraph
                  source={source}
                  ariaLabel={t('painter.ink.graph')}
                  onSourceChange={(next) => {
                    setSource(next);
                    setDirty(true);
                  }}
                />
              </div>
            </>
          )}
          <p
            className={compile.ok ? 'ide-hint ink-compile-ok' : 'ide-hint ink-compile-fail'}
            role="status"
          >
            {compile.ok
              ? t('painter.ink.compileOk').replace('{count}', String(compile.knotCount))
              : t('painter.ink.compileFail').replace(
                  '{message}',
                  compile.issues.map((i) => i.message).join('; '),
                )}
            {dirty ? ` · ${t('painter.ink.dirty')}` : ''}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => void handleSave()}
            disabled={!compile.ok || loading}
          >
            {t('painter.ink.save')}
          </button>
        </div>
      )}
    </section>
  );
}
