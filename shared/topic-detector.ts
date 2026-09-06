import type { SupportedCodeLanguage } from './contracts.ts';

export type TopicDetectionResult = {
  isCodeTopic: boolean;
  language?: SupportedCodeLanguage;
  confidence: 'high' | 'medium' | 'low';
};

/**
 * Strict whitelist of supported programming languages and frameworks.
 * Only topics explicitly matching these supported technologies are treated as code topics.
 */
export const SUPPORTED_LANGUAGES_WHITELIST: Array<{
  lang: SupportedCodeLanguage;
  patterns: RegExp[];
}> = [
  {
    lang: 'python',
    patterns: [
      /\bpython(?:3)?\b/i,
      /\bdjango\b/i,
      /\bflask\b/i,
      /\bpandas\b/i,
      /\bnumpy\b/i,
      /\bpyodbc\b/i,
      /\bpytorch\b/i,
      /\bpytest\b/i,
      /\bfastapi\b/i,
      /\bmatplotlib\b/i,
    ],
  },
  {
    lang: 'sql',
    patterns: [
      /\bsql\b/i,
      /\bpostgres(?:ql)?\b/i,
      /\bmysql\b/i,
      /\bduckdb\b/i,
      /\bsqlite(?:3)?\b/i,
      /\bdatabase queries?\b/i,
      /\brdbms\b/i,
      /\bselect query\b/i,
      /\bsql joins?\b/i,
    ],
  },
  {
    lang: 'javascript',
    patterns: [
      /\bjavascript\b/i,
      /\bjs\b/i,
      /\bnode(?:\.js)?\b/i,
      /\breact(?:\.js)?\b/i,
      /\bexpress(?:\.js)?\b/i,
      /\bvue(?:\.js)?\b/i,
      /\bvanilla js\b/i,
      /\bfront[- ]?end web development\b/i,
    ],
  },
  {
    lang: 'typescript',
    patterns: [
      /\btypescript\b/i,
      /\bts\b/i,
      /\bts node\b/i,
      /\bnext(?:\.js)?\b/i,
    ],
  },
  {
    lang: 'cpp',
    patterns: [
      /(?:^|\W)c\+\+(?!\w)/i,
      /\bcpp\b/i,
      /\bcplusplus\b/i,
      /\bpointers and memory\b/i,
      /\bclang\b/i,
      /\bgcc\b/i,
    ],
  },
  {
    lang: 'java',
    patterns: [
      /\bjava\b/i,
      /\bspring boot\b/i,
      /\bjvm\b/i,
    ],
  },
];

/**
 * Whitelist for explicit generic coding / programming topics.
 * Topics containing these explicit coding keywords can be assigned a default executable language (python).
 */
export const GENERIC_CODING_WHITELIST: RegExp[] = [
  /\b(computer programming|write code|coding exercises?|coding challenges?)\b/i,
  /\b(data structures and algorithms|data structures & algorithms|dsa in code)\b/i,
  /\b(software engineering|backend development|web development coding)\b/i,
  /\b(object[- ]oriented programming|oop in code)\b/i,
];

/**
 * Detects whether a topic/goal is a programming topic based strictly on accepted whitelists.
 * Non-whitelisted topics (e.g. languages like Spanish/French, mathematics, history, business)
 * automatically return isCodeTopic: false.
 */
export function detectCodeTopic(
  topic: string,
  goalTitle: string = '',
  goalMotivation: string = '',
): TopicDetectionResult {
  const combinedText = `${topic} ${goalTitle} ${goalMotivation}`.toLowerCase();

  // 1. Check against the explicit supported language whitelist
  for (const { lang, patterns } of SUPPORTED_LANGUAGES_WHITELIST) {
    if (patterns.some((pattern) => pattern.test(combinedText))) {
      return {
        isCodeTopic: true,
        language: lang,
        confidence: 'high',
      };
    }
  }

  // 2. Check against explicit generic coding whitelist (defaults to Python)
  if (GENERIC_CODING_WHITELIST.some((pattern) => pattern.test(combinedText))) {
    return {
      isCodeTopic: true,
      language: 'python',
      confidence: 'medium',
    };
  }

  // 3. Any topic not in the accepted whitelist is not treated as a coding topic
  return {
    isCodeTopic: false,
    confidence: 'high',
  };
}

/**
 * Convenience helper to determine if a goal is a supported coding topic.
 */
export function isCodingGoal(goal?: { title: string; motivation?: string } | null): boolean {
  if (!goal) return false;
  return detectCodeTopic(goal.title, goal.title, goal.motivation ?? '').isCodeTopic;
}
