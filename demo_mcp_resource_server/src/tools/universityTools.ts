'use strict';
import { McpToolDef } from './toolTypes';
import { dispatchUniversityTool } from './universityToolHandler';

export const UNIVERSITY_TOOLS: McpToolDef[] = [
  {
    // Named to match scope-topology.json's tools.view_courses entry
    // (requiredScopes ["read"]) — same pattern as healthcare's view_records.
    name: 'view_courses',
    description: 'List all courses for the authenticated student, including title, type, credits, and grade.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['read'],
    readOnly: true,
    intentHints: [
      'show my courses',
      'list my classes',
      'what courses am I taking',
      'my enrolled courses',
      'show my grades',
    ],
  },
  {
    name: 'get_course',
    description: 'Get a single course by ID with full course details including credits and grade.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'string', description: 'Course ID' },
      },
      required: ['course_id'],
    },
    requiredScopes: ['university:read'],
    readOnly: true,
    intentHints: ['get course details', 'show course info', 'check my grade'],
  },
];

export { dispatchUniversityTool };
