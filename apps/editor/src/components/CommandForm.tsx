/**
 * Recursive event-command form (events editor WU-02).
 * Thin untested shell over painter-store ops + event-form-helpers.
 */

import type {
  CardinalDirection,
  ConditionalOp,
  ConditionSource,
  EventCommand,
  WorldValue,
} from '@threemaker/core';
import { useState } from 'react';
import {
  dialogueLinesFromTextarea,
  dialogueLinesToTextarea,
  EVENT_COMMAND_KINDS,
  parseIntField,
  parseNumberField,
  parseWorldValue,
  type WorldValueKind,
  worldValueKind,
} from '../event-form-helpers.js';
import type { CommandPath, EventCommandKind } from '../painter-store.js';

const DIRECTIONS: readonly CardinalDirection[] = ['down', 'left', 'right', 'up'];
const CONDITIONAL_OPS: readonly ConditionalOp[] = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'];
const CONDITION_SOURCES: readonly ConditionSource[] = ['world', 'item', 'stat'];
const WORLD_VALUE_KINDS: readonly WorldValueKind[] = ['boolean', 'number', 'string'];

export interface CommandMutators {
  readonly onUpdate: (path: CommandPath, patch: Readonly<Record<string, unknown>>) => void;
  readonly onRemove: (path: CommandPath) => void;
  readonly onMove: (path: CommandPath, delta: number) => void;
  readonly onAdd: (path: CommandPath, kind: EventCommandKind) => void;
}

export interface CommandListProps extends CommandMutators {
  readonly t: (key: string) => string;
  /** Path prefix before each command index (empty = event root script). */
  readonly basePath: CommandPath;
  readonly commands: readonly EventCommand[];
}

export function CommandList({
  t,
  basePath,
  commands,
  onUpdate,
  onRemove,
  onMove,
  onAdd,
}: CommandListProps) {
  return (
    <div className="painter-events-command-list">
      <ul>
        {commands.map((command, index) => {
          const path: CommandPath = [...basePath, index];
          return (
            <li key={pathKey(path)}>
              <CommandForm
                t={t}
                path={path}
                command={command}
                index={index}
                total={commands.length}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onMove={onMove}
                onAdd={onAdd}
              />
            </li>
          );
        })}
      </ul>
      <AddCommandPicker t={t} onPick={(kind) => onAdd([...basePath, commands.length], kind)} />
    </div>
  );
}

interface CommandFormProps extends CommandMutators {
  readonly t: (key: string) => string;
  readonly path: CommandPath;
  readonly command: EventCommand;
  readonly index: number;
  readonly total: number;
}

function CommandForm({
  t,
  path,
  command,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
  onAdd,
}: CommandFormProps) {
  return (
    <div className="painter-events-command">
      <div className="painter-events-command-toolbar">
        <span className="painter-events-command-kind">
          {t(`painter.events.kind.${command.type}`)}
        </span>
        <button
          type="button"
          disabled={index === 0}
          title={t('painter.events.moveUp')}
          onClick={() => onMove(path, -1)}
        >
          ▲
        </button>
        <button
          type="button"
          disabled={index >= total - 1}
          title={t('painter.events.moveDown')}
          onClick={() => onMove(path, 1)}
        >
          ▼
        </button>
        <button type="button" onClick={() => onRemove(path)}>
          {t('painter.events.removeCommand')}
        </button>
      </div>
      <CommandFields t={t} path={path} command={command} onUpdate={onUpdate} />
      {command.type === 'conditional' && (
        <div className="painter-events-branches">
          <div className="painter-events-branch">
            <span className="painter-events-branch-heading">{t('painter.events.field.then')}</span>
            <CommandList
              t={t}
              basePath={[...path, 'then']}
              commands={command.then}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onMove={onMove}
              onAdd={onAdd}
            />
          </div>
          <div className="painter-events-branch">
            <span className="painter-events-branch-heading">{t('painter.events.field.else')}</span>
            <CommandList
              t={t}
              basePath={[...path, 'else']}
              commands={command.else ?? []}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onMove={onMove}
              onAdd={onAdd}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface CommandFieldsProps {
  readonly t: (key: string) => string;
  readonly path: CommandPath;
  readonly command: EventCommand;
  readonly onUpdate: (path: CommandPath, patch: Readonly<Record<string, unknown>>) => void;
}

function CommandFields({ t, path, command, onUpdate }: CommandFieldsProps) {
  switch (command.type) {
    case 'moveEntity':
      return (
        <div className="painter-events-fields">
          <label>
            {t('painter.events.field.entityId')}
            <input
              type="text"
              value={command.entityId}
              onChange={(e) => onUpdate(path, { entityId: e.target.value })}
            />
          </label>
          <label>
            {t('painter.events.field.direction')}
            <select
              value={command.direction}
              onChange={(e) => onUpdate(path, { direction: e.target.value as CardinalDirection })}
            >
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`painter.npcs.facing.${d}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('painter.events.field.steps')}
            <input
              type="number"
              min={1}
              step={1}
              value={command.steps}
              onChange={(e) =>
                onUpdate(path, { steps: parseIntField(e.target.value, command.steps) })
              }
            />
          </label>
        </div>
      );
    case 'showDialogue': {
      const lines =
        command.source.kind === 'text' ? command.source.lines : ([] as readonly string[]);
      const inkStoryId = command.source.kind === 'ink' ? command.source.storyId : '';
      const inkKnot = command.source.kind === 'ink' ? (command.source.knot ?? '') : '';
      return (
        <div className="painter-events-fields">
          <p className="painter-events-hint">{t('painter.events.dialogueInkHint')}</p>
          <label>
            {t('painter.events.field.dialogueKind')}
            <select
              value={command.source.kind}
              onChange={(e) => {
                const kind = e.target.value;
                if (kind === 'ink') {
                  onUpdate(path, {
                    source: { kind: 'ink', storyId: inkStoryId || 'story', knot: 'start' },
                  });
                } else {
                  onUpdate(path, {
                    source: { kind: 'text', lines: lines.length > 0 ? [...lines] : [''] },
                  });
                }
              }}
            >
              <option value="text">{t('painter.events.dialogueKind.text')}</option>
              <option value="ink">{t('painter.events.dialogueKind.ink')}</option>
            </select>
          </label>
          <label>
            {t('painter.events.field.speaker')}
            <input
              type="text"
              value={command.speaker ?? ''}
              onChange={(e) => {
                const speaker = e.target.value;
                onUpdate(path, speaker === '' ? { speaker: undefined } : { speaker });
              }}
            />
          </label>
          {command.source.kind === 'ink' ? (
            <>
              <label>
                {t('painter.events.field.storyId')}
                <input
                  type="text"
                  value={inkStoryId}
                  onChange={(e) =>
                    onUpdate(path, {
                      source: {
                        kind: 'ink',
                        storyId: e.target.value,
                        ...(inkKnot === '' ? {} : { knot: inkKnot }),
                      },
                    })
                  }
                />
              </label>
              <label>
                {t('painter.events.field.knot')}
                <input
                  type="text"
                  value={inkKnot}
                  onChange={(e) => {
                    const knot = e.target.value;
                    onUpdate(path, {
                      source:
                        knot === ''
                          ? { kind: 'ink', storyId: inkStoryId }
                          : { kind: 'ink', storyId: inkStoryId, knot },
                    });
                  }}
                />
              </label>
            </>
          ) : (
            <label>
              {t('painter.events.field.lines')}
              <textarea
                rows={Math.max(2, lines.length || 1)}
                value={dialogueLinesToTextarea(lines)}
                onChange={(e) =>
                  onUpdate(path, {
                    source: { kind: 'text', lines: dialogueLinesFromTextarea(e.target.value) },
                  })
                }
              />
            </label>
          )}
        </div>
      );
    }
    case 'conditional':
      return (
        <div className="painter-events-fields">
          <label>
            {t('painter.events.field.ifKey')}
            <input
              type="text"
              value={command.if.key}
              onChange={(e) => onUpdate(path, { if: { key: e.target.value } })}
            />
          </label>
          <label>
            {t('painter.events.field.ifOp')}
            <select
              value={command.if.op}
              onChange={(e) => onUpdate(path, { if: { op: e.target.value as ConditionalOp } })}
            >
              {CONDITIONAL_OPS.map((op) => (
                <option key={op} value={op}>
                  {t(`painter.events.op.${op}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('painter.events.field.ifSource')}
            <select
              value={command.if.source ?? 'world'}
              onChange={(e) => {
                const source = e.target.value as ConditionSource;
                onUpdate(path, {
                  if: { source: source === 'world' ? undefined : source },
                });
              }}
            >
              {CONDITION_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {t(`painter.events.source.${source}`)}
                </option>
              ))}
            </select>
          </label>
          <WorldValueFields
            t={t}
            value={command.if.value}
            onChange={(value) => onUpdate(path, { if: { value } })}
          />
        </div>
      );
    case 'setWorldVar':
      return (
        <div className="painter-events-fields">
          <label>
            {t('painter.events.field.key')}
            <input
              type="text"
              value={command.key}
              onChange={(e) => onUpdate(path, { key: e.target.value })}
            />
          </label>
          <WorldValueFields
            t={t}
            value={command.value}
            onChange={(value) => onUpdate(path, { value })}
          />
        </div>
      );
    case 'teleport':
      return (
        <div className="painter-events-fields">
          <label>
            {t('painter.events.field.entityId')}
            <input
              type="text"
              value={command.entityId}
              onChange={(e) => onUpdate(path, { entityId: e.target.value })}
            />
          </label>
          <label>
            {t('painter.events.field.x')}
            <input
              type="number"
              step={1}
              value={command.x}
              onChange={(e) => onUpdate(path, { x: parseIntField(e.target.value, command.x) })}
            />
          </label>
          <label>
            {t('painter.events.field.y')}
            <input
              type="number"
              step={1}
              value={command.y}
              onChange={(e) => onUpdate(path, { y: parseIntField(e.target.value, command.y) })}
            />
          </label>
          <FacingSelect
            t={t}
            value={command.facing}
            onChange={(facing) => onUpdate(path, { facing })}
          />
        </div>
      );
    case 'transferMap':
      return (
        <div className="painter-events-fields">
          <label>
            {t('painter.events.field.mapFile')}
            <input
              type="text"
              value={command.mapFile}
              onChange={(e) => onUpdate(path, { mapFile: e.target.value })}
            />
          </label>
          <label>
            {t('painter.events.field.x')}
            <input
              type="number"
              step={1}
              value={command.x}
              onChange={(e) => onUpdate(path, { x: parseIntField(e.target.value, command.x) })}
            />
          </label>
          <label>
            {t('painter.events.field.y')}
            <input
              type="number"
              step={1}
              value={command.y}
              onChange={(e) => onUpdate(path, { y: parseIntField(e.target.value, command.y) })}
            />
          </label>
          <FacingSelect
            t={t}
            value={command.facing}
            onChange={(facing) => onUpdate(path, { facing })}
          />
        </div>
      );
    case 'giveItem':
      return (
        <div className="painter-events-fields">
          <label>
            {t('painter.events.field.itemId')}
            <input
              type="text"
              value={command.itemId}
              onChange={(e) => onUpdate(path, { itemId: e.target.value })}
            />
          </label>
          <label>
            {t('painter.events.field.amount')}
            <input
              type="number"
              step={1}
              value={command.amount}
              onChange={(e) =>
                onUpdate(path, { amount: parseIntField(e.target.value, command.amount) })
              }
            />
          </label>
        </div>
      );
    case 'modifyStat':
      return (
        <div className="painter-events-fields">
          <label>
            {t('painter.events.field.statId')}
            <input
              type="text"
              value={command.statId}
              onChange={(e) => onUpdate(path, { statId: e.target.value })}
            />
          </label>
          <label>
            {t('painter.events.field.delta')}
            <input
              type="number"
              step={1}
              value={command.delta}
              onChange={(e) =>
                onUpdate(path, {
                  delta: parseNumberField(e.target.value, command.delta),
                })
              }
            />
          </label>
        </div>
      );
  }
}

function WorldValueFields({
  t,
  value,
  onChange,
}: {
  readonly t: (key: string) => string;
  readonly value: WorldValue;
  readonly onChange: (value: WorldValue) => void;
}) {
  const kind = worldValueKind(value);
  return (
    <>
      <label>
        {t('painter.events.worldValueType')}
        <select
          value={kind}
          onChange={(e) => {
            const next = e.target.value as WorldValueKind;
            if (next === kind) return;
            onChange(
              parseWorldValue(next, next === 'boolean' ? false : next === 'number' ? 0 : ''),
            );
          }}
        >
          {WORLD_VALUE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`painter.events.worldValueType.${k}`)}
            </option>
          ))}
        </select>
      </label>
      {kind === 'boolean' ? (
        <label>
          {t('painter.events.field.value')}
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
        </label>
      ) : kind === 'number' ? (
        <label>
          {t('painter.events.field.value')}
          <input
            type="number"
            value={typeof value === 'number' ? value : 0}
            onChange={(e) => onChange(parseWorldValue('number', e.target.value))}
          />
        </label>
      ) : (
        <label>
          {t('painter.events.field.value')}
          <input
            type="text"
            value={typeof value === 'string' ? value : String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )}
    </>
  );
}

function FacingSelect({
  t,
  value,
  onChange,
}: {
  readonly t: (key: string) => string;
  readonly value: CardinalDirection | undefined;
  readonly onChange: (facing: CardinalDirection | undefined) => void;
}) {
  return (
    <label>
      {t('painter.events.field.facing')}
      <select
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? undefined : (v as CardinalDirection));
        }}
      >
        <option value="">{t('painter.events.field.facing.none')}</option>
        {DIRECTIONS.map((d) => (
          <option key={d} value={d}>
            {t(`painter.npcs.facing.${d}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function AddCommandPicker({
  t,
  onPick,
}: {
  readonly t: (key: string) => string;
  readonly onPick: (kind: EventCommandKind) => void;
}) {
  const [kind, setKind] = useState<EventCommandKind>('setWorldVar');
  return (
    <div className="painter-events-add-command">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as EventCommandKind)}
        aria-label={t('painter.events.addCommand')}
      >
        {EVENT_COMMAND_KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`painter.events.kind.${k}`)}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => onPick(kind)}>
        {t('painter.events.addCommand')}
      </button>
    </div>
  );
}

function pathKey(path: CommandPath): string {
  return path.join('.');
}
