#!/usr/bin/env node

/**
 * OFFX MCP Server
 * 
 * This server provides a bridge between the Model Context Protocol (MCP) and the OFFX (Target Safety) API.
 * It supports both MCP server mode (with stdio or SSE transport) and HTTP server mode for flexible integration.
 * 
 * Environment Variables:
 * - OFFX_API_TOKEN: Required. API token for OFFX API authentication
 * - USE_HTTP: Optional. Set to 'true' to run as HTTP server (default: false)
 * - PORT: Optional. Port number for HTTP server (default: 3000)
 * - LOG_LEVEL: Optional. Logging level (default: 'info')
 * - TRANSPORT: Optional. MCP transport type ('stdio' or 'sse', default: 'stdio')
 * - SSE_PATH: Optional. Path for SSE endpoint when using SSE transport (default: '/mcp')
 *
 * # OFFX MCP Server - README
 *
 * This server exposes the following OFFX tools via MCP:
 *
 * ## Tools
 *
 * - search_drugs: Search for adverse events for a drug by drug_id
 *   - Input: { drug_id: string }
 *
 * - get_drug_alerts: Retrieve alerts for a drug by drug_id (with optional filters)
 *   - Input: {
 *       drug_id: string,
 *       page?: number,
 *       adverse_event_id?: string,
 *       ref_source_type?: string,
 *       alert_type?: string,
 *       alert_phase?: string,
 *       alert_level_evidence?: string,
 *       alert_severity?: string,
 *       alert_causality?: string,
 *       alert_species?: string,
 *       alert_date_from?: string,
 *       alert_date_to?: string,
 *       order_by_date?: string,
 *       order_by_adv?: string
 *     }
 *
 * - get_drugs_by_action: Retrieve drugs by target and action ID
 *   - Input: { target_id: string, action_id: string }
 *
 * - get_drugs_by_adve: Retrieve drugs by adverse event ID
 *   - Input: { adverse_event_id: string, page?: number }
 *
 * - search_drugs_by_name: Search for drugs by drug name
 *   - Input: { drug: string }
 *
 * - get_drug_score: Get drug score by drug id (and optionally adverse event id)
 *   - Input: { drug_id: string, adverse_event_id?: string }
 *
 * - search_adverse_events: Search adverse events by adverse event name
 *   - Input: { adverse_event: string }
 *
 * - get_adverse_events: Get adverse events by drug id
 *   - Input: { drug_id: string }
 *
 * - get_adverse_events_by_target: Get adverse events by target id
 *   - Input: { target_id: string }
 *
 * - get_drug: Get drug masterview by drug id using the OFFX API. Supports optional filters.
 *   - Input: {
 *       drug_id: string,
 *       page: number,
 *       adverse_event_id?: string,
 *       ref_source_type?: string,
 *       alert_type?: string,
 *       alert_phase?: string,
 *       alert_level_evidence?: string,
 *       alert_severity?: string,
 *       alert_causality?: string,
 *       alert_species?: string,
 *       alert_date_from?: string,
 *       alert_date_to?: string
 *     }
 *
 * - search_targets: Search targets by target name
 *   - Input: { target: string }
 *
 * - get_target: Get target masterview by target_id and action_id using the OFFX API. Supports optional filters.
 *   - Input: {
 *       target_id: string,
 *       action_id: string,
 *       page: number,
 *       adverse_event_id?: string,
 *       ref_source_type?: string,
 *       alert_type?: string,
 *       alert_phase?: string,
 *       alert_level_evidence?: string,
 *       alert_onoff_target?: string,
 *       alert_severity?: string,
 *       alert_causality?: string,
 *       alert_species?: string,
 *       alert_date_from?: string,
 *       alert_date_to?: string
 *     }
 *
 * - get_targets: Get primary or secondary targets for a drug by drug_id, or targets by adverse_event_id, using the OFFX API.
 *   - Input: { drug_id?: string, type?: 'primary' | 'secondary', adverse_event_id?: string }
 *
 * ## Usage
 *
 * - MCP mode: Communicate via stdio (default) or SSE (experimental)
 * - HTTP mode: POST to /search_drugs (other endpoints not yet implemented for HTTP)
 *
 * ## Example
 *
 *   {
 *     "tool": "get_drug_alerts",
 *     "arguments": { "drug_id": "140448", "alert_type": "serious" }
 *   }
 *
 * See the tool schemas in the code for full details and examples.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { createError, JsonValue } from "./util.js";
import fetchModule from 'node-fetch';
const fetch = (globalThis.fetch || (fetchModule as any).default || fetchModule) as typeof globalThis.fetch;
import 'dotenv/config';
import http from 'http';

/**
 * Logging utility for consistent log format across the application
 * Supports different log levels and structured logging
 */
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const logger = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  } as const,
  level: (process.env.LOG_LEVEL || 'info') as LogLevel,
  
  formatMessage: (level: string, message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  },

  error: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.error) {
      console.error(logger.formatMessage('error', message, meta));
    }
  },

  warn: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.warn) {
      console.warn(logger.formatMessage('warn', message, meta));
    }
  },

  info: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.info) {
      console.log(logger.formatMessage('info', message, meta));
    }
  },

  debug: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.debug) {
      console.debug(logger.formatMessage('debug', message, meta));
    }
  }
};

/**
 * Type definitions for schema properties and parameters
 */
interface SchemaProperty {
  type: string;
  description: string;
  enum?: string[];
  enumDescriptions?: { [key: string]: string };
  examples?: string[];
  format?: string;
  notes?: string;
}

// API configuration and environment variables
const USE_HTTP = process.env.USE_HTTP === 'true';
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const TRANSPORT = process.env.TRANSPORT || 'stdio';
const SSE_PATH = process.env.SSE_PATH || '/mcp';
const OFFX_API_TOKEN = process.env.OFFX_API_TOKEN || '';

// Validate required environment variables
if (!OFFX_API_TOKEN) {
  console.error('Missing required environment variable: OFFX_API_TOKEN');
  process.exit(1);
}

// Validate transport configuration
if (TRANSPORT !== 'stdio') {
  logger.warn("SSE transport is temporarily disabled. Defaulting to stdio transport.", {
    requested_transport: TRANSPORT
  });
}

// Tool definition for OFFX search_drugs
const SEARCH_DRUGS_TOOL = {
  name: 'search_drugs',
  description: 'Search drugs by name using the OFFX API.',
  inputSchema: {
    type: 'object',
    properties: {
      drug: { type: 'string', description: 'Drug name (required)' }
    },
    required: ['drug']
  },
  examples: [
    {
      description: 'Search for drugs by name',
      usage: '{ "drug": "everolimus" }'
    }
  ]
};

// Tool definition for OFFX get_drugs
const GET_DRUGS_TOOL = {
  name: 'get_drugs',
  description: 'Get drugs by target_id, action_id, or adverse_event_id (provide exactly one) using the OFFX API.',
  inputSchema: {
    type: 'object',
    properties: {
      target_id: { type: 'string', description: 'Target identifier (OFFX target_id, optional)' },
      action_id: { type: 'string', description: 'Action identifier (OFFX action_id, optional)' },
      adverse_event_id: { type: 'string', description: 'Adverse event identifier (OFFX adverse_event_id, optional)' },
      page: { type: 'number', description: 'Page number (default: 1, optional)' }
    },
    anyOf: [
      { required: ['target_id'] },
      { required: ['action_id'] },
      { required: ['adverse_event_id'] }
    ]
        },
        examples: [
    {
      description: 'Get drugs by target id',
      usage: '{ "target_id": "123" }'
    },
    {
      description: 'Get drugs by action id',
      usage: '{ "action_id": "456" }'
    },
    {
      description: 'Get drugs by adverse event id',
      usage: '{ "adverse_event_id": "10001551" }'
    }
  ]
};

// Tool definition for OFFX get_alerts (merged drug/target alerts)
const GET_ALERTS_TOOL = {
  name: 'get_alerts',
  description: 'Get alerts for a drug (by drug_id) or a target (by target_id) using the OFFX API. Supports optional filters.',
  inputSchema: {
    type: 'object',
    properties: {
      drug_id: { type: 'string', description: 'Drug identifier (OFFX drug_id, optional)' },
      target_id: { type: 'string', description: 'Target identifier (OFFX target_id, optional)' },
      action_id: { type: 'string', description: 'Action ID (optional, for target alerts)' },
      page: { type: 'number', description: 'Page number (required)' },
      adverse_event_id: { type: 'string', description: 'Adverse Event ID (optional)' },
      ref_source_type: { type: 'string', description: 'Reference source type (optional)' },
      alert_type: { type: 'string', description: 'Alert Type (optional)' },
      alert_phase: { type: 'string', description: 'Alert Phase (optional)' },
      alert_level_evidence: { type: 'string', description: 'Level of evidence (optional)' },
      alert_onoff_target: { type: 'string', description: 'On/Off target (optional, for target alerts)' },
      alert_severity: { type: 'string', description: 'Alert Severity (optional)' },
      alert_causality: { type: 'string', description: 'Alert Causality (optional)' },
      alert_species: { type: 'string', description: 'Alert Species (optional)' },
      alert_date_from: { type: 'string', description: 'Date from (optional, YYYY-MM-DD)' },
      alert_date_to: { type: 'string', description: 'Date to (optional, YYYY-MM-DD)' },
      order_by_date: { type: 'string', description: 'Order by date (optional)' },
      order_by_adv: { type: 'string', description: 'Order by adverse event (optional)' }
    },
    anyOf: [
      { required: ['drug_id', 'page'] },
      { required: ['target_id', 'page'] }
    ]
  },
  examples: [
    {
      description: 'Get alerts for a drug',
      usage: '{ "drug_id": "11204", "page": 1 }'
    },
    {
      description: 'Get alerts for a target',
      usage: '{ "target_id": "158", "page": 1 }'
    },
    {
      description: 'Get alerts for a target with filters',
      usage: '{ "target_id": "158", "page": 2, "alert_type": "serious" }'
    }
  ]
};

// Tool definition for OFFX get_score
const GET_SCORE_TOOL = {
  name: 'get_score',
  description: 'Get drug_score by drug_id (and optionally adverse_event_id) or get target/class score by target_id and action_id (and optionally adverse_event_id) using the OFFX API.',
  inputSchema: {
    type: 'object',
    properties: {
      drug_id: { type: 'string', description: 'Drug identifier (OFFX drug_id, required for drug score)' },
      adverse_event_id: { type: 'string', description: 'Adverse event identifier (optional)' },
      target_id: { type: 'string', description: 'Target identifier (OFFX target_id, required for target/class score)' },
      action_id: { type: 'string', description: 'Action identifier (OFFX action_id, required for target/class score)' }
    },
    anyOf: [
      { required: ['drug_id'] },
      { required: ['target_id', 'action_id'] }
    ]
  },
  examples: [
    {
      description: 'Get drug_score by drug id',
      usage: '{ "drug_id": "99402" }'
    },
    {
      description: 'Get drug_score by drug id and adverse event id',
      usage: '{ "drug_id": "99402", "adverse_event_id": "10001551" }'
    },
    {
      description: 'Get target/class score by target id and action id',
      usage: '{ "target_id": "158", "action_id": "15" }'
    },
    {
      description: 'Get target/class score by target id, action id, and adverse event id',
      usage: '{ "target_id": "158", "action_id": "15", "adverse_event_id": "10001551" }'
    }
  ]
};

// Tool definition for OFFX search_adverse_events
const SEARCH_ADVERSE_EVENTS_TOOL = {
  name: 'search_adverse_events',
  description: 'Search adverse events by name (min 3 chars) using the OFFX API.',
  inputSchema: {
    type: 'object',
    properties: {
      adverse_event: { type: 'string', description: 'Adverse event name (min 3 chars, required)' }
    },
    required: ['adverse_event']
  },
  examples: [
    {
      description: 'Search adverse events by name',
      usage: '{ "adverse_event": "Anaemia" }'
    }
  ]
};

// Tool definition for OFFX get_adverse_events
const GET_ADVERSE_EVENTS_TOOL = {
  name: 'get_adverse_events',
  description: 'Get adverse events by drug id or target id (provide exactly one) using the OFFX API.',
  inputSchema: {
    type: 'object',
    properties: {
      drug_id: { type: 'string', description: 'Drug identifier (OFFX drug_id, optional)' },
      target_id: { type: 'string', description: 'Target identifier (OFFX target_id, optional)' }
    },
    anyOf: [
      { required: ['drug_id'] },
      { required: ['target_id'] }
    ]
  },
  examples: [
    {
      description: 'Get adverse events by drug id',
      usage: '{ "drug_id": "12345" }'
    },
    {
      description: 'Get adverse events by target id',
      usage: '{ "target_id": "67890" }'
    }
  ]
};

// Tool definition for OFFX get_drug (Drug Masterview)
const GET_DRUG_TOOL = {
  name: 'get_drug',
  description: 'Get drug masterview by drug id using the OFFX API. Supports optional filters.',
  inputSchema: {
    type: 'object',
    properties: {
      drug_id: { type: 'string', description: 'Drug identifier (OFFX drug_id, required)' },
      page: { type: 'number', description: 'Page number (required)' },
      adverse_event_id: { type: 'string', description: 'Adverse Event ID (optional)' },
      ref_source_type: { type: 'string', description: 'Reference source type (optional)' },
      alert_type: { type: 'string', description: 'Alert Type (optional)' },
      alert_phase: { type: 'string', description: 'Alert Phase (optional)' },
      alert_level_evidence: { type: 'string', description: 'Level of evidence (optional)' },
      alert_severity: { type: 'string', description: 'Alert Severity (optional)' },
      alert_causality: { type: 'string', description: 'Alert Causality (optional)' },
      alert_species: { type: 'string', description: 'Alert Species (optional)' },
      alert_date_from: { type: 'string', description: 'Date from (optional, YYYY-MM-DD)' },
      alert_date_to: { type: 'string', description: 'Date to (optional, YYYY-MM-DD)' }
    },
    required: ['drug_id', 'page']
  },
  examples: [
    {
      description: 'Get drug masterview for a drug',
      usage: '{ "drug_id": "11204", "page": 1 }'
    },
    {
      description: 'Get drug masterview for a drug with filters',
      usage: '{ "drug_id": "11204", "page": 2, "alert_type": "serious" }'
    }
  ]
};

// Tool definition for OFFX search_targets
const SEARCH_TARGETS_TOOL = {
  name: 'search_targets',
  description: 'Search targets by target name using the OFFX API.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Target name (required)' }
    },
    required: ['target']
  },
  examples: [
    {
      description: 'Search for targets by name',
      usage: '{ "target": "ALK" }'
    }
  ]
};

// Tool definition for OFFX get_target (Target Masterview)
const GET_TARGET_TOOL = {
  name: 'get_target',
  description: 'Get target masterview by target_id and action_id using the OFFX API. Supports optional filters.',
  inputSchema: {
    type: 'object',
    properties: {
      target_id: { type: 'string', description: 'Target identifier (OFFX target_id, required)' },
      action_id: { type: 'string', description: 'Action identifier (OFFX action_id, required)' },
      page: { type: 'number', description: 'Page number (required)' },
      adverse_event_id: { type: 'string', description: 'Adverse Event ID (optional)' },
      ref_source_type: { type: 'string', description: 'Reference source type (optional)' },
      alert_type: { type: 'string', description: 'Alert Type (optional)' },
      alert_phase: { type: 'string', description: 'Alert Phase (optional)' },
      alert_level_evidence: { type: 'string', description: 'Level of evidence (optional)' },
      alert_onoff_target: { type: 'string', description: 'On/Off target (optional)' },
      alert_severity: { type: 'string', description: 'Alert Severity (optional)' },
      alert_causality: { type: 'string', description: 'Alert Causality (optional)' },
      alert_species: { type: 'string', description: 'Alert Species (optional)' },
      alert_date_from: { type: 'string', description: 'Date from (optional, YYYY-MM-DD)' },
      alert_date_to: { type: 'string', description: 'Date to (optional, YYYY-MM-DD)' }
    },
    required: ['target_id', 'action_id', 'page']
  },
  examples: [
    {
      description: 'Get target masterview',
      usage: '{ "target_id": "158", "action_id": "15", "page": 1 }'
    },
    {
      description: 'Get target masterview with filters',
      usage: '{ "target_id": "158", "action_id": "15", "page": 2, "alert_type": "serious" }'
    }
  ]
};

// Tool definition for OFFX get_targets
const GET_TARGETS_TOOL = {
  name: 'get_targets',
  description: 'Get primary or secondary targets for a drug by drug_id, or targets by adverse_event_id, using the OFFX API.',
  inputSchema: {
    type: 'object',
    properties: {
      drug_id: { type: 'string', description: 'Drug identifier (OFFX drug_id, required for primary/secondary targets)' },
      type: { type: 'string', enum: ['primary', 'secondary'], description: 'Type of targets to fetch: "primary" or "secondary" (required if drug_id is used)' },
      adverse_event_id: { type: 'string', description: 'Adverse event identifier (OFFX adverse_event_id, required for adverse event search)' }
    },
    anyOf: [
      { required: ['drug_id', 'type'] },
      { required: ['adverse_event_id'] }
    ]
  },
  examples: [
    {
      description: 'Get primary targets for a drug',
      usage: '{ "drug_id": "11204", "type": "primary" }'
    },
    {
      description: 'Get secondary targets for a drug',
      usage: '{ "drug_id": "11204", "type": "secondary" }'
    },
    {
      description: 'Get targets by adverse event id',
      usage: '{ "adverse_event_id": "10001551" }'
    }
  ]
};

async function searchDrugsByName({ drug }: { drug: string }) {
  if (!drug) {
    throw new Error('drug is required');
  }
  const query = new URLSearchParams({ drug, token: OFFX_API_TOKEN });
  const url = `https://api.targetsafety.info/api/drug/search/param?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function getDrugs(args: { target_id?: string, action_id?: string, adverse_event_id?: string, page?: number }) {
  const { target_id, action_id, adverse_event_id, page } = args;
  const hasTarget = !!target_id;
  const hasAction = !!action_id;
  const hasAdve = !!adverse_event_id;
  if ((hasTarget && hasAction && !hasAdve) || (!hasTarget && !hasAction && hasAdve)) {
    // valid
  } else {
    throw new Error('You must provide either both target_id and action_id, or only adverse_event_id');
  }
  const pageNum = page ?? 1;
  let query: URLSearchParams;
  let url: string;
  if (hasTarget && hasAction) {
    query = new URLSearchParams({ target_id: String(target_id), action_id: String(action_id), page: String(pageNum), token: OFFX_API_TOKEN });
    url = `https://api.targetsafety.info/api/drug/search/param?${query.toString()}`;
  } else if (hasAdve) {
    query = new URLSearchParams({ adverse_event_id: String(adverse_event_id), page: String(pageNum), token: OFFX_API_TOKEN });
    url = `https://api.targetsafety.info/api/drug/search/param?${query.toString()}`;
  } else {
    throw new Error('You must provide either both target_id and action_id, or only adverse_event_id');
  }
    const response = await fetch(url, {
    method: 'GET',
      headers: {
        'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function getAlerts(params: {
  drug_id?: string,
  target_id?: string,
  action_id?: string,
  page?: number,
  adverse_event_id?: string,
  ref_source_type?: string,
  alert_type?: string,
  alert_phase?: string,
  alert_level_evidence?: string,
  alert_onoff_target?: string,
  alert_severity?: string,
  alert_causality?: string,
  alert_species?: string,
  alert_date_from?: string,
  alert_date_to?: string,
  order_by_date?: string,
  order_by_adv?: string
}) {
  const { drug_id, target_id, page } = params;
  const pageNum = page ?? 1;
  if ((drug_id && target_id) || (!drug_id && !target_id)) {
    throw new Error('You must provide exactly one of: drug_id or target_id');
  }
  if (drug_id) {
    if (!drug_id) throw new Error('drug_id is required');
  } else if (target_id) {
    if (!target_id) throw new Error('target_id is required');
  }
  const query = new URLSearchParams({
    page: String(pageNum),
    token: OFFX_API_TOKEN
  });
  if (drug_id) query.append('drug_id', String(drug_id));
  if (target_id) query.append('target_id', String(target_id));
  [
    'action_id',
    'adverse_event_id',
    'ref_source_type',
    'alert_type',
    'alert_phase',
    'alert_level_evidence',
    'alert_onoff_target',
    'alert_severity',
    'alert_causality',
    'alert_species',
    'alert_date_from',
    'alert_date_to',
    'order_by_date',
    'order_by_adv'
  ].forEach(key => {
    const value = (params as any)[key];
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, String(value));
    }
  });
  const url = drug_id
    ? `https://api.targetsafety.info/api/drug/alerts/param?${query.toString()}`
    : `https://api.targetsafety.info/api/target/alerts/param?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function getDrugScore({ drug_id, adverse_event_id }: { drug_id: string, adverse_event_id?: string }) {
  if (!drug_id) {
    throw new Error('drug_id is required');
  }
  const query = new URLSearchParams({
    drug_id: String(drug_id),
    token: OFFX_API_TOKEN
  });
  if (adverse_event_id) {
    query.append('adverse_event_id', String(adverse_event_id));
  }
  const url = `https://api.targetsafety.info/api/score/drug/search/param?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
      headers: {
        'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function searchAdverseEvents({ adverse_event }: { adverse_event: string }) {
  if (!adverse_event) {
    throw new Error('adverse_event is required');
  }
  const query = new URLSearchParams({ adverse_event, token: OFFX_API_TOKEN });
  const url = `https://api.targetsafety.info/api/adverseevent/search/param?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function getAdverseEvents(args: { drug_id?: string, target_id?: string }) {
  const { drug_id, target_id } = args;
  if ((drug_id && target_id) || (!drug_id && !target_id)) {
    throw new Error('You must provide exactly one of: drug_id or target_id');
  }
  let query: URLSearchParams;
  let url: string;
  if (drug_id) {
    query = new URLSearchParams({ drug_id: String(drug_id), token: OFFX_API_TOKEN });
    url = `https://api.targetsafety.info/api/adverseevent/search/param?${query.toString()}`;
  } else if (target_id) {
    query = new URLSearchParams({ target_id: String(target_id), token: OFFX_API_TOKEN });
    url = `https://api.targetsafety.info/api/adverseevent/search/param?${query.toString()}`;
  } else {
    throw new Error('You must provide exactly one of: drug_id or target_id');
  }
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function getTargetScore({ target_id, action_id, adverse_event_id }: { target_id: string, action_id: string, adverse_event_id?: string }) {
  if (!target_id) {
    throw new Error('target_id is required');
  }
  if (!action_id) {
    throw new Error('action_id is required');
  }
  const query = new URLSearchParams({
    target_id: String(target_id),
    action_id: String(action_id),
    token: OFFX_API_TOKEN
  });
  if (adverse_event_id) {
    query.append('adverse_event_id', String(adverse_event_id));
  }
  const url = `https://api.targetsafety.info/api/score/target/search/param?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function getScore(args: { drug_id?: string, adverse_event_id?: string, target_id?: string, action_id?: string }) {
  const { drug_id, adverse_event_id, target_id, action_id } = args;
  const hasDrug = !!drug_id;
  const hasTarget = !!target_id;
  const hasAction = !!action_id;
  if ((hasDrug && !hasTarget && !hasAction) || (!hasDrug && hasTarget && hasAction)) {
    // valid
    } else {
    throw new Error('You must provide either drug_id (alone), or both target_id and action_id (together), but not neither, not all, and not just one of target_id/action_id');
  }
  if (hasDrug) {
    return await getDrugScore({ drug_id, adverse_event_id });
  } else if (hasTarget && hasAction) {
    return await getTargetScore({ target_id, action_id, adverse_event_id });
  } else {
    throw new Error('You must provide either drug_id (alone), or both target_id and action_id (together)');
  }
}

async function getDrugMasterview(params: {
  drug_id: string,
  page: number,
  adverse_event_id?: string,
  ref_source_type?: string,
  alert_type?: string,
  alert_phase?: string,
  alert_level_evidence?: string,
  alert_severity?: string,
  alert_causality?: string,
  alert_species?: string,
  alert_date_from?: string,
  alert_date_to?: string
}) {
  const { drug_id, page } = params;
  if (!drug_id) {
    throw new Error('drug_id is required');
  }
  if (!page) {
    throw new Error('page is required');
  }
  const query = new URLSearchParams({
    drug_id: String(drug_id),
    page: String(page),
    token: OFFX_API_TOKEN
  });
  [
    'adverse_event_id',
    'ref_source_type',
    'alert_type',
    'alert_phase',
    'alert_level_evidence',
    'alert_severity',
    'alert_causality',
    'alert_species',
    'alert_date_from',
    'alert_date_to'
  ].forEach(key => {
    const value = (params as any)[key];
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, String(value));
    }
  });
  const url = `https://api.targetsafety.info/api/drug/masterview/param?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function searchTargets({ target }: { target: string }) {
  if (!target) {
    throw new Error('target is required');
  }
  const query = new URLSearchParams({ target, token: OFFX_API_TOKEN });
  const url = `https://api.targetsafety.info/api/target/search/param?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function getTargetMasterview(params: {
  target_id: string,
  action_id: string,
  page?: number,
  adverse_event_id?: string,
  ref_source_type?: string,
  alert_type?: string,
  alert_phase?: string,
  alert_level_evidence?: string,
  alert_onoff_target?: string,
  alert_severity?: string,
  alert_causality?: string,
  alert_species?: string,
  alert_date_from?: string,
  alert_date_to?: string
}) {
  const { target_id, action_id, page } = params;
  if (!target_id) {
    throw new Error('target_id is required');
  }
  if (!action_id) {
    throw new Error('action_id is required');
  }
  const pageNum = page ?? 1;
  const query = new URLSearchParams({
    target_id: String(target_id),
    action_id: String(action_id),
    page: String(pageNum),
    token: OFFX_API_TOKEN
  });
  [
    'adverse_event_id',
    'ref_source_type',
    'alert_type',
    'alert_phase',
    'alert_level_evidence',
    'alert_onoff_target',
    'alert_severity',
    'alert_causality',
    'alert_species',
    'alert_date_from',
    'alert_date_to'
  ].forEach(key => {
    const value = (params as any)[key];
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, String(value));
    }
  });
  const url = `https://api.targetsafety.info/api/target/masterview/param?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function getPrimaryTargets({ drug_id }: { drug_id: string }) {
  if (!drug_id) throw new Error('drug_id is required');
  const query = new URLSearchParams({ drug_id: String(drug_id), token: OFFX_API_TOKEN });
  const url = `https://api.targetsafety.info/api/target/primary/search/param?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function getSecondaryTargets({ drug_id }: { drug_id: string }) {
  if (!drug_id) throw new Error('drug_id is required');
  const query = new URLSearchParams({ drug_id: String(drug_id), token: OFFX_API_TOKEN });
  const url = `https://api.targetsafety.info/api/target/secondary/search/param?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function getTargetsByAdverseEvent({ adverse_event_id }: { adverse_event_id: string }) {
  if (!adverse_event_id) throw new Error('adverse_event_id is required');
  const query = new URLSearchParams({ adverse_event_id: String(adverse_event_id), token: OFFX_API_TOKEN });
  const url = `https://api.targetsafety.info/api/target/search/param?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed with status ${response.status}: ${errorText}`);
  }
  return await response.json();
}

async function getTargets(args: { drug_id?: string, type?: 'primary' | 'secondary', adverse_event_id?: string }) {
  const { drug_id, type, adverse_event_id } = args;
  // Enforce that exactly one of drug_id or adverse_event_id is provided
  if ((!!drug_id && !!adverse_event_id) || (!drug_id && !adverse_event_id)) {
    throw new Error('You must provide exactly one of: drug_id or adverse_event_id');
  }
  if (drug_id) {
    const targetType = type || 'primary';
    if (targetType === 'primary') {
      const primary = await getPrimaryTargets({ drug_id });
      return { primary_targets: primary.targets || [] };
    } else if (targetType === 'secondary') {
      const secondary = await getSecondaryTargets({ drug_id });
      return { secondary_targets: secondary.targets || [] };
    } else {
      throw new Error('type must be "primary" or "secondary"');
    }
  } else if (adverse_event_id) {
    const result = await getTargetsByAdverseEvent({ adverse_event_id });
    return { targets: result.targets || [] };
  } else {
    throw new Error('You must provide either drug_id or adverse_event_id');
  }
}

/**
 * Main server initialization and setup function
 * Supports both HTTP and MCP server modes with configurable transport
 * 
 * @throws Error if server initialization fails
 */
async function runServer() {
  if (USE_HTTP) {
    const server = http.createServer(async (req, res) => {
      // Helper to parse JSON body
      const parseBody = (req: http.IncomingMessage) => new Promise<any>((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });

      // Routing for all tools
      if (req.method === 'POST') {
        const url = req.url || '';
        try {
          let data: any = await parseBody(req);
          let result: any;
          if (url === '/search_drugs') {
            result = await searchDrugsByName(data);
          } else if (url === '/get_drugs') {
            result = await getDrugs(data);
          } else if (url === '/get_alerts') {
            result = await getAlerts(data);
          } else if (url === '/get_score') {
            result = await getScore(data);
          } else if (url === '/get_drug') {
            result = await getDrugMasterview(data);
          } else if (url === '/search_adverse_events') {
            result = await searchAdverseEvents(data);
          } else if (url === '/get_adverse_events') {
            result = await getAdverseEvents(data);
          } else if (url === '/search_targets') {
            result = await searchTargets(data);
          } else if (url === '/get_target') {
            result = await getTargetMasterview(data);
          } else if (url === '/get_targets') {
            result = await getTargets(data);
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });
    server.listen(PORT, () => {
      console.log(`OFFX MCP Server running on http://localhost:${PORT}`);
    });
    return;
  }
  // MCP mode
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { CallToolRequestSchema, ListToolsRequestSchema, McpError } = await import('@modelcontextprotocol/sdk/types.js');
  const server = new Server(
    {
      name: 'offx',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [SEARCH_DRUGS_TOOL, GET_DRUGS_TOOL, GET_ALERTS_TOOL, GET_SCORE_TOOL, GET_DRUG_TOOL, GET_TARGET_TOOL, GET_TARGETS_TOOL, SEARCH_TARGETS_TOOL, SEARCH_ADVERSE_EVENTS_TOOL, GET_ADVERSE_EVENTS_TOOL]
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params?.name;
    let args = request.params.arguments;
    try {
      switch (toolName) {
        case 'search_drugs': {
          let drug: string | undefined;
          if (typeof args === 'object' && args !== null && 'drug' in args) {
            drug = String((args as any).drug);
          } else if (typeof args === 'string') {
            drug = args as string;
          }
          if (!drug) throw new McpError(-32602, 'drug is required');
          const result = await searchDrugsByName({ drug });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        case 'get_drugs': {
          const result = await getDrugs(args as any);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        case 'get_alerts': {
          const result = await getAlerts(args as any);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        case 'get_score': {
          const result = await getScore(args as any);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        case 'get_drug': {
          const result = await getDrugMasterview(args as any);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        case 'search_targets': {
          let target: string | undefined;
          if (typeof args === 'object' && args !== null && 'target' in args) {
            target = String((args as any).target);
          } else if (typeof args === 'string') {
            target = args as string;
          }
          if (!target) throw new McpError(-32602, 'target is required');
          const result = await searchTargets({ target });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        case 'search_adverse_events': {
          let adverse_event: string | undefined;
          if (typeof args === 'object' && args !== null && 'adverse_event' in args) {
            adverse_event = String((args as any).adverse_event);
          } else if (typeof args === 'string') {
            adverse_event = args as string;
          }
          if (!adverse_event) throw new McpError(-32602, 'adverse_event is required');
          const result = await searchAdverseEvents({ adverse_event });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        case 'get_adverse_events': {
          const result = await getAdverseEvents(args as any);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        case 'get_target': {
          const result = await getTargetMasterview(args as any);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        case 'get_targets': {
          const result = await getTargets(args as any);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false };
        }
        default:
          throw new McpError(-32603, 'Unknown tool');
      }
      } catch (error) {
      throw new McpError(-32603, error instanceof Error ? error.message : String(error));
    }
  });
    const transport = new StdioServerTransport();
    await server.connect(transport);
  console.log('OFFX MCP Server running in MCP mode');
}

runServer().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
