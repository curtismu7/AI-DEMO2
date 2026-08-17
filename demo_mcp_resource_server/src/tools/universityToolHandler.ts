'use strict';
import { getCourse, listCourses } from '../db/universityDb';

export async function dispatchUniversityTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'view_courses': {
      const courses = listCourses();
      return { courses, count: courses.length, render: 'view_courses' };
    }
    case 'get_course': {
      const id = args.course_id as string;
      const course = getCourse(id);
      if (!course) return { found: false, course_id: id };
      return { found: true, course };
    }
    default:
      throw new Error(`Unknown university tool: ${toolName}`);
  }
}
