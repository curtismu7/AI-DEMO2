/**
 * HTTP client for calling the RAG Code Search MCP Server
 * Proxies requests from BFF routes to the MCP server running on port 8095
 */

'use strict';

const axios = require('axios');

/**
 * @typedef {Object} IndexRequest
 * @property {Array<{path: string, content: string}>} files - Array of files to index
 * @property {string} codebase_id - Unique identifier for the codebase
 * @property {string} codebase_name - Human-readable name for the codebase
 * @property {string} [chunk_strategy] - Strategy for chunking code (default: 'line-based')
 */

/**
 * @typedef {Object} IndexResponse
 * @property {string} codebase_id - Unique identifier for the indexed codebase
 * @property {number} files_indexed - Number of files that were indexed
 * @property {number} chunks_created - Number of chunks created from the files
 * @property {string[]} [errors] - Optional array of error messages
 */

/**
 * @typedef {Object} SearchRequest
 * @property {string} query - Search query string
 * @property {string} codebase_id - Codebase ID to search in
 * @property {number} [limit] - Maximum number of results (default: 10)
 * @property {string} [file_filter] - Optional file filter pattern
 */

/**
 * @typedef {Object} SearchResult
 * @property {string} file - Path to the file containing the result
 * @property {number} line_start - Starting line number
 * @property {number} line_end - Ending line number
 * @property {number} relevance - Relevance score (0-1)
 * @property {string} snippet - Code snippet from the result
 */

/**
 * @typedef {Object} SearchResponse
 * @property {SearchResult[]} results - Array of search results
 * @property {number} query_time_ms - Query execution time in milliseconds
 */

/**
 * HTTP client for the RAG Code Search MCP Server
 */
class MCPCodeSearchClient {
  /**
   * Creates a new MCPCodeSearchClient instance
   * @param {string} [mcpServerUrl='http://localhost:8095'] - URL of the MCP server
   */
  constructor(mcpServerUrl = 'http://localhost:8095') {
    this.mcpServerUrl = mcpServerUrl;
    this.client = axios.create({
      baseURL: this.mcpServerUrl,
      timeout: 30000,
    });
  }

  /**
   * Index files in the MCP server
   * @param {IndexRequest} request - The index request containing files and metadata
   * @returns {Promise<IndexResponse>} The index response with codebase info
   * @throws {Error} If indexing fails or server is unavailable
   */
  async index(request) {
    try {
      // Encode files to base64
      const encodedFiles = request.files.map((f) => ({
        path: f.path,
        content: Buffer.from(f.content).toString('base64'),
      }));

      const response = await this.client.post('/index', {
        files: encodedFiles,
        codebase_id: request.codebase_id,
        codebase_name: request.codebase_name,
        chunk_strategy: request.chunk_strategy || 'line-based',
      });

      return response.data;
    } catch (err) {
      if (err.response?.status === 503) {
        throw new Error('MCP server unavailable (code search service not ready)');
      }
      throw new Error(`Failed to index codebase: ${err.message}`);
    }
  }

  /**
   * Search the indexed codebase
   * @param {SearchRequest} request - The search request with query and filters
   * @returns {Promise<SearchResponse>} The search response with results
   * @throws {Error} If search fails or server is unavailable
   */
  async search(request) {
    try {
      const response = await this.client.post('/search', {
        query: request.query,
        codebase_id: request.codebase_id,
        limit: request.limit || 10,
        file_filter: request.file_filter,
      });

      return response.data;
    } catch (err) {
      if (err.response?.status === 503) {
        throw new Error('MCP server unavailable (code search service not ready)');
      }
      throw new Error(`Failed to search codebase: ${err.message}`);
    }
  }

  /**
   * List the codebases currently indexed in the vector store.
   * @returns {Promise<{codebases: Array<{id: string, name: string, chunks: number}>}>}
   * @throws {Error} If the request fails or the server is unavailable
   */
  async listCodebases() {
    try {
      const response = await this.client.get('/codebases');
      return response.data;
    } catch (err) {
      if (err.response?.status === 503) {
        throw new Error('MCP server unavailable (code search service not ready)');
      }
      throw new Error(`Failed to list codebases: ${err.message}`);
    }
  }
}

module.exports = MCPCodeSearchClient;
