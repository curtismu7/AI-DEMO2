/**
 * Code Search Routes Tests
 * Tests for /api/code-search/index and /api/code-search/search endpoints
 */

'use strict';

const request = require('supertest');
const express = require('express');

// Create mock instance before the router requires it
const mockIndex = jest.fn();
const mockSearch = jest.fn();
const mockClientInstance = {
  index: mockIndex,
  search: mockSearch,
};

// Mock the MCP client class before requiring the router
jest.mock('../../services/mcpCodeSearchClient', () => {
  return jest.fn(() => mockClientInstance);
});

// Require the router ONCE so it binds to the mocked client
const codeSearchRouter = require('../../../routes/codeSearch');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/code-search', codeSearchRouter);
  return app;
}

describe('Code Search Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIndex.mockReset();
    mockSearch.mockReset();
  });

  describe('POST /index', () => {
    test('successfully indexes files and returns codebase_id', async () => {
      mockIndex.mockResolvedValueOnce({
        codebase_id: 'test-codebase-123',
        files_indexed: 2,
        chunks_created: 15,
      });

      const response = await request(buildApp())
        .post('/api/code-search/index')
        .field('codebase_name', 'my-project')
        .attach('file', Buffer.from('function hello() { return "world"; }'), 'hello.js')
        .attach('file', Buffer.from('const x = 42;'), 'constants.js')
        .expect(200);

      expect(response.body).toEqual({
        codebase_id: 'test-codebase-123',
        files_indexed: 2,
        chunks_created: 15,
      });

      expect(mockIndex).toHaveBeenCalledWith(
        expect.objectContaining({
          codebase_name: 'my-project',
          files: expect.arrayContaining([
            expect.objectContaining({
              path: 'hello.js',
            }),
            expect.objectContaining({
              path: 'constants.js',
            }),
          ]),
        })
      );
    });

    test('returns 400 when codebase_name is missing', async () => {
      const response = await request(buildApp())
        .post('/api/code-search/index')
        .attach('file', Buffer.from('code'), 'file.js')
        .expect(400);

      expect(response.body.error).toBe('missing_codebase_name');
      expect(mockIndex).not.toHaveBeenCalled();
    });

    test('returns 400 when no files are provided', async () => {
      const response = await request(buildApp())
        .post('/api/code-search/index')
        .field('codebase_name', 'my-project')
        .expect(400);

      expect(response.body.error).toBe('no_files');
      expect(mockIndex).not.toHaveBeenCalled();
    });

    test('returns 503 when MCP server is unavailable', async () => {
      mockIndex.mockRejectedValueOnce(
        new Error('MCP server unavailable (code search service not ready)')
      );

      const response = await request(buildApp())
        .post('/api/code-search/index')
        .field('codebase_name', 'my-project')
        .attach('file', Buffer.from('code'), 'file.js')
        .expect(503);

      expect(response.body.error).toBe('mcp_server_unavailable');
    });

    test('returns 500 on unexpected errors', async () => {
      mockIndex.mockRejectedValueOnce(
        new Error('Unexpected error during indexing')
      );

      const response = await request(buildApp())
        .post('/api/code-search/index')
        .field('codebase_name', 'my-project')
        .attach('file', Buffer.from('code'), 'file.js')
        .expect(500);

      expect(response.body.error).toBe('index_failed');
    });

    test('generates codebase_id if not provided', async () => {
      mockIndex.mockResolvedValueOnce({
        codebase_id: 'generated-id-123',
        files_indexed: 1,
        chunks_created: 5,
      });

      const response = await request(buildApp())
        .post('/api/code-search/index')
        .field('codebase_name', 'my-project')
        .attach('file', Buffer.from('code'), 'file.js')
        .expect(200);

      expect(response.body.codebase_id).toBe('generated-id-123');

      // Verify that the call was made with a generated ID
      expect(mockIndex).toHaveBeenCalledWith(
        expect.objectContaining({
          codebase_id: expect.any(String),
        })
      );
    });
  });

  describe('POST /search', () => {
    test('successfully searches and returns results', async () => {
      mockSearch.mockResolvedValueOnce({
        results: [
          {
            file: 'src/main.ts',
            line_start: 10,
            line_end: 15,
            relevance: 0.95,
            snippet: 'function main() { ... }',
          },
        ],
        query_time_ms: 42,
      });

      const response = await request(buildApp())
        .post('/api/code-search/search')
        .send({
          query: 'main function',
          codebase_id: 'test-codebase-123',
        })
        .expect(200);

      expect(response.body).toEqual({
        results: expect.arrayContaining([
          expect.objectContaining({
            file: 'src/main.ts',
            relevance: 0.95,
          }),
        ]),
        query_time_ms: 42,
      });

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'main function',
          codebase_id: 'test-codebase-123',
        })
      );
    });

    test('returns 400 when query is missing', async () => {
      const response = await request(buildApp())
        .post('/api/code-search/search')
        .send({
          codebase_id: 'test-codebase-123',
        })
        .expect(400);

      expect(response.body.error).toBe('missing_query');
      expect(mockSearch).not.toHaveBeenCalled();
    });

    test('returns 400 when codebase_id is missing', async () => {
      const response = await request(buildApp())
        .post('/api/code-search/search')
        .send({
          query: 'test query',
        })
        .expect(400);

      expect(response.body.error).toBe('missing_codebase_id');
      expect(mockSearch).not.toHaveBeenCalled();
    });

    test('returns 503 when MCP server is unavailable', async () => {
      mockSearch.mockRejectedValueOnce(
        new Error('MCP server unavailable (code search service not ready)')
      );

      const response = await request(buildApp())
        .post('/api/code-search/search')
        .send({
          query: 'test',
          codebase_id: 'test-codebase-123',
        })
        .expect(503);

      expect(response.body.error).toBe('mcp_server_unavailable');
    });

    test('returns 500 on unexpected errors', async () => {
      mockSearch.mockRejectedValueOnce(
        new Error('Search failed unexpectedly')
      );

      const response = await request(buildApp())
        .post('/api/code-search/search')
        .send({
          query: 'test',
          codebase_id: 'test-codebase-123',
        })
        .expect(500);

      expect(response.body.error).toBe('search_failed');
    });

    test('uses default limit if not provided', async () => {
      mockSearch.mockResolvedValueOnce({
        results: [],
        query_time_ms: 10,
      });

      await request(buildApp())
        .post('/api/code-search/search')
        .send({
          query: 'test',
          codebase_id: 'test-codebase-123',
        })
        .expect(200);

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
        })
      );
    });

    test('accepts optional file_filter parameter', async () => {
      mockSearch.mockResolvedValueOnce({
        results: [],
        query_time_ms: 10,
      });

      await request(buildApp())
        .post('/api/code-search/search')
        .send({
          query: 'test',
          codebase_id: 'test-codebase-123',
          file_filter: '*.ts',
        })
        .expect(200);

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          file_filter: '*.ts',
        })
      );
    });
  });
});
