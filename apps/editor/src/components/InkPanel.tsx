/**
 * L4 WU-02/03: Ink sidecar text editor + knot graph for story ids on the map.
 * Text is the source of truth; graph drag rewrites `@tm-node` layout comments.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  isSafeStoryId,
  listInkStoryIdsFromEvents,
  loadInkSidecar,
  saveInkSidecar,
  tryCompileInkSource,
} from '../ink-sidecar.js';
import type { PainterState } from '../painter-store.js';
import { InkGraph } from './InkGraph.js';

export interface InkPanelProps {
  readonly t: (key: string) => string;
  readonly painterState: PainterState | null;
  readonly onStatus: (message: string) => void;
}

export function InkPanel({ t, painterState, onStatus }: InkPanelProps) {
  const referencedIds = useMemo(
    () => (painterState ? listInkStoryIdsFromEvents(painterState.events) : []),
    [painterState],
  );

  const [manualStoryId, setManualStoryId] = useState('');
  const [extraIds, setExtraIds] = useState<readonly string[]>([]);
  const storyIds = useMemo(() => {
    const merged = [...referencedIds];
    for (const id of extraIds) {
      if (!merged.includes(id)) merged.push(id);
    }
    return merged;
  }, [referencedIds, extraIds]);

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
    void loadInkSidecar(selectedStoryId)
      .then((text) => {
        if (cancelled) return;
        setSource(text ?? `=== start ===\n`);
        setDirty(false);
      })
      .catch((err) => {
        console.error('Failed to load ink sidecar:', err);
        if (!cancelled) onStatus(t('painter.ink.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStoryId, onStatus, t]);

  const compile = useMemo(() => tryCompileInkSource(source), [source]);

  const handleSave = useCallback(async () => {
    if (selectedStoryId === undefined || !isSafeStoryId(selectedStoryId)) return;
    if (!compile.ok) {
      onStatus(t('painter.ink.saveBlocked'));
      return;
    }
    try {
      await saveInkSidecar(selectedStoryId, source);
      setDirty(false);
      onStatus(t('painter.ink.saveSuccess'));
    } catch (err) {
      console.error('Failed to save ink sidecar:', err);
      onStatus(t('painter.ink.saveFailed'));
    }
  }, [selectedStoryId, compile.ok, source, onStatus, t]);

  if (!painterState) return null;

  const openStory = () => {
    const id = manualStoryId.trim();
    if (!isSafeStoryId(id)) {
      onStatus(t('painter.ink.invalidStoryId'));
      return;
    }
    if (!extraIds.includes(id) && !referencedIds.includes(id)) {
      setExtraIds([...extraIds, id]);
    }
    setSelectedStoryId(id);
    setManualStoryId('');
  };

  return (
    <section className="ink-workbench" aria-label={t('painter.ink')}>
      <h3 className="ide-section-title">{t('painter.ink')}</h3>
      <p className="ide-hint">{t('painter.ink.help')}</p>
      <div className="painter-events-add-event">
        <input
          type="text"
          value={manualStoryId}
          placeholder={t('painter.ink.storyPlaceholder')}
          onChange={(e) => setManualStoryId(e.target.value)}
        />
        <button type="button" className="primary" onClick={openStory}>
          {t('painter.ink.open')}
        </button>
      </div>
      {storyIds.length === 0 ? (
        <p className="ide-hint">{t('painter.ink.none')}</p>
      ) : (
        <div className="ink-split">
          <label>
            {t('painter.ink.story')}
            <select
              value={selectedStoryId ?? ''}
              onChange={(e) => setSelectedStoryId(e.target.value)}
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
