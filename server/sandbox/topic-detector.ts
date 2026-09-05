import type { SupportedCodeLanguage } from './contracts.ts';

type TopicDetectionResult = {
  isCodeTopic: boolean;
  language?: SupportedCodeLanguage;
  confidence: 'high' | 'medium' | 'low';
};

const LANGUAGE_PATTERNS: Array<{ lang: SupportedCodeLanguage; patterns: RegExp[] }> = [
  {
    lang: 'python',
    patterns: [
      /\bpython\b/i, /\bdjango\b/i, /\bflask\b/i, /\bpandas\b/i, /\bnumpy\b/i,
      /\bpyodbc\b/i, /\bpytorch\b/i, /\bpytest\b/i,
    ],
  },
  {
    lang: 'sql',
    patterns: [
      /\bsql\b/i, /\bpostgres(ql)?\b/i, /\bmysql\b/i, /\bduckdb\b/i, /\bsqlite\b/i,
      /\bdatabase queries?\b/i, /\brdbms\b/i, /\bselect query\b/i,
    ],
  },
  {
    lang: 'javascript',
    patterns: [
      /\bjavascript\b/i, /\bjs\b/i, /\bnode(?:\.js)?\b/i, /\breact\b/i,
      /\btypescript\b/i, /\bts\b/i, /\bexpress(?:\.js)?\b/i, /\bvue\b/i,
    ],
  },
  {
    lang: 'cpp',
    patterns: [
      /(?:^|\W)c\+\+(?!\w)/i, /\bcpp\b/i, /\bcplusplus\b/i, /\bpointers and memory\b/i, /\bclang\b/i,
    ],
  },
  {
    lang: 'java',
    patterns: [
      /\bjava\b/i, /\bspring boot\b/i, /\bjvm\b/i,
    ],
  },
];

const NON_CODE_DOMAINS = [
  /\b(spanish|french|german|japanese|mandarin|chinese|italian|korean|russian|arabic|latin)\b/i,
  /\b(grammar|vocabulary|pronunciation|conversational?|fluency|conjugation)\b/i,
  /\b(history|literature|philosophy|psychology|sociology)\b/i,
  /\b(creative writing|storytelling|journalism|essay)\b/i,
  /\b(project management|scrum|agile|leadership|public speaking|negotiation|sales)\b/i,
  /\b(cooking|drawing|painting|photography|music theory|guitar|piano)\b/i,
];

const GENERIC_CODE_PATTERNS = [
  /\b(programming|code|coding|software development|algorithms?|data structures?)\b/i,
  /\b(functions?|arrays?|variables?|loops?|recursion|sorting|binary search)\b/i,
  /\b(debugging|unit tests?|api development|backend|frontend)\b/i,
];

export function detectCodeTopic(
  topic: string,
  goalTitle: string = '',
  goalMotivation: string = '',
): TopicDetectionResult {
  const combinedText = `${topic} ${goalTitle} ${goalMotivation}`.toLowerCase();

  // 1. If explicit non-code subject is prominent without programming keywords
  const isNonCodeDomain = NON_CODE_DOMAINS.some((pattern) => pattern.test(combinedText));
  const hasSpecificCodeKeyword = LANGUAGE_PATTERNS.some(({ patterns }) =>
    patterns.some((pattern) => pattern.test(combinedText))
  );

  if (isNonCodeDomain && !hasSpecificCodeKeyword) {
    return { isCodeTopic: false, confidence: 'high' };
  }

  // 2. Check for specific programming languages
  for (const { lang, patterns } of LANGUAGE_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(combinedText))) {
      return {
        isCodeTopic: true,
        language: lang,
        confidence: 'high',
      };
    }
  }

  // 3. Check for generic code / algorithm terms (default to Python as the most common educational language)
  if (GENERIC_CODE_PATTERNS.some((pattern) => pattern.test(combinedText))) {
    return {
      isCodeTopic: true,
      language: 'python',
      confidence: 'medium',
    };
  }

  // 4. By default, topics are not assumed to be executable code
  return { isCodeTopic: false, confidence: 'low' };
}
