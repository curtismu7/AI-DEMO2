'use strict';

/**
 * Tool registry for this resource server.
 *
 * index.ts used to hardcode INVEST_TOOLS/dispatchTool in six places; adding a
 * second namespace made that untenable. Everything the transport needs — the
 * catalog, the advertised scopes, and the dispatch — comes from here.
 */

import { McpToolDef } from './toolTypes';
import { INVEST_TOOLS } from './investTools';
import { AIRLINES_TOOLS } from './airlinesTools';
import { BANKING_TOOLS } from './bankingTools';
import { HEALTHCARE_TOOLS } from './healthcareTools';
import { GOVERNMENT_TOOLS } from './governmentTools';
import { MANUFACTURING_TOOLS } from './manufacturingTools';
import { RETAIL_TOOLS } from './retailTools';
import { SPORTING_GOODS_TOOLS } from './sportingGoodsTools';
import { UNIVERSITY_TOOLS } from './universityTools';
import { WORKFORCE_TOOLS } from './workforceTools';
import { ANF_TOOLS } from './anfTools';
import { dispatchTool as dispatchInvestTool } from './investToolHandler';
import { AIRLINES_TOOL_NAMES, dispatchAirlinesTool } from './airlinesToolHandler';
import { dispatchBankingTool } from './bankingToolHandler';
import { dispatchHealthcareTool } from './healthcareToolHandler';
import { dispatchGovernmentTool } from './governmentToolHandler';
import { dispatchManufacturingTool } from './manufacturingToolHandler';
import { dispatchRetailTool } from './retailToolHandler';
import { dispatchSportingGoodsTool } from './sportingGoodsToolHandler';
import { dispatchUniversityTool } from './universityToolHandler';
import { dispatchWorkforceTool } from './workforceToolHandler';
import { dispatchAnfTool } from './anfToolHandler';

export const ALL_TOOLS: McpToolDef[] = [
  ...INVEST_TOOLS,
  ...AIRLINES_TOOLS,
  ...BANKING_TOOLS,
  ...HEALTHCARE_TOOLS,
  ...GOVERNMENT_TOOLS,
  ...MANUFACTURING_TOOLS,
  ...RETAIL_TOOLS,
  ...SPORTING_GOODS_TOOLS,
  ...UNIVERSITY_TOOLS,
  ...WORKFORCE_TOOLS,
  ...ANF_TOOLS,
];

/**
 * Scopes advertised in the RFC 9728 metadata — derived from the catalog so a
 * client that reads it always requests a scope that actually unlocks a tool.
 */
export const SUPPORTED_SCOPES: string[] = [
  ...new Set(ALL_TOOLS.flatMap((t) => t.requiredScopes)),
];

export function findTool(toolName: string): McpToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === toolName);
}

const BANKING_TOOL_NAMES = new Set(BANKING_TOOLS.map((t) => t.name));
const HEALTHCARE_TOOL_NAMES = new Set(HEALTHCARE_TOOLS.map((t) => t.name));
const GOVERNMENT_TOOL_NAMES = new Set(GOVERNMENT_TOOLS.map((t) => t.name));
const MANUFACTURING_TOOL_NAMES = new Set(MANUFACTURING_TOOLS.map((t) => t.name));
const RETAIL_TOOL_NAMES = new Set(RETAIL_TOOLS.map((t) => t.name));
const SPORTING_GOODS_TOOL_NAMES = new Set(SPORTING_GOODS_TOOLS.map((t) => t.name));
const UNIVERSITY_TOOL_NAMES = new Set(UNIVERSITY_TOOLS.map((t) => t.name));
const WORKFORCE_TOOL_NAMES = new Set(WORKFORCE_TOOLS.map((t) => t.name));
const ANF_TOOL_NAMES = new Set(ANF_TOOLS.map((t) => t.name));

export function dispatch(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
  subject: string,
): Promise<unknown> {
  if (AIRLINES_TOOL_NAMES.has(toolName)) return dispatchAirlinesTool(toolName, args, subject);
  if (BANKING_TOOL_NAMES.has(toolName)) return dispatchBankingTool(toolName, args, subject);
  if (HEALTHCARE_TOOL_NAMES.has(toolName)) return dispatchHealthcareTool(toolName, args);
  if (GOVERNMENT_TOOL_NAMES.has(toolName)) return dispatchGovernmentTool(toolName, args);
  if (MANUFACTURING_TOOL_NAMES.has(toolName)) return dispatchManufacturingTool(toolName, args);
  if (RETAIL_TOOL_NAMES.has(toolName)) return dispatchRetailTool(toolName, args);
  if (SPORTING_GOODS_TOOL_NAMES.has(toolName)) return dispatchSportingGoodsTool(toolName, args);
  if (UNIVERSITY_TOOL_NAMES.has(toolName)) return dispatchUniversityTool(toolName, args);
  if (WORKFORCE_TOOL_NAMES.has(toolName)) return dispatchWorkforceTool(toolName, args);
  if (ANF_TOOL_NAMES.has(toolName)) return dispatchAnfTool(toolName, args);
  return dispatchInvestTool(toolName, args, token, subject);
}
