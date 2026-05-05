import { and, count, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';

import { agents, messagePlugins, messages, topics, userMemories } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/**
 * Normalizes database aggregate timestamps.
 *
 * Before:
 * - "2026-05-03 14:00:00+00"
 *
 * After:
 * - Date("2026-05-03T14:00:00.000Z")
 */
const parseAggregateTimestamp = (value: Date | string) =>
  value instanceof Date ? value : new Date(value);

/** Query options for bounded Agent Signal topic activity. */
export interface ListAgentSignalTopicActivityOptions {
  /** Agent whose topic activity is being reviewed. */
  agentId: string;
  /** Maximum rows to return. */
  limit: number;
  /** Review window end in UTC. */
  windowEnd: Date;
  /** Review window start in UTC. */
  windowStart: Date;
}

/** Query options for scoped Agent Signal self-reflection topic activity. */
export interface ListAgentSignalSelfReflectionTopicOptions {
  /** Agent whose scoped activity is being reviewed. */
  agentId: string;
  /** Topic id selected by the source scope. */
  topicId: string;
  /** Review window end in UTC. */
  windowEnd: Date;
  /** Review window start in UTC. */
  windowStart: Date;
}

/** Query options for relevant memory summaries used by review context. */
export interface ListAgentSignalRelevantMemoriesOptions {
  /** Maximum rows to return. */
  limit: number;
}

/** Bounded topic activity row used by Agent Signal reviewers. */
export interface AgentSignalTopicActivityRow {
  /** Failed tool-call count in the row scope. */
  failedToolCount: number;
  /** Failed assistant/message count in the row scope. */
  failureCount: number;
  /** Last activity timestamp in the row scope. */
  lastActivityAt: Date | null;
  /** Total message count in the row scope. */
  messageCount: number;
  /** Digest-safe topic summary text. */
  summary: string;
  /** Topic title. */
  title: string | null;
  /** Stable topic id. */
  topicId: string | null;
}

/** Relevant memory row used by Agent Signal review context. */
export interface AgentSignalRelevantMemoryRow {
  /** Digest-safe memory content. */
  content: string;
  /** Stable memory id. */
  id: string;
  /** Last memory update timestamp. */
  updatedAt: Date;
}

/**
 * Queries database-backed context for Agent Signal self-review policies.
 *
 * Use when:
 * - Server maintenance policy deps need reviewer context from persisted chat data
 * - Gate checks need agent ownership and self-iteration opt-in verification
 *
 * Expects:
 * - `userId` scopes every query to one owner
 * - Callers pass UTC `Date` windows derived from source-event payloads
 *
 * Returns:
 * - Digest-safe rows without raw message transcripts
 */
export class AgentSignalReviewContextModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Checks whether an agent can run self-iteration maintenance.
   *
   * Use when:
   * - Source handlers re-check ownership and agent-level opt-in before reviewer work
   *
   * Expects:
   * - User-level feature gates are checked by the service layer
   *
   * Returns:
   * - `true` only for owned, non-virtual, self-iteration-enabled agents
   */
  canAgentRunSelfIteration = async (agentId: string) => {
    const [agent] = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          eq(agents.userId, this.userId),
          or(eq(agents.virtual, false), isNull(agents.virtual)),
          sql`COALESCE((${agents.chatConfig}->'selfIteration'->>'enabled')::boolean, false) = true`,
        ),
      )
      .limit(1);

    return Boolean(agent);
  };

  /**
   * Lists recent relevant memory summaries for review context.
   *
   * Use when:
   * - Nightly reviewers need compact existing memory context for dedupe and refinement hints
   *
   * Expects:
   * - `limit` is already bounded by the service layer
   *
   * Returns:
   * - Memory rows ordered by most recently updated first
   */
  listRelevantMemories = (options: ListAgentSignalRelevantMemoriesOptions) => {
    return this.db
      .select({
        content: sql<string>`COALESCE(${userMemories.summary}, ${userMemories.title}, ${userMemories.details}, '')`,
        id: userMemories.id,
        updatedAt: userMemories.updatedAt,
      })
      .from(userMemories)
      .where(eq(userMemories.userId, this.userId))
      .orderBy(desc(userMemories.updatedAt))
      .limit(options.limit);
  };

  /**
   * Lists bounded topic activity for nightly review context.
   *
   * Use when:
   * - Nightly reviewers need high-signal topic digests without raw transcripts
   *
   * Expects:
   * - Message `agentId` wins when present; topic `agentId` covers legacy messages
   *
   * Returns:
   * - Topic rows ordered by latest message activity
   */
  listTopicActivity = (options: ListAgentSignalTopicActivityOptions) => {
    const effectiveAgentId = sql<string>`COALESCE(${messages.agentId}, ${topics.agentId})`;

    return this.db
      .select({
        failedToolCount:
          sql<number>`COUNT(${messagePlugins.id}) FILTER (WHERE ${messagePlugins.error} IS NOT NULL)`.mapWith(
            Number,
          ),
        failureCount:
          sql<number>`COUNT(${messages.id}) FILTER (WHERE ${messages.error} IS NOT NULL)`.mapWith(
            Number,
          ),
        lastActivityAt: sql<Date>`MAX(${messages.createdAt})`.mapWith(parseAggregateTimestamp),
        messageCount: count(messages.id),
        summary: sql<string>`COALESCE(${topics.historySummary}, ${topics.description}, ${topics.content}, '')`,
        title: topics.title,
        topicId: topics.id,
      })
      .from(messages)
      .leftJoin(topics, and(eq(topics.id, messages.topicId), eq(topics.userId, this.userId)))
      .leftJoin(
        messagePlugins,
        and(eq(messagePlugins.id, messages.id), eq(messagePlugins.userId, this.userId)),
      )
      .where(
        and(
          eq(messages.userId, this.userId),
          eq(effectiveAgentId, options.agentId),
          gte(messages.createdAt, options.windowStart),
          lte(messages.createdAt, options.windowEnd),
        ),
      )
      .groupBy(topics.id, topics.title, topics.historySummary, topics.description, topics.content)
      .orderBy(desc(sql`MAX(${messages.createdAt})`))
      .limit(options.limit);
  };

  /**
   * Lists scoped topic activity for self-reflection review context.
   *
   * Use when:
   * - Fast-loop self-reflection requests need bounded evidence for one topic scope
   *
   * Expects:
   * - `topicId` belongs to the same user and review window
   *
   * Returns:
   * - At most one topic digest row for the requested scope
   */
  listSelfReflectionTopicActivity = (options: ListAgentSignalSelfReflectionTopicOptions) => {
    return this.db
      .select({
        failedToolCount:
          sql<number>`COUNT(${messagePlugins.id}) FILTER (WHERE ${messagePlugins.error} IS NOT NULL)`.mapWith(
            Number,
          ),
        failureCount:
          sql<number>`COUNT(${messages.id}) FILTER (WHERE ${messages.error} IS NOT NULL)`.mapWith(
            Number,
          ),
        lastActivityAt: sql<Date>`MAX(${messages.createdAt})`.mapWith(parseAggregateTimestamp),
        messageCount: count(messages.id),
        summary: sql<string>`COALESCE(${topics.historySummary}, ${topics.description}, ${topics.content}, '')`,
        title: topics.title,
        topicId: topics.id,
      })
      .from(messages)
      .leftJoin(topics, and(eq(topics.id, messages.topicId), eq(topics.userId, this.userId)))
      .leftJoin(
        messagePlugins,
        and(eq(messagePlugins.id, messages.id), eq(messagePlugins.userId, this.userId)),
      )
      .where(
        and(
          eq(messages.userId, this.userId),
          eq(messages.agentId, options.agentId),
          gte(messages.createdAt, options.windowStart),
          lte(messages.createdAt, options.windowEnd),
          eq(messages.topicId, options.topicId),
        ),
      )
      .groupBy(topics.id, topics.title, topics.historySummary, topics.description, topics.content)
      .limit(1);
  };
}
