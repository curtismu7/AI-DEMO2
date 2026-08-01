import axios from 'axios';
import { decodeJWT } from './tokenInspector';

class ExecutionEngine {
  constructor(flowSpec, bffBaseUrl = 'https://api.ping.demo:3001') {
    this.flowSpec = flowSpec;
    this.bffBaseUrl = bffBaseUrl;
    this.state = {
      currentStep: null,
      results: [],
      error: null,
      context: {}
    };
    this.client = axios.create({
      baseURL: bffBaseUrl,
      timeout: 10000,
      withCredentials: true,
    });
  }

  /**
   * Interpolate :param placeholders in a URL using accumulated response context.
   */
  _interpolateUrl(url) {
    return url.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, key) => {
      const val = this.state.context[key];
      return val != null ? encodeURIComponent(val) : match;
    });
  }

  /**
   * Execute a single step by ID
   * @param {string} stepId - The ID of the step to execute
   * @returns {Promise<Object>} Result object with request, response, decodedToken
   */
  async executeStep(stepId) {
    try {
      // Find step in flow spec
      const step = this.flowSpec.steps.find(s => s.id === stepId);
      if (!step) {
        throw new Error(`Step ${stepId} not found in flow spec`);
      }

      this.state.currentStep = stepId;
      this.state.error = null;

      // Build request — interpolate path params from prior responses
      const method = (step.method || 'GET').toUpperCase();
      const url = this._interpolateUrl(step.endpoint || step.url);
      const data = step.body || null;

      // Prepare request config
      const config = {
        method,
        url,
        headers: {
          ...step.headers,
          ...(step.authToken && { Authorization: `Bearer ${step.authToken}` })
        }
      };

      // Execute request
      let response;
      try {
        if (method === 'GET' || method === 'DELETE') {
          response = await this.client[method.toLowerCase()](url, config);
        } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
          response = await this.client[method.toLowerCase()](url, data, config);
        } else {
          throw new Error(`Unsupported HTTP method: ${method}`);
        }
      } catch (error) {
        // Capture error response if available
        if (error.response) {
          response = error.response;
        } else {
          throw error;
        }
      }

      // Decode token from response if present
      let decodedToken = null;
      if (response.data?.token) {
        decodedToken = decodeJWT(response.data.token);
      } else if (response.headers?.authorization) {
        const bearerMatch = response.headers.authorization.match(/Bearer\s+(.+)/);
        if (bearerMatch) {
          decodedToken = decodeJWT(bearerMatch[1]);
        }
      }

      // Record result
      const result = {
        stepId,
        timestamp: new Date().toISOString(),
        request: {
          method,
          url,
          headers: config.headers,
          body: data
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.data
        },
        decodedToken
      };

      this.state.results.push(result);

      // Capture mapped response fields into context for downstream steps
      if (step.responseMap && response.data) {
        for (const [contextKey, responseKey] of Object.entries(step.responseMap)) {
          if (response.data[responseKey] != null) {
            this.state.context[contextKey] = response.data[responseKey];
          }
        }
      }

      return result;
    } catch (err) {
      this.state.error = {
        stepId,
        message: err.message,
        timestamp: new Date().toISOString()
      };
      throw err;
    }
  }

  /**
   * Execute all steps in the flow sequentially
   * @returns {Promise<Array>} Array of results, one per step
   */
  async executeAll() {
    const results = [];

    if (!this.flowSpec || !this.flowSpec.steps || this.flowSpec.steps.length === 0) {
      throw new Error('Invalid flow spec: no steps defined');
    }

    for (const step of this.flowSpec.steps) {
      try {
        const result = await this.executeStep(step.id);
        results.push(result);
      } catch (err) {
        // Continue or stop based on flow configuration
        if (this.flowSpec.stopOnError) {
          throw err;
        }
        // Record failure but continue — state carries it so the activity log
        // shows failed steps instead of silently skipping them.
        const failure = {
          stepId: step.id,
          error: err.message,
          timestamp: new Date().toISOString()
        };
        this.state.results.push(failure);
        results.push(failure);
      }
    }

    return results;
  }

  /**
   * Reset the execution state
   */
  reset() {
    this.state = {
      currentStep: null,
      results: [],
      error: null,
      context: {}
    };
  }

  /**
   * Get the current state
   * @returns {Object} Current execution state
   */
  getState() {
    return {
      ...this.state,
      // Deep copy results to prevent external mutation
      results: JSON.parse(JSON.stringify(this.state.results))
    };
  }

  /**
   * Get a specific result by step ID
   * @param {string} stepId - The step ID to retrieve
   * @returns {Object|null} The result object or null if not found
   */
  getResult(stepId) {
    return this.state.results.find(r => r.stepId === stepId) || null;
  }
}

export default ExecutionEngine;
