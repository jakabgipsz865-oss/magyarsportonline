/**
 * Cheap syntactic heuristic for the prompt-injection defense
 * (docs/architecture/02-agents.md §2.4, 09-architecture-review.md §8).
 * Deliberately over-broad (false positives just route a Story to review,
 * which is the safe direction to be wrong in) rather than under-broad.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|the)? ?(previous|prior|above) instructions/i,
  /disregard (all|any)? ?(previous|prior|above) instructions/i,
  /system prompt/i,
  /you are now/i,
  /new instructions ?:/i,
  /\bAI\b.{0,20}\bmust\b/i,
  /act as (an?|the)/i,
];

export function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}
