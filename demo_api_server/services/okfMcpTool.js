/**
 * OKF MCP Tool — get_okf_assertions
 *
 * Exposes OKF knowledge bundles to MCP-connected coding agents (Claude Code,
 * LlamaIndex, Cursor, etc.) via the Model Context Protocol tool interface.
 *
 * Follows the pattern of existing MCP tools in this repo (code_search, get_code,
 * list_codebases) — a tool definition object + a handler function.
 *
 * Registration:
 *   const { toolDefinition, handler } = require('./okfMcpTool');
 *   mcpServer.addTool(toolDefinition, handler);
 */

const okfLoader = require('./okfLoaderService');

// ---------------------------------------------------------------------------
// Tool Definition (MCP schema)
// ---------------------------------------------------------------------------

const toolDefinition = {
  name: 'get_okf_assertions',
  description:
    'Retrieves deterministic knowledge assertions from OKF bundles. ' +
    'Use this to get authoritative facts about the codebase architecture ' +
    '(domain: "repo-topology") or banking domain policies (domain: "banking-domain"). ' +
    'Returns structured assertions with claims, sources, and citation references.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description:
          'The domain slug to query. Available domains: "repo-topology" (codebase architecture), ' +
          '"banking-domain" (banking policies and definitions). Use "list" to see all available domains.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional tag filter (OR logic). Only assertions matching at least one tag are returned. ' +
          'Examples: ["feature-flags", "auth"], ["agents", "prompt-assembly"], ["fraud", "policy"].',
      },
      id: {
        type: 'string',
        description:
          'Optional specific assertion ID to retrieve (e.g., "K1", "K13"). Returns only that assertion.',
      },
      format: {
        type: 'string',
        enum: ['structured', 'prompt', 'summary'],
        description:
          'Output format. "structured" (default): full assertion objects. ' +
          '"prompt": formatted for LLM system prompt injection. ' +
          '"summary": one-line-per-assertion overview.',
      },
    },
    required: ['domain'],
  },
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * MCP tool handler for get_okf_assertions.
 *
 * @param {object} params - Tool input parameters
 * @param {string} params.domain - Domain slug or "list"
 * @param {string[]} [params.tags] - Optional tag filter
 * @param {string} [params.id] - Optional specific assertion ID
 * @param {string} [params.format] - Output format
 * @returns {object} MCP tool response
 */
async function handler(params) {
  // Ensure loader is initialized
  if (!okfLoader.isInitialized()) {
    const initResult = okfLoader.initialize();
    if (initResult.loaded === 0 && initResult.errors.length > 0) {
      return formatError(
        'OKF loader failed to initialize: ' + initResult.errors.join('; ')
      );
    }
  }

  const { domain, tags, id, format = 'structured' } = params;

  // Special case: list available domains
  if (domain === 'list') {
    return formatListDomains();
  }

  // Validate domain exists
  const domains = okfLoader.listDomains();
  if (!domains.includes(domain)) {
    return formatError(
      `Domain "${domain}" not found. Available domains: ${domains.join(', ')}. ` +
      'Use domain: "list" to see all domains with metadata.'
    );
  }

  // Single assertion by ID
  if (id) {
    return formatSingleAssertion(domain, id);
  }

  // Get assertions with optional tag filter
  const opts = {};
  if (tags && tags.length > 0) {
    opts.tags = tags;
  }

  const assertions = okfLoader.getAssertions(domain, opts);
  const meta = okfLoader.getBundleMeta(domain);

  // Format output based on requested format
  switch (format) {
    case 'prompt':
      return formatAsPrompt(domain, opts);
    case 'summary':
      return formatAsSummary(domain, assertions, meta);
    case 'structured':
    default:
      return formatAsStructured(domain, assertions, meta, opts);
  }
}

// ---------------------------------------------------------------------------
// Output Formatters
// ---------------------------------------------------------------------------

function formatListDomains() {
  const domains = okfLoader.listDomains();
  const domainDetails = domains.map(d => {
    const meta = okfLoader.getBundleMeta(d);
    return {
      domain: d,
      title: meta.title,
      version: meta.version,
      assertionCount: meta.assertionCount,
      description: meta.description,
    };
  });

  // Derive tag examples dynamically from loaded assertions
  const tagExamples = {};
  domains.forEach(d => {
    const assertions = okfLoader.getAssertions(d);
    const tags = new Set(assertions.flatMap(a => a.tags || []));
    tagExamples[d] = Array.from(tags).slice(0, 8);
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            availableDomains: domainDetails,
            usage: 'Call get_okf_assertions with domain set to one of the domain slugs above.',
            tagExamples,
          },
          null,
          2
        ),
      },
    ],
  };
}

function formatSingleAssertion(domain, id) {
  const assertions = okfLoader.getAssertions(domain);
  const assertion = assertions.find(a => a.id === id);

  if (!assertion) {
    const available = assertions.map(a => a.id).join(', ');
    return formatError(
      `Assertion "${id}" not found in domain "${domain}". Available IDs: ${available}`
    );
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            domain,
            assertion,
            citationFormat: `Reference as [${id}] when citing this assertion.`,
          },
          null,
          2
        ),
      },
    ],
  };
}

function formatAsStructured(domain, assertions, meta, opts) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            domain,
            version: meta.version,
            title: meta.title,
            totalAssertions: meta.assertionCount,
            returnedAssertions: assertions.length,
            filtered: !!(opts.tags && opts.tags.length > 0),
            filterTags: opts.tags || null,
            assertions,
            usage:
              'These are deterministic facts. Cite as [K1], [K2], etc. ' +
              'Do not contradict these assertions — they are ground truth.',
          },
          null,
          2
        ),
      },
    ],
  };
}

function formatAsPrompt(domain, opts) {
  const promptBlock = okfLoader.formatForPrompt(domain, opts);

  if (!promptBlock) {
    return formatError(`No assertions found for domain "${domain}" with the given filters.`);
  }

  return {
    content: [
      {
        type: 'text',
        text: promptBlock,
      },
    ],
  };
}

function formatAsSummary(domain, assertions, meta) {
  const lines = [
    `# ${meta.title} (v${meta.version})`,
    `Domain: ${domain} | Assertions: ${assertions.length}`,
    '',
    ...assertions.map(a => `[${a.id}] ${a.claim.slice(0, 120)}${a.claim.length > 120 ? '...' : ''}`),
    '',
    'Use format:"structured" or id:"K1" for full details.',
  ];

  return {
    content: [
      {
        type: 'text',
        text: lines.join('\n'),
      },
    ],
  };
}

function formatError(message) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: message }, null, 2),
      },
    ],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  toolDefinition,
  handler,
  // Exported for testing
  _formatListDomains: formatListDomains,
  _formatSingleAssertion: formatSingleAssertion,
  _formatAsStructured: formatAsStructured,
  _formatAsPrompt: formatAsPrompt,
  _formatAsSummary: formatAsSummary,
  _formatError: formatError,
};
