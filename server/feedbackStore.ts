import crypto from 'node:crypto';
import type { AuthSession, FeedbackRecord } from './types.ts';
import { recordProvenance } from './provenance.ts';
import { logger } from './logger.ts';

const feedbackRecords: FeedbackRecord[] = [];

export function saveFeedback(
  input: {
    provenanceId: string;
    question: string;
    answerExcerpt: string;
    rating: number;
    comments?: string;
    reviewDecision?: 'approved' | 'needs_revision' | 'flagged';
  },
  session: AuthSession
): FeedbackRecord {
  const record: FeedbackRecord = {
    id: `fb-${crypto.randomUUID().slice(0, 8)}`,
    provenanceId: input.provenanceId,
    question: input.question,
    answerExcerpt: input.answerExcerpt.slice(0, 400),
    rating: input.rating,
    comments: (input.comments ?? '').trim(),
    reviewDecision: input.reviewDecision ?? 'approved',
    reviewerId: session.userId,
    reviewerRole: session.role,
    autoTrainingBlocked: true,
    createdAt: new Date().toISOString(),
  };

  feedbackRecords.unshift(record);
  if (feedbackRecords.length > 200) {
    feedbackRecords.length = 200;
  }

  recordProvenance({
    kind: 'feedback',
    actorId: session.userId,
    actorRole: session.role,
    action: `review:${record.reviewDecision}`,
    rawInput: `${record.provenanceId}:${record.rating}:${record.comments}`,
    modelOrEngine: 'human-review-gate',
    licenses: ['Internal Peer Review'],
    sourceUrls: [],
    metadata: {
      rating: record.rating,
      autoTrainingBlocked: true,
    },
  });

  logger.info('feedback', 'Recorded human review feedback (quarantined from auto-training)', {
    feedbackId: record.id,
    provenanceId: record.provenanceId,
    decision: record.reviewDecision,
  });

  return record;
}

export function listFeedback(limit = 50): FeedbackRecord[] {
  return feedbackRecords.slice(0, limit);
}

export function clearFeedbackForTest(): void {
  feedbackRecords.length = 0;
}
