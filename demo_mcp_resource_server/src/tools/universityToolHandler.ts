'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('university') as {
  courses: Array<{ id: string; [k: string]: unknown }>;
  enrollmentHistory: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchUniversityTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_courses':
      return { courses: data.courses, count: data.courses.length };
    case 'get_course': {
      const id = args.course_id as string;
      const course = data.courses.find((c) => c.id === id);
      if (!course) return { found: false, course_id: id };
      return { found: true, course };
    }
    default:
      throw new Error(`Unknown university tool: ${toolName}`);
  }
}
