import { Config } from './config';
import type { SessionEvent } from './delta';
import type { GoalService } from './goal-tasks';
import { RPC_CHANNEL } from './rpc';
export declare const name = "dsh-goal-keeper";
export declare const inject: string[];
export { Config };
export { RPC_CHANNEL };
/**
 * Settings namespace: pinned to the original 'dsh-mini-advisor' literal even
 * though the plugin was renamed to dsh-goal-keeper, so existing saved settings
 * (provider/model overrides) are not orphaned by the rename.
 */
export declare const SETTINGS_NAMESPACE = "dsh-mini-advisor";
interface Agent {
    session?: {
        /** Identity shared with the session log; the key every keeper map uses. */
        id?: string;
        events?: readonly SessionEvent[];
        append?(type: string, data: unknown): unknown;
    };
    inject(message: unknown): void;
}
/** One `/keeper` invocation (the subset of dsh-commands' CommandInvocation we read). */
interface CommandInvocation {
    agent: Agent;
    rawInput: string;
}
/** The handler outcome the dispatching UI renders. */
type CommandResult = {
    kind: 'success';
    text?: string;
} | {
    kind: 'error';
    text: string;
};
interface CommandDefinition {
    name: string;
    description: string;
    input?: {
        hint: string;
    };
    handler(invocation: CommandInvocation): CommandResult;
}
interface SettingsScope {
    get(): unknown;
    watch(cb: (next: unknown, prev: unknown) => void): () => void;
    update(patch: unknown): unknown;
}
interface ResolvedModelInfo {
    reasoning?: {
        efforts: Array<{
            id: string;
            name: string;
            description?: string;
        }>;
        defaultEffort?: string;
    };
}
interface LlmInfo {
    id: string;
    name: string;
}
interface LlmConfigEntry {
    provider: string;
    displayName: string;
    settingsNs: string;
    settingsPath: readonly string[];
    declared?: boolean;
}
interface LlmModelInfo {
    id: string;
    name: string;
}
export interface HostContext {
    agents: {
        get(id: string): Agent | undefined;
    };
    llm: {
        stream(options: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
        listProviders(): LlmInfo[];
        listConfigurableProviders(): LlmConfigEntry[];
        listModels(provider: string): Promise<LlmModelInfo[]>;
        resolveModelInfo(provider: string, model: string): Promise<ResolvedModelInfo>;
    };
    settings: {
        register(ns: string, schema: unknown, options?: unknown): SettingsScope;
        get(ns: string): unknown;
    };
    goals: GoalService;
    commands: {
        register(definition: CommandDefinition): () => void;
    };
    get?(name: string): unknown;
    logger?: {
        debug?(message: string, meta?: Record<string, unknown>): void;
        info?(message: string, meta?: Record<string, unknown>): void;
    };
    on(event: string, listener: (...args: unknown[]) => unknown): unknown;
    effect(factory: () => unknown, label?: string): void;
}
/** Extract the advise-tool call arguments from the advisor model's streamed blocks. */
export declare function readAdviceFromBlocks(blocks: Array<Record<string, unknown>>): {
    severity: string;
    note: string;
} | undefined;
/** Extract a set_goal objective from the keeper's streamed blocks. */
export declare function readGoalFromBlocks(blocks: Array<Record<string, unknown>>): string | undefined;
/** Detect a complete_goal call in the keeper's streamed blocks. */
export declare function readCompleteFromBlocks(blocks: Array<Record<string, unknown>>): boolean;
/** Extract update_tasks task lines from the keeper's streamed blocks. */
export declare function readTasksFromBlocks(blocks: Array<Record<string, unknown>>): string[];
export declare function apply(ctx: HostContext): void;
