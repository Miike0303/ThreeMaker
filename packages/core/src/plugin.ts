import { BUILTIN_COMMAND_TYPES } from './event-command.js';
import type { EventHost, ItemStore, StatStore } from './event-interpreter.js';
import type { WorldState } from './world-state.js';

/**
 * A command contributed by a plugin rather than by core's closed
 * {@link EventCommand} union. The `type` discriminator is the plugin's
 * registered name; every other field is authored content the plugin's own
 * `parse` is responsible for validating.
 */
export interface PluginCommand {
  readonly type: string;
  readonly [field: string]: unknown;
}

/**
 * What a plugin's `run` is handed. Mirrors what {@link EventInterpreter}
 * holds internally, so a plugin can do anything a builtin command can.
 */
export interface CommandContext {
  readonly world: WorldState;
  readonly host: EventHost;
  /** Present only when an inventory store was injected into the interpreter. */
  readonly items: ItemStore | undefined;
  /** Present only when a stat store was injected into the interpreter. */
  readonly stats: StatStore | undefined;
  /**
   * Resume the script. Call exactly once, and only when `run` returned
   * `'wait'` — same contract as {@link EventHost.moveEntity}'s `done`.
   */
  readonly done: () => void;
}

/**
 * Extension point for authored commands core does not ship.
 *
 * A plugin owns both halves of one command type: how it parses out of
 * authored JSON, and what it does at runtime. Registering combat, crafting
 * or any genre-specific verb costs one of these and no core change — which
 * is what keeps genre out of the engine.
 *
 * ```ts
 * const startBattle: CommandPlugin = {
 *   type: 'startBattle',
 *   parse(value, path) {
 *     const { troopId } = value;
 *     if (typeof troopId !== 'string') throw new Error(`${path} needs a string "troopId".`);
 *     return { type: 'startBattle', troopId };
 *   },
 *   run(command, ctx) {
 *     openBattleScene(command.troopId as string, ctx.done);
 *     return 'wait';
 *   },
 * };
 * ```
 */
export interface CommandPlugin<TCommand extends PluginCommand = PluginCommand> {
  /** Command discriminator. Must not collide with a builtin or another plugin. */
  readonly type: string;
  /**
   * Validate one authored command object. Throw on malformed content — the
   * caller wraps the message with the offending path, matching core's own
   * `Invalid Event Script:` failures. The returned object's `type` must equal
   * this plugin's `type`.
   */
  parse(value: Record<string, unknown>, path: string): TCommand;
  /**
   * Execute the command. Return `'continue'` to run the next command
   * immediately, or `'wait'` to block the script until `ctx.done()` fires.
   */
  run(command: TCommand, ctx: CommandContext): 'continue' | 'wait';
}

/**
 * Name → {@link CommandPlugin} lookup shared by `parseEventScript` and
 * {@link EventInterpreter}. Both must be given the *same* registry: parsing
 * with it and interpreting without it yields commands nothing can execute.
 */
export class CommandRegistry {
  private readonly plugins = new Map<string, CommandPlugin>();

  /**
   * Add a plugin. Throws if `plugin.type` shadows a builtin command or a
   * previously registered plugin — silently losing one of two handlers for
   * the same authored type is a bug that only ever surfaces mid-playtest.
   */
  register(plugin: CommandPlugin): void {
    const { type } = plugin;
    if (type.length === 0) {
      throw new Error('CommandRegistry: plugin "type" must be a non-empty string.');
    }
    if ((BUILTIN_COMMAND_TYPES as readonly string[]).includes(type)) {
      throw new Error(`CommandRegistry: ${JSON.stringify(type)} is a builtin command type.`);
    }
    if (this.plugins.has(type)) {
      throw new Error(`CommandRegistry: ${JSON.stringify(type)} is already registered.`);
    }
    this.plugins.set(type, plugin as CommandPlugin);
  }

  /** The plugin registered for `type`, or `undefined`. */
  get(type: string): CommandPlugin | undefined {
    return this.plugins.get(type);
  }

  /** Every registered command type, in registration order. */
  types(): readonly string[] {
    return [...this.plugins.keys()];
  }
}
