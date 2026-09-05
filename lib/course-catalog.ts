import type { LearningGoal } from '../shared/contracts';

export type CourseCategory = 'Languages' | 'Coding' | 'Math' | 'Science';

export type CourseTemplate = {
  id: string;
  title: string;
  category: CourseCategory;
  icon: string;
  level: string;
  duration: string;
  lessons: number;
  color: string;
  image: string;
  description: string;
  motivation: string;
  targetOutcome: string;
};

export const COURSE_TEMPLATES: CourseTemplate[] = [
  {
    id: 'japanese', title: 'Japanese', category: 'Languages', icon: '🇯🇵', level: 'Intermediate', duration: '6 months', lessons: 148, color: '#e8402a',
    image: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=900&h=480&fit=crop&auto=format',
    description: 'Master everyday conversation for travel in Japan. Covers hiragana, katakana, kanji basics, and essential travel phrases.',
    motivation: 'Travel conversation, hiragana, katakana, kanji basics, and essential phrases.', targetOutcome: 'Hold a confident everyday conversation while travelling in Japan.',
  },
  {
    id: 'french', title: 'French', category: 'Languages', icon: '🇫🇷', level: 'Advanced', duration: '8 months', lessons: 210, color: '#0055a4',
    image: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=900&h=480&fit=crop&auto=format',
    description: 'DELF-targeted French from B1 to B2, with rigorous grammar, rich vocabulary, and authentic texts.',
    motivation: 'DELF-focused grammar, vocabulary, reading, and practical conversation.', targetOutcome: 'Build the language range and confidence needed for B2-level communication.',
  },
  {
    id: 'spanish', title: 'Spanish', category: 'Languages', icon: '🇪🇸', level: 'Beginner', duration: '5 months', lessons: 120, color: '#c60b1e',
    image: 'https://images.unsplash.com/photo-1543783207-ec64e4d95325?w=900&h=480&fit=crop&auto=format',
    description: 'Start from zero and hold a basic conversation in Spanish for travel in Spain and Latin America.',
    motivation: 'Foundational vocabulary, pronunciation, daily phrases, and travel conversation.', targetOutcome: 'Handle simple everyday conversations in Spanish with confidence.',
  },
  {
    id: 'python', title: 'Python', category: 'Coding', icon: '🐍', level: 'Beginner', duration: '3 months', lessons: 85, color: '#3572a5',
    image: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=900&h=480&fit=crop&auto=format',
    description: 'Learn Python from scratch through hands-on projects covering functions, data structures, files, and APIs.',
    motivation: 'Python fundamentals, functions, data structures, files, and APIs.', targetOutcome: 'Build and explain a small useful Python project from scratch.',
  },
  {
    id: 'typescript', title: 'TypeScript', category: 'Coding', icon: 'TS', level: 'Intermediate', duration: '2 months', lessons: 60, color: '#3178c6',
    image: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=900&h=480&fit=crop&auto=format',
    description: 'Add types to JavaScript and build safer applications with practical TypeScript patterns.',
    motivation: 'Type modelling, narrowing, generics, and safer application architecture.', targetOutcome: 'Use TypeScript confidently in a production-style JavaScript project.',
  },
  {
    id: 'calculus', title: 'Calculus I', category: 'Math', icon: '∫', level: 'Beginner', duration: '4 months', lessons: 96, color: '#7c3aed',
    image: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=900&h=480&fit=crop&auto=format',
    description: 'Learn limits, derivatives, and integrals from first principles with clear worked examples.',
    motivation: 'Limits, continuity, derivatives, integrals, and mathematical reasoning.', targetOutcome: 'Solve foundational Calculus I problems and explain the reasoning behind them.',
  },
  {
    id: 'italian', title: 'Italian', category: 'Languages', icon: '🇮🇹', level: 'Beginner', duration: '5 months', lessons: 110, color: '#009246',
    image: 'https://images.unsplash.com/photo-1499678329028-101435549a4e?w=900&h=480&fit=crop&auto=format',
    description: 'Build a practical foundation for travelling in Italy through daily phrases, food culture, and city navigation.',
    motivation: 'Travel phrases, pronunciation, food culture, and navigating Italian cities.', targetOutcome: 'Communicate comfortably in common travel situations in Italy.',
  },
  {
    id: 'linear-algebra', title: 'Linear Algebra', category: 'Math', icon: 'λ', level: 'Intermediate', duration: '3 months', lessons: 72, color: '#0891b2',
    image: 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=900&h=480&fit=crop&auto=format',
    description: 'Study vectors, matrices, and transformations—the foundations of machine learning, graphics, and data science.',
    motivation: 'Vectors, matrices, transformations, and applications to computing.', targetOutcome: 'Use linear algebra concepts to reason about data and simple models.',
  },
];

export const courseTemplate = (id?: string) => COURSE_TEMPLATES.find((course) => course.id === id);

export const courseTemplateForGoal = (goal: Pick<LearningGoal, 'courseTemplateId' | 'title'>) => {
  const savedTemplate = courseTemplate(goal.courseTemplateId);
  if (savedTemplate) return savedTemplate;
  const title = goal.title.toLocaleLowerCase();
  return COURSE_TEMPLATES.find((template) => title.includes(template.title.toLocaleLowerCase()));
};

const customCourseFallbacks = [
  { terms: ['english', 'language', 'writing', 'literature', 'communication'], image: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=900&h=480&fit=crop&auto=format' },
  { terms: ['architecture', 'building', 'interior', 'design'], image: 'https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=900&h=480&fit=crop&auto=format' },
  { terms: ['science', 'biology', 'chemistry', 'physics'], image: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=900&h=480&fit=crop&auto=format' },
  { terms: ['history', 'art', 'culture'], image: 'https://images.unsplash.com/photo-1564399579883-451a5d44ec08?w=900&h=480&fit=crop&auto=format' },
];

export const customCourseFallbackImage = (title: string) => {
  const normalizedTitle = title.toLocaleLowerCase();
  return customCourseFallbacks.find(({ terms }) => terms.some((term) => normalizedTitle.includes(term)))?.image;
};
