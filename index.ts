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

// Shared error schema
const ERROR_SCHEMA = {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Error message' },
    code: { type: 'number', description: 'HTTP status code' }
  },
  required: ['error', 'code']
};

// Tool definition for OFFX search_drugs
const SEARCH_DRUGS_TOOL = {
  name: 'search_drugs',
  description: 'Search for drugs by name. Use the "drug" parameter to find drugs matching a partial or full name. Useful for lookup and autocomplete.',
  inputSchema: {
    type: 'object',
    properties: {
      drug: { type: 'string', description: 'Drug name (required)' }
    },
    required: ['drug']
  },
  responseSchema: {
    type: 'object',
    properties: {
      drugs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            drug_id: { type: 'string' },
            drug_main_name: { type: 'string' },
            drug_other_names: { type: 'array', items: { type: 'string' } },
            drug_phase: { type: 'string' },
            drug_molecule_type: { type: 'string' },
            drug_modalities: { type: 'array', items: { type: 'string' } },
            chembl_id: { type: 'string' }
          },
          required: ['drug_id', 'drug_main_name']
        }
      }
    },
    required: ['drugs']
        },
        examples: [
    {
      description: 'Search for drugs by name',
      usage: '{ "drug": "everolimus" }',
      response: '{ "drugs": [ { "drug_id": "99402", "drug_main_name": "everolimus" } ] }'
    }
  ]
};

// Tool definition for OFFX get_drugs
const GET_DRUGS_TOOL = {
  name: 'get_drugs',
  description: 'Get drugs by both target_id and action_id (together), or by adverse_event_id (alone). Use target_id+action_id to find drugs acting on a specific target/action, or adverse_event_id to find drugs associated with a specific adverse event.',
  inputSchema: {
    type: 'object',
    properties: {
      target_id: { type: 'string', description: 'Target identifier (OFFX target_id)' },
      action_id: { type: 'string', description: 'Action identifier (OFFX action_id)' },
      adverse_event_id: { type: 'string', description: 'Adverse event identifier (OFFX adverse_event_id)' },
      page: { type: 'number', description: 'Page number (default: 1)', default: 1 }
    },
    oneOf: [
      { required: ['target_id', 'action_id'], not: { required: ['adverse_event_id'] } },
      { required: ['adverse_event_id'], not: { required: ['target_id'] } }
    ]
  },
  responseSchema: {
    type: 'object',
    properties: {
      drugs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            drug_id: { type: 'string' },
            drug_main_name: { type: 'string' },
            drug_other_names: { type: 'array', items: { type: 'string' } },
            drug_phase: { type: 'string' },
            drug_molecule_type: { type: 'string' },
            drug_modalities: { type: 'array', items: { type: 'string' } },
            chembl_id: { type: 'string' }
          },
          required: ['drug_id', 'drug_main_name']
        }
      }
    },
    required: ['drugs']
  },
  examples: [
    {
      description: 'By target and action',
      usage: '{ "target_id": "123", "action_id": "456" }',
      response: '{ "drugs": [ { "drug_id": "140448", "drug_main_name": "semaglutide" } ] }'
    },
    {
      description: 'By adverse event',
      usage: '{ "adverse_event_id": "10001551" }',
      response: '{ "drugs": [ { "drug_id": "140448", "drug_main_name": "semaglutide" } ] }'
    }
  ]
};

// Tool definition for OFFX get_alerts (merged drug/target alerts)
const GET_ALERTS_TOOL = {
  name: 'get_alerts',
  description: 'Get individual alert records for a drug (by drug_id) or a target (by target_id). Supports powerful filtering by severity (alert_severity), date range (alert_date_from, alert_date_to), alert type, phase, level of evidence, causality, species, and more. Use this endpoint to answer questions like "What severe adverse events have been reported for drug X in the last 2 weeks?"',
  inputSchema: {
    type: 'object',
    properties: {
      drug_id: { type: 'string', description: 'Drug identifier (OFFX drug_id, optional)' },
      target_id: { type: 'string', description: 'Target identifier (OFFX target_id, optional)' },
      action_id: { type: 'string', description: 'Action ID (optional, for target alerts)' },
      page: { type: 'number', description: 'Page number (required)' },
      adverse_event_id: { type: 'string', description: 'Adverse Event ID (optional)' },
      ref_source_type: { type: 'string', description: 'Reference source type (optional, comma separated number)',
        enum: ['9','10','11','27','24','22','23','25','12','13','14','15','16','17','18','19','20','21','26'],
        enumDescriptions: {
          '9': 'Congress', '10': 'Website Reference', '11': 'Company Communication', '27': 'Health Organization', '24': 'Database', '22': 'DailyMed', '23': 'Regulatory Agency Briefing', '25': 'Patent', '12': 'Medical Society Communication', '13': 'Research Institution Communication', '14': 'Regulatory Agency Communication', '15': 'Regulatory Agency Guideline', '16': 'Patient Advocacy Group communication', '17': 'Other', '18': 'Book', '19': 'Journal', '20': 'Congress Alert', '21': 'Congress & Conferences', '26': 'Clinical Trial Registry'
        },
        format: 'Comma separated number(s), e.g. 9 or 9,10,11'
      },
      alert_type: { type: 'string', description: 'Alert Type (optional, comma separated number): 1 = Class Alert, 2 = Drug Alert, 1,2 = both', enum: ['1','2','1,2'], enumDescriptions: { '1': 'Class Alert', '2': 'Drug Alert', '1,2': 'Both' }, format: 'Comma separated number(s), e.g. 1 or 1,2', examples: ['1','2','1,2'] },
      alert_phase: { type: 'string', description: 'Alert Phase (optional, comma separated number)',
        enum: ['1','2','3','4','5','6','7','8','9','10','11','12'],
        enumDescriptions: {
          '1': 'Clinical/Postmarketing', '2': 'Preclinical', '3': 'Clinical', '4': 'Postmarketing', '5': 'Target Discovery', '6': 'Phase I', '7': 'Phase II', '8': 'Phase III', '9': 'Phase IV', '10': 'Phase I/II', '11': 'Phase II/III', '12': 'Phase III/IV'
        },
        format: 'Comma separated number(s), e.g. 1 or 1,2,3',
        examples: ['1','1,2','1,2,3,4,5,6']
      },
      alert_level_evidence: { type: 'string', description: 'Level of evidence (optional, comma separated number)',
        enum: ['1','2','3'],
        enumDescriptions: { '1': 'Confirmed/Reported', '2': 'Suspected', '3': 'Refuted/Not Associated' },
        format: 'Comma separated number(s), e.g. 1 or 1,2',
        examples: ['1','2','1,2']
      },
      alert_onoff_target: { type: 'string', description: 'On/Off target (optional, comma separated number)',
        enum: ['1','2','3'],
        enumDescriptions: { '1': 'On-Target', '2': 'Off-Target', '3': 'Not Specified' },
        format: 'Comma separated number(s), e.g. 1 or 1,2',
        examples: ['1','2','1,2']
      },
      alert_severity: { type: 'string', description: 'Alert Severity (optional, string: yes or no)', enum: ['yes','no'], examples: ['yes','no'] },
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
  responseSchema: {
    type: 'object',
    properties: {
      alerts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            drug_id: { type: 'string' },
            target_id: { type: 'string' },
            action_id: { type: 'string' },
            adverse_event_id: { type: 'string' },
            ref_source_type: { type: 'string' },
            alert_type: { type: 'string' },
            alert_phase: { type: 'string' },
            alert_level_evidence: { type: 'string' },
            alert_onoff_target: { type: 'string' },
            alert_severity: { type: 'string' },
            alert_causality: { type: 'string' },
            alert_species: { type: 'string' },
            alert_date_from: { type: 'string' },
            alert_date_to: { type: 'string' },
            order_by_date: { type: 'string' },
            order_by_adv: { type: 'string' }
          },
          required: ['drug_id', 'target_id', 'action_id', 'adverse_event_id', 'ref_source_type', 'alert_type', 'alert_phase', 'alert_level_evidence', 'alert_onoff_target', 'alert_severity', 'alert_causality', 'alert_species', 'alert_date_from', 'alert_date_to', 'order_by_date', 'order_by_adv']
        }
      }
    },
    required: ['alerts']
  },
  examples: [
    {
      description: 'Get alerts for a drug',
      usage: '{ "drug_id": "11204", "page": 1 }',
      response: '{ "alerts": [ { "drug_id": "11204", "target_id": "158", "action_id": "15", "adverse_event_id": "10001551", "ref_source_type": "clinical", "alert_type": "2", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_onoff_target": "on", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31", "order_by_date": "2020-01-01", "order_by_adv": "2020-01-01" } ] }'
    },
    {
      description: 'Get alerts for a target',
      usage: '{ "target_id": "158", "page": 1 }',
      response: '{ "alerts": [ { "drug_id": "11204", "target_id": "158", "action_id": "15", "adverse_event_id": "10001551", "ref_source_type": "clinical", "alert_type": "2", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_onoff_target": "on", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31", "order_by_date": "2020-01-01", "order_by_adv": "2020-01-01" } ] }'
    },
    {
      description: 'Get alerts for a target with filters',
      usage: '{ "target_id": "158", "page": 2, "alert_type": "2" }',
      response: '{ "alerts": [ { "drug_id": "11204", "target_id": "158", "action_id": "15", "adverse_event_id": "10001551", "ref_source_type": "clinical", "alert_type": "2", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_onoff_target": "on", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31", "order_by_date": "2020-01-01", "order_by_adv": "2020-01-01" } ] }'
    }
  ]
};

// Tool definition for OFFX get_score
const GET_SCORE_TOOL = {
  name: 'get_score',
  description: 'Get a risk/score value for a drug (by drug_id) or for a target/class (by target_id and action_id). Optionally filter by adverse_event_id. Returns a numeric score representing risk or association.',
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
  responseSchema: {
    type: 'object',
    properties: {
      score: { type: 'number' },
      drug_id: { type: 'string' },
      adverse_event_id: { type: 'string' },
      target_id: { type: 'string' },
      action_id: { type: 'string' }
    },
    required: ['score', 'drug_id', 'target_id', 'action_id']
  },
  examples: [
    {
      description: 'Get drug_score by drug id',
      usage: '{ "drug_id": "99402" }',
      response: '{ "score": 0.9, "drug_id": "99402" }'
    },
    {
      description: 'Get drug_score by drug id and adverse event id',
      usage: '{ "drug_id": "99402", "adverse_event_id": "10001551" }',
      response: '{ "score": 0.9, "drug_id": "99402", "adverse_event_id": "10001551" }'
    },
    {
      description: 'Get target/class score by target id and action id',
      usage: '{ "target_id": "158", "action_id": "15" }',
      response: '{ "score": 0.9, "target_id": "158", "action_id": "15" }'
    },
    {
      description: 'Get target/class score by target id, action id, and adverse event id',
      usage: '{ "target_id": "158", "action_id": "15", "adverse_event_id": "10001551" }',
      response: '{ "score": 0.9, "target_id": "158", "action_id": "15", "adverse_event_id": "10001551" }'
    }
  ]
};

// Tool definition for OFFX search_adverse_events
const SEARCH_ADVERSE_EVENTS_TOOL = {
  name: 'search_adverse_events',
  description: 'Search for adverse events by name (min 3 chars). Use the "adverse_event" parameter for lookup or autocomplete of adverse event names.',
  inputSchema: {
    type: 'object',
    properties: {
      adverse_event: { type: 'string', description: 'Adverse event name (min 3 chars, required)' }
    },
    required: ['adverse_event']
  },
  responseSchema: {
    type: 'object',
    properties: {
      adverse_events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            adverse_event_id: { type: 'string' },
            adverse_event: { type: 'string' },
            ref_source_type: { type: 'string' },
            alert_type: { type: 'string' },
            alert_phase: { type: 'string' },
            alert_level_evidence: { type: 'string' },
            alert_severity: { type: 'string' },
            alert_causality: { type: 'string' },
            alert_species: { type: 'string' },
            alert_date_from: { type: 'string' },
            alert_date_to: { type: 'string' }
          },
          required: ['adverse_event_id', 'adverse_event']
        }
      }
    },
    required: ['adverse_events']
  },
  examples: [
    {
      description: 'Search adverse events by name',
      usage: '{ "adverse_event": "Anaemia" }',
      response: '{ "adverse_events": [ { "adverse_event_id": "10001551", "adverse_event": "Anaemia", "ref_source_type": "clinical", "alert_type": "serious", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31" } ] }'
    }
  ]
};

// Tool definition for OFFX get_adverse_events
const GET_ADVERSE_EVENTS_TOOL = {
  name: 'get_adverse_events',
  description: 'Get the list of adverse event types associated with a drug (by drug_id) or target (by target_id). Does not support filtering by severity, date, or other attributes, and does not return individual alert records. Use to see all adverse events ever associated with a drug or target.',
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
  responseSchema: {
    type: 'object',
    properties: {
      adverse_events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            adverse_event_id: { type: 'string' },
            adverse_event: { type: 'string' },
            ref_source_type: { type: 'string' },
            alert_type: { type: 'string' },
            alert_phase: { type: 'string' },
            alert_level_evidence: { type: 'string' },
            alert_severity: { type: 'string' },
            alert_causality: { type: 'string' },
            alert_species: { type: 'string' },
            alert_date_from: { type: 'string' },
            alert_date_to: { type: 'string' }
          },
          required: ['adverse_event_id', 'adverse_event']
        }
      }
    },
    required: ['adverse_events']
  },
  examples: [
    {
      description: 'Get adverse events by drug id',
      usage: '{ "drug_id": "12345" }',
      response: '{ "adverse_events": [ { "adverse_event_id": "12345", "adverse_event": "Anaemia", "ref_source_type": "clinical", "alert_type": "serious", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31" } ] }'
    },
    {
      description: 'Get adverse events by target id',
      usage: '{ "target_id": "67890" }',
      response: '{ "adverse_events": [ { "adverse_event_id": "67890", "adverse_event": "Anaemia", "ref_source_type": "clinical", "alert_type": "serious", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31" } ] }'
    }
  ]
};

// Tool definition for OFFX get_drug (Drug Masterview)
const GET_DRUG_TOOL = {
  name: 'get_drug',
  description: 'Get a summary (masterview) for a drug by drug_id. Supports optional filters (e.g., adverse_event_id, alert_type, alert_phase, alert_severity, alert_date_from, alert_date_to, etc.) to refine the summary. Use for a high-level overview, not for listing all alerts.',
  inputSchema: {
    type: 'object',
    properties: {
      drug_id: { type: 'string', description: 'Drug identifier (OFFX drug_id, required)' },
      page: { type: 'number', description: 'Page number (required)' },
      adverse_event_id: { type: 'string', description: 'Adverse Event ID (optional)' },
      ref_source_type: { type: 'string', description: 'Reference source type (optional, comma separated number)',
        enum: ['9','10','11','27','24','22','23','25','12','13','14','15','16','17','18','19','20','21','26'],
        enumDescriptions: {
          '9': 'Congress', '10': 'Website Reference', '11': 'Company Communication', '27': 'Health Organization', '24': 'Database', '22': 'DailyMed', '23': 'Regulatory Agency Briefing', '25': 'Patent', '12': 'Medical Society Communication', '13': 'Research Institution Communication', '14': 'Regulatory Agency Communication', '15': 'Regulatory Agency Guideline', '16': 'Patient Advocacy Group communication', '17': 'Other', '18': 'Book', '19': 'Journal', '20': 'Congress Alert', '21': 'Congress & Conferences', '26': 'Clinical Trial Registry'
        },
        format: 'Comma separated number(s), e.g. 9 or 9,10,11'
      },
      alert_type: { type: 'string', description: 'Alert Type (optional, comma separated number): 1 = Class Alert, 2 = Drug Alert, 1,2 = both', enum: ['1','2','1,2'], enumDescriptions: { '1': 'Class Alert', '2': 'Drug Alert', '1,2': 'Both' }, format: 'Comma separated number(s), e.g. 1 or 1,2', examples: ['1','2','1,2'] },
      alert_phase: { type: 'string', description: 'Alert Phase (optional, comma separated number)',
        enum: ['1','2','3','4','5','6','7','8','9','10','11','12'],
        enumDescriptions: {
          '1': 'Clinical/Postmarketing', '2': 'Preclinical', '3': 'Clinical', '4': 'Postmarketing', '5': 'Target Discovery', '6': 'Phase I', '7': 'Phase II', '8': 'Phase III', '9': 'Phase IV', '10': 'Phase I/II', '11': 'Phase II/III', '12': 'Phase III/IV'
        },
        format: 'Comma separated number(s), e.g. 1 or 1,2,3',
        examples: ['1','1,2','1,2,3,4,5,6']
      },
      alert_level_evidence: { type: 'string', description: 'Level of evidence (optional, comma separated number)',
        enum: ['1','2','3'],
        enumDescriptions: { '1': 'Confirmed/Reported', '2': 'Suspected', '3': 'Refuted/Not Associated' },
        format: 'Comma separated number(s), e.g. 1 or 1,2',
        examples: ['1','2','1,2']
      },
      alert_severity: { type: 'string', description: 'Alert Severity (optional, string: yes or no)', enum: ['yes','no'], examples: ['yes','no'] },
      alert_causality: { type: 'string', description: 'Alert Causality (optional)' },
      alert_species: { type: 'string', description: 'Alert Species (optional)' },
      alert_date_from: { type: 'string', description: 'Date from (optional, YYYY-MM-DD)' },
      alert_date_to: { type: 'string', description: 'Date to (optional, YYYY-MM-DD)' }
    },
    required: ['drug_id', 'page']
  },
  responseSchema: {
    type: 'object',
    properties: {
      drug: {
        type: 'object',
        properties: {
          drug_id: { type: 'string' },
          drug_main_name: { type: 'string' },
          drug_other_names: { type: 'array', items: { type: 'string' } },
          drug_phase: { type: 'string' },
          drug_molecule_type: { type: 'string' },
          drug_modalities: { type: 'array', items: { type: 'string' } },
          chembl_id: { type: 'string' }
        },
        required: ['drug_id', 'drug_main_name']
      }
    },
    required: ['drug']
  },
  examples: [
    {
      description: 'Get drug masterview for a drug',
      usage: '{ "drug_id": "11204", "page": 1 }',
      response: '{ "drug": { "drug_id": "11204", "drug_main_name": "semaglutide" } }'
    },
    {
      description: 'Get drug masterview for a drug with filters',
      usage: '{ "drug_id": "11204", "page": 2, "alert_type": "2" }',
      response: '{ "drug": { "drug_id": "11204", "drug_main_name": "semaglutide", "alert_type": "2" } }'
    }
  ]
};

// Tool definition for OFFX search_targets
const SEARCH_TARGETS_TOOL = {
  name: 'search_targets',
  description: 'Search for targets by name. Use the "target" parameter to find targets matching a partial or full name. Useful for lookup and autocomplete.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Target name (required)' }
    },
    required: ['target']
  },
  responseSchema: {
    type: 'object',
    properties: {
      targets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            target_id: { type: 'string' },
            target: { type: 'string' },
            ref_source_type: { type: 'string' },
            alert_type: { type: 'string' },
            alert_phase: { type: 'string' },
            alert_level_evidence: { type: 'string' },
            alert_onoff_target: { type: 'string' },
            alert_severity: { type: 'string' },
            alert_causality: { type: 'string' },
            alert_species: { type: 'string' },
            alert_date_from: { type: 'string' },
            alert_date_to: { type: 'string' }
          },
          required: ['target_id', 'target']
        }
      }
    },
    required: ['targets']
  },
  examples: [
    {
      description: 'Search for targets by name',
      usage: '{ "target": "ALK" }',
      response: '{ "targets": [ { "target_id": "158", "target": "ALK", "ref_source_type": "clinical", "alert_type": "serious", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_onoff_target": "on", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31" } ] }'
    }
  ]
};

// Tool definition for OFFX get_target (Target Masterview)
const GET_TARGET_TOOL = {
  name: 'get_target',
  description: 'Get a summary (masterview) for a target by target_id and action_id. Supports optional filters (e.g., adverse_event_id, alert_type, alert_phase, alert_severity, alert_date_from, alert_date_to, etc.) to refine the summary. Use for a high-level overview, not for listing all alerts.',
  inputSchema: {
    type: 'object',
    properties: {
      target_id: { type: 'string', description: 'Target identifier (OFFX target_id, required)' },
      action_id: { type: 'string', description: 'Action identifier (OFFX action_id, required)' },
      page: { type: 'number', description: 'Page number (required)' },
      adverse_event_id: { type: 'string', description: 'Adverse Event ID (optional)' },
      ref_source_type: { type: 'string', description: 'Reference source type (optional, comma separated number)',
        enum: ['9','10','11','27','24','22','23','25','12','13','14','15','16','17','18','19','20','21','26'],
        enumDescriptions: {
          '9': 'Congress', '10': 'Website Reference', '11': 'Company Communication', '27': 'Health Organization', '24': 'Database', '22': 'DailyMed', '23': 'Regulatory Agency Briefing', '25': 'Patent', '12': 'Medical Society Communication', '13': 'Research Institution Communication', '14': 'Regulatory Agency Communication', '15': 'Regulatory Agency Guideline', '16': 'Patient Advocacy Group communication', '17': 'Other', '18': 'Book', '19': 'Journal', '20': 'Congress Alert', '21': 'Congress & Conferences', '26': 'Clinical Trial Registry'
        },
        format: 'Comma separated number(s), e.g. 9 or 9,10,11'
      },
      alert_type: { type: 'string', description: 'Alert Type (optional, comma separated number): 1 = Class Alert, 2 = Drug Alert, 1,2 = both', enum: ['1','2','1,2'], enumDescriptions: { '1': 'Class Alert', '2': 'Drug Alert', '1,2': 'Both' }, format: 'Comma separated number(s), e.g. 1 or 1,2', examples: ['1','2','1,2'] },
      alert_phase: { type: 'string', description: 'Alert Phase (optional, comma separated number)',
        enum: ['1','2','3','4','5','6','7','8','9','10','11','12'],
        enumDescriptions: {
          '1': 'Clinical/Postmarketing', '2': 'Preclinical', '3': 'Clinical', '4': 'Postmarketing', '5': 'Target Discovery', '6': 'Phase I', '7': 'Phase II', '8': 'Phase III', '9': 'Phase IV', '10': 'Phase I/II', '11': 'Phase II/III', '12': 'Phase III/IV'
        },
        format: 'Comma separated number(s), e.g. 1 or 1,2,3',
        examples: ['1','1,2','1,2,3,4,5,6']
      },
      alert_level_evidence: { type: 'string', description: 'Level of evidence (optional, comma separated number)',
        enum: ['1','2','3'],
        enumDescriptions: { '1': 'Confirmed/Reported', '2': 'Suspected', '3': 'Refuted/Not Associated' },
        format: 'Comma separated number(s), e.g. 1 or 1,2',
        examples: ['1','2','1,2']
      },
      alert_onoff_target: { type: 'string', description: 'On/Off target (optional, comma separated number)',
        enum: ['1','2','3'],
        enumDescriptions: { '1': 'On-Target', '2': 'Off-Target', '3': 'Not Specified' },
        format: 'Comma separated number(s), e.g. 1 or 1,2',
        examples: ['1','2','1,2']
      },
      alert_severity: { type: 'string', description: 'Alert Severity (optional, string: yes or no)', enum: ['yes','no'], examples: ['yes','no'] },
      alert_causality: { type: 'string', description: 'Alert Causality (optional)' },
      alert_species: { type: 'string', description: 'Alert Species (optional)' },
      alert_date_from: { type: 'string', description: 'Date from (optional, YYYY-MM-DD)' },
      alert_date_to: { type: 'string', description: 'Date to (optional, YYYY-MM-DD)' }
    },
    required: ['target_id', 'action_id', 'page']
  },
  responseSchema: {
    type: 'object',
    properties: {
      target: {
        type: 'object',
        properties: {
          target_id: { type: 'string' },
          target: { type: 'string' },
          ref_source_type: { type: 'string' },
          alert_type: { type: 'string' },
          alert_phase: { type: 'string' },
          alert_level_evidence: { type: 'string' },
          alert_onoff_target: { type: 'string' },
          alert_severity: { type: 'string' },
          alert_causality: { type: 'string' },
          alert_species: { type: 'string' },
          alert_date_from: { type: 'string' },
          alert_date_to: { type: 'string' }
        },
        required: ['target_id', 'target']
      }
    },
    required: ['target']
  },
  examples: [
    {
      description: 'Get target masterview',
      usage: '{ "target_id": "158", "action_id": "15", "page": 1 }',
      response: '{ "target": { "target_id": "158", "target": "ALK", "ref_source_type": "clinical", "alert_type": "serious", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_onoff_target": "on", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31" } }'
    },
    {
      description: 'Get target masterview with filters',
      usage: '{ "target_id": "158", "action_id": "15", "page": 2, "alert_type": "2" }',
      response: '{ "target": { "target_id": "158", "target": "ALK", "ref_source_type": "clinical", "alert_type": "2", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_onoff_target": "on", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31" } }'
    }
  ]
};

// Tool definition for OFFX get_targets
const GET_TARGETS_TOOL = {
  name: 'get_targets',
  description: 'Get primary or secondary targets for a drug (by drug_id, with type=primary/secondary), or all targets associated with an adverse event (by adverse_event_id). Use to explore drug-target relationships or find targets linked to a specific adverse event.',
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
  responseSchema: {
    type: 'object',
    properties: {
      targets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            target_id: { type: 'string' },
            target: { type: 'string' },
            ref_source_type: { type: 'string' },
            alert_type: { type: 'string' },
            alert_phase: { type: 'string' },
            alert_level_evidence: { type: 'string' },
            alert_onoff_target: { type: 'string' },
            alert_severity: { type: 'string' },
            alert_causality: { type: 'string' },
            alert_species: { type: 'string' },
            alert_date_from: { type: 'string' },
            alert_date_to: { type: 'string' }
          },
          required: ['target_id', 'target']
        }
      }
    },
    required: ['targets']
  },
  examples: [
    {
      description: 'Get primary targets for a drug',
      usage: '{ "drug_id": "11204", "type": "primary" }',
      response: '{ "targets": [ { "target_id": "11204", "target": "semaglutide", "ref_source_type": "clinical", "alert_type": "serious", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_onoff_target": "on", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31" } ] }'
    },
    {
      description: 'Get secondary targets for a drug',
      usage: '{ "drug_id": "11204", "type": "secondary" }',
      response: '{ "targets": [ { "target_id": "11204", "target": "semaglutide", "ref_source_type": "clinical", "alert_type": "serious", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_onoff_target": "on", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31" } ] }'
    },
    {
      description: 'Get targets by adverse event id',
      usage: '{ "adverse_event_id": "10001551" }',
      response: '{ "targets": [ { "target_id": "158", "target": "ALK", "ref_source_type": "clinical", "alert_type": "serious", "alert_phase": "postmarketing", "alert_level_evidence": "A", "alert_onoff_target": "on", "alert_severity": "severe", "alert_causality": "unknown", "alert_species": "human", "alert_date_from": "2020-01-01", "alert_date_to": "2020-12-31" } ] }'
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

function validateCommaSeparatedNumbers(param: any, fieldName: string) {
  if (param === undefined || param === null || param === '') return;
  if (typeof param === 'number') return;
  if (typeof param === 'string') {
    if (!/^\d+(,\d+)*$/.test(param)) {
      throw new Error(`${fieldName} must be a number or a comma-separated list of numbers (e.g., 1,2,3)`);
    }
    return;
  }
  throw new Error(`${fieldName} must be a number or a comma-separated list of numbers (e.g., 1,2,3)`);
}

function validateStringEnum(param: any, fieldName: string, allowed: string[]) {
  if (param === undefined || param === null || param === '') return;
  if (typeof param !== 'string' || !allowed.includes(param)) {
    throw new Error(`${fieldName} must be one of: ${allowed.join(', ')}`);
  }
}

function validateNumber(param: any, fieldName: string) {
  if (param === undefined || param === null) return;
  if (typeof param !== 'number') {
    throw new Error(`${fieldName} must be a number`);
  }
}

async function getAlerts(params: {
  drug_id?: string | number,
  target_id?: string | number,
  action_id?: string | number,
  page?: number,
  adverse_event_id?: string | number,
  ref_source_type?: string | number,
  alert_type?: string | number,
  alert_phase?: string | number,
  alert_level_evidence?: string | number,
  alert_onoff_target?: string | number,
  alert_severity?: string,
  alert_causality?: string,
  alert_species?: string,
  alert_date_from?: string,
  alert_date_to?: string,
  order_by_date?: string,
  order_by_adv?: string
}) {
  // Validate numeric filter fields
  validateCommaSeparatedNumbers(params.drug_id, 'drug_id');
  validateCommaSeparatedNumbers(params.target_id, 'target_id');
  validateCommaSeparatedNumbers(params.action_id, 'action_id');
  validateNumber(params.page, 'page');
  validateCommaSeparatedNumbers(params.adverse_event_id, 'adverse_event_id');
  validateCommaSeparatedNumbers(params.ref_source_type, 'ref_source_type');
  validateCommaSeparatedNumbers(params.alert_type, 'alert_type');
  validateCommaSeparatedNumbers(params.alert_phase, 'alert_phase');
  validateCommaSeparatedNumbers(params.alert_level_evidence, 'alert_level_evidence');
  validateCommaSeparatedNumbers(params.alert_onoff_target, 'alert_onoff_target');
  // Validate enums
  if (params.alert_severity !== undefined) {
    validateStringEnum(params.alert_severity, 'alert_severity', ['yes', 'no']);
  }
  if (params.order_by_date !== undefined) {
    validateStringEnum(params.order_by_date, 'order_by_date', ['desc', 'asc']);
  }
  if (params.order_by_adv !== undefined) {
    validateStringEnum(params.order_by_adv, 'order_by_adv', ['desc', 'asc']);
  }
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
  drug_id: string | number,
  page: number,
  adverse_event_id?: string | number,
  ref_source_type?: string | number,
  alert_type?: string | number,
  alert_phase?: string | number,
  alert_level_evidence?: string | number,
  alert_severity?: string,
  alert_causality?: string,
  alert_species?: string,
  alert_date_from?: string,
  alert_date_to?: string
}) {
  validateCommaSeparatedNumbers(params.drug_id, 'drug_id');
  validateNumber(params.page, 'page');
  validateCommaSeparatedNumbers(params.adverse_event_id, 'adverse_event_id');
  validateCommaSeparatedNumbers(params.ref_source_type, 'ref_source_type');
  validateCommaSeparatedNumbers(params.alert_type, 'alert_type');
  validateCommaSeparatedNumbers(params.alert_phase, 'alert_phase');
  validateCommaSeparatedNumbers(params.alert_level_evidence, 'alert_level_evidence');
  if (params.alert_severity !== undefined) {
    validateStringEnum(params.alert_severity, 'alert_severity', ['yes', 'no']);
  }
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
  target_id: string | number,
  action_id: string | number,
  page?: number,
  adverse_event_id?: string | number,
  ref_source_type?: string | number,
  alert_type?: string | number,
  alert_phase?: string | number,
  alert_level_evidence?: string | number,
  alert_onoff_target?: string | number,
  alert_severity?: string,
  alert_causality?: string,
  alert_species?: string,
  alert_date_from?: string,
  alert_date_to?: string
}) {
  validateCommaSeparatedNumbers(params.target_id, 'target_id');
  validateCommaSeparatedNumbers(params.action_id, 'action_id');
  validateNumber(params.page, 'page');
  validateCommaSeparatedNumbers(params.adverse_event_id, 'adverse_event_id');
  validateCommaSeparatedNumbers(params.ref_source_type, 'ref_source_type');
  validateCommaSeparatedNumbers(params.alert_type, 'alert_type');
  validateCommaSeparatedNumbers(params.alert_phase, 'alert_phase');
  validateCommaSeparatedNumbers(params.alert_level_evidence, 'alert_level_evidence');
  validateCommaSeparatedNumbers(params.alert_onoff_target, 'alert_onoff_target');
  if (params.alert_severity !== undefined) {
    validateStringEnum(params.alert_severity, 'alert_severity', ['yes', 'no']);
  }
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

// Unified error response helper
function sendError(res: http.ServerResponse, message: string, code: number = 400) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message, code }));
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
      const method = req.method || '';
      const url = req.url || '';

      // Health check endpoint
      if (method === 'GET' && url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // List tools endpoint
      if (method === 'POST' && url === '/list_tools') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          tools: [
            {
              name: 'search_drugs',
              description: SEARCH_DRUGS_TOOL.description,
              schema: [
                { name: 'drug', type: 'string', description: 'Drug name (required)' }
              ]
            },
            {
              name: 'get_drugs',
              description: GET_DRUGS_TOOL.description,
              schema: [
                { name: 'target_id', type: 'string', description: 'Target identifier (OFFX target_id)' },
                { name: 'action_id', type: 'string', description: 'Action identifier (OFFX action_id)' },
                { name: 'adverse_event_id', type: 'string', description: 'Adverse event identifier (OFFX adverse_event_id)' },
                { name: 'page', type: 'number', description: 'Page number (default: 1)', default: 1 }
              ]
            },
            {
              name: 'get_alerts',
              description: GET_ALERTS_TOOL.description,
              schema: [
                { name: 'drug_id', type: 'string', description: 'Drug identifier (OFFX drug_id, optional)' },
                { name: 'target_id', type: 'string', description: 'Target identifier (OFFX target_id, optional)' },
                { name: 'action_id', type: 'string', description: 'Action ID (optional, for target alerts)' },
                { name: 'page', type: 'number', description: 'Page number (required)' },
                { name: 'adverse_event_id', type: 'string', description: 'Adverse Event ID (optional)' },
                { name: 'ref_source_type', type: 'string', description: 'Reference source type (optional, comma separated number)',
                  enum: ['9','10','11','27','24','22','23','25','12','13','14','15','16','17','18','19','20','21','26'],
                  enumDescriptions: {
                    '9': 'Congress', '10': 'Website Reference', '11': 'Company Communication', '27': 'Health Organization', '24': 'Database', '22': 'DailyMed', '23': 'Regulatory Agency Briefing', '25': 'Patent', '12': 'Medical Society Communication', '13': 'Research Institution Communication', '14': 'Regulatory Agency Communication', '15': 'Regulatory Agency Guideline', '16': 'Patient Advocacy Group communication', '17': 'Other', '18': 'Book', '19': 'Journal', '20': 'Congress Alert', '21': 'Congress & Conferences', '26': 'Clinical Trial Registry'
                  },
                  format: 'Comma separated number(s), e.g. 9 or 9,10,11'
                },
                { name: 'alert_type', type: 'string', description: 'Alert Type (optional, comma separated number): 1 = Class Alert, 2 = Drug Alert, 1,2 = both', enum: ['1','2','1,2'], enumDescriptions: { '1': 'Class Alert', '2': 'Drug Alert', '1,2': 'Both' }, format: 'Comma separated number(s), e.g. 1 or 1,2', examples: ['1','2','1,2'] },
                { name: 'alert_phase', type: 'string', description: 'Alert Phase (optional, comma separated number)',
                  enum: ['1','2','3','4','5','6','7','8','9','10','11','12'],
                  enumDescriptions: {
                    '1': 'Clinical/Postmarketing', '2': 'Preclinical', '3': 'Clinical', '4': 'Postmarketing', '5': 'Target Discovery', '6': 'Phase I', '7': 'Phase II', '8': 'Phase III', '9': 'Phase IV', '10': 'Phase I/II', '11': 'Phase II/III', '12': 'Phase III/IV'
                  },
                  format: 'Comma separated number(s), e.g. 1 or 1,2,3',
                  examples: ['1','1,2','1,2,3,4,5,6']
                },
                { name: 'alert_level_evidence', type: 'string', description: 'Level of evidence (optional, comma separated number)',
                  enum: ['1','2','3'],
                  enumDescriptions: { '1': 'Confirmed/Reported', '2': 'Suspected', '3': 'Refuted/Not Associated' },
                  format: 'Comma separated number(s), e.g. 1 or 1,2',
                  examples: ['1','2','1,2']
                },
                { name: 'alert_onoff_target', type: 'string', description: 'On/Off target (optional, comma separated number)',
                  enum: ['1','2','3'],
                  enumDescriptions: { '1': 'On-Target', '2': 'Off-Target', '3': 'Not Specified' },
                  format: 'Comma separated number(s), e.g. 1 or 1,2',
                  examples: ['1','2','1,2']
                },
                { name: 'alert_severity', type: 'string', description: 'Alert Severity (optional, string: yes or no)', enum: ['yes','no'], examples: ['yes','no'] },
                { name: 'alert_causality', type: 'string', description: 'Alert Causality (optional)' },
                { name: 'alert_species', type: 'string', description: 'Alert Species (optional)' },
                { name: 'alert_date_from', type: 'string', description: 'Date from (optional, YYYY-MM-DD)' },
                { name: 'alert_date_to', type: 'string', description: 'Date to (optional, YYYY-MM-DD)' },
                { name: 'order_by_date', type: 'string', description: 'Order by date (optional)' },
                { name: 'order_by_adv', type: 'string', description: 'Order by adverse event (optional)' }
              ]
            },
            {
              name: 'get_score',
              description: GET_SCORE_TOOL.description,
              schema: [
                { name: 'drug_id', type: 'string', description: 'Drug identifier (OFFX drug_id, required for drug score)' },
                { name: 'adverse_event_id', type: 'string', description: 'Adverse event identifier (optional)' },
                { name: 'target_id', type: 'string', description: 'Target identifier (OFFX target_id, required for target/class score)' },
                { name: 'action_id', type: 'string', description: 'Action identifier (OFFX action_id, required for target/class score)' }
              ]
            },
            {
              name: 'get_drug',
              description: GET_DRUG_TOOL.description,
              schema: [
                { name: 'drug_id', type: 'string', description: 'Drug identifier (OFFX drug_id, required)' },
                { name: 'page', type: 'number', description: 'Page number (required)' },
                { name: 'adverse_event_id', type: 'string', description: 'Adverse Event ID (optional)' },
                { name: 'ref_source_type', type: 'string', description: 'Reference source type (optional, comma separated number)',
                  enum: ['9','10','11','27','24','22','23','25','12','13','14','15','16','17','18','19','20','21','26'],
                  enumDescriptions: {
                    '9': 'Congress', '10': 'Website Reference', '11': 'Company Communication', '27': 'Health Organization', '24': 'Database', '22': 'DailyMed', '23': 'Regulatory Agency Briefing', '25': 'Patent', '12': 'Medical Society Communication', '13': 'Research Institution Communication', '14': 'Regulatory Agency Communication', '15': 'Regulatory Agency Guideline', '16': 'Patient Advocacy Group communication', '17': 'Other', '18': 'Book', '19': 'Journal', '20': 'Congress Alert', '21': 'Congress & Conferences', '26': 'Clinical Trial Registry'
                  },
                  format: 'Comma separated number(s), e.g. 9 or 9,10,11'
                },
                { name: 'alert_type', type: 'string', description: 'Alert Type (optional, comma separated number): 1 = Class Alert, 2 = Drug Alert, 1,2 = both', enum: ['1','2','1,2'], enumDescriptions: { '1': 'Class Alert', '2': 'Drug Alert', '1,2': 'Both' }, format: 'Comma separated number(s), e.g. 1 or 1,2', examples: ['1','2','1,2'] },
                { name: 'alert_phase', type: 'string', description: 'Alert Phase (optional, comma separated number)',
                  enum: ['1','2','3','4','5','6','7','8','9','10','11','12'],
                  enumDescriptions: {
                    '1': 'Clinical/Postmarketing', '2': 'Preclinical', '3': 'Clinical', '4': 'Postmarketing', '5': 'Target Discovery', '6': 'Phase I', '7': 'Phase II', '8': 'Phase III', '9': 'Phase IV', '10': 'Phase I/II', '11': 'Phase II/III', '12': 'Phase III/IV'
                  },
                  format: 'Comma separated number(s), e.g. 1 or 1,2,3',
                  examples: ['1','1,2','1,2,3,4,5,6']
                },
                { name: 'alert_level_evidence', type: 'string', description: 'Level of evidence (optional, comma separated number)',
                  enum: ['1','2','3'],
                  enumDescriptions: { '1': 'Confirmed/Reported', '2': 'Suspected', '3': 'Refuted/Not Associated' },
                  format: 'Comma separated number(s), e.g. 1 or 1,2',
                  examples: ['1','2','1,2']
                },
                { name: 'alert_severity', type: 'string', description: 'Alert Severity (optional, string: yes or no)', enum: ['yes','no'], examples: ['yes','no'] },
                { name: 'alert_causality', type: 'string', description: 'Alert Causality (optional)' },
                { name: 'alert_species', type: 'string', description: 'Alert Species (optional)' },
                { name: 'alert_date_from', type: 'string', description: 'Date from (optional, YYYY-MM-DD)' },
                { name: 'alert_date_to', type: 'string', description: 'Date to (optional, YYYY-MM-DD)' }
              ]
            },
            {
              name: 'search_adverse_events',
              description: SEARCH_ADVERSE_EVENTS_TOOL.description,
              schema: [
                { name: 'adverse_event', type: 'string', description: 'Adverse event name (min 3 chars, required)' }
              ]
            },
            {
              name: 'get_adverse_events',
              description: GET_ADVERSE_EVENTS_TOOL.description,
              schema: [
                { name: 'drug_id', type: 'string', description: 'Drug identifier (OFFX drug_id, optional)' },
                { name: 'target_id', type: 'string', description: 'Target identifier (OFFX target_id, optional)' }
              ]
            },
            {
              name: 'search_targets',
              description: SEARCH_TARGETS_TOOL.description,
              schema: [
                { name: 'target', type: 'string', description: 'Target name (required)' }
              ]
            },
            {
              name: 'get_target',
              description: GET_TARGET_TOOL.description,
              schema: [
                { name: 'target_id', type: 'string', description: 'Target identifier (OFFX target_id, required)' },
                { name: 'action_id', type: 'string', description: 'Action identifier (OFFX action_id, required)' },
                { name: 'page', type: 'number', description: 'Page number (required)' },
                { name: 'adverse_event_id', type: 'string', description: 'Adverse Event ID (optional)' },
                { name: 'ref_source_type', type: 'string', description: 'Reference source type (optional, comma separated number)',
                  enum: ['9','10','11','27','24','22','23','25','12','13','14','15','16','17','18','19','20','21','26'],
                  enumDescriptions: {
                    '9': 'Congress', '10': 'Website Reference', '11': 'Company Communication', '27': 'Health Organization', '24': 'Database', '22': 'DailyMed', '23': 'Regulatory Agency Briefing', '25': 'Patent', '12': 'Medical Society Communication', '13': 'Research Institution Communication', '14': 'Regulatory Agency Communication', '15': 'Regulatory Agency Guideline', '16': 'Patient Advocacy Group communication', '17': 'Other', '18': 'Book', '19': 'Journal', '20': 'Congress Alert', '21': 'Congress & Conferences', '26': 'Clinical Trial Registry'
                  },
                  format: 'Comma separated number(s), e.g. 9 or 9,10,11'
                },
                { name: 'alert_type', type: 'string', description: 'Alert Type (optional, comma separated number): 1 = Class Alert, 2 = Drug Alert, 1,2 = both', enum: ['1','2','1,2'], enumDescriptions: { '1': 'Class Alert', '2': 'Drug Alert', '1,2': 'Both' }, format: 'Comma separated number(s), e.g. 1 or 1,2', examples: ['1','2','1,2'] },
                { name: 'alert_phase', type: 'string', description: 'Alert Phase (optional, comma separated number)',
                  enum: ['1','2','3','4','5','6','7','8','9','10','11','12'],
                  enumDescriptions: {
                    '1': 'Clinical/Postmarketing', '2': 'Preclinical', '3': 'Clinical', '4': 'Postmarketing', '5': 'Target Discovery', '6': 'Phase I', '7': 'Phase II', '8': 'Phase III', '9': 'Phase IV', '10': 'Phase I/II', '11': 'Phase II/III', '12': 'Phase III/IV'
                  },
                  format: 'Comma separated number(s), e.g. 1 or 1,2,3',
                  examples: ['1','1,2','1,2,3,4,5,6']
                },
                { name: 'alert_level_evidence', type: 'string', description: 'Level of evidence (optional, comma separated number)',
                  enum: ['1','2','3'],
                  enumDescriptions: { '1': 'Confirmed/Reported', '2': 'Suspected', '3': 'Refuted/Not Associated' },
                  format: 'Comma separated number(s), e.g. 1 or 1,2',
                  examples: ['1','2','1,2']
                },
                { name: 'alert_onoff_target', type: 'string', description: 'On/Off target (optional, comma separated number)',
                  enum: ['1','2','3'],
                  enumDescriptions: { '1': 'On-Target', '2': 'Off-Target', '3': 'Not Specified' },
                  format: 'Comma separated number(s), e.g. 1 or 1,2',
                  examples: ['1','2','1,2']
                },
                { name: 'alert_severity', type: 'string', description: 'Alert Severity (optional, string: yes or no)', enum: ['yes','no'], examples: ['yes','no'] },
                { name: 'alert_causality', type: 'string', description: 'Alert Causality (optional)' },
                { name: 'alert_species', type: 'string', description: 'Alert Species (optional)' },
                { name: 'alert_date_from', type: 'string', description: 'Date from (optional, YYYY-MM-DD)' },
                { name: 'alert_date_to', type: 'string', description: 'Date to (optional, YYYY-MM-DD)' },
                { name: 'order_by_date', type: 'string', description: 'Order by date (optional)' },
                { name: 'order_by_adv', type: 'string', description: 'Order by adverse event (optional)' }
              ]
            },
            {
              name: 'get_targets',
              description: GET_TARGETS_TOOL.description,
              schema: [
                { name: 'drug_id', type: 'string', description: 'Drug identifier (OFFX drug_id, required for primary/secondary targets)' },
                { name: 'type', type: 'string', enum: ['primary', 'secondary'], description: 'Type of targets to fetch: "primary" or "secondary" (required if drug_id is used)' },
                { name: 'adverse_event_id', type: 'string', description: 'Adverse event identifier (OFFX adverse_event_id, required for adverse event search)' }
              ]
            }
          ]
        }));
        return;
      }

      // Helper to parse JSON body
      const parseBody = (req: http.IncomingMessage) => new Promise<any>((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });

      // Routing for all tools
      if (method === 'POST') {
        let data: any;
        let result: any;
        try {
          data = await parseBody(req);
          const url = req.url || '';
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
            sendError(res, 'Not found', 404);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          sendError(res, err instanceof Error ? err.message : String(err));
        }
      } else {
        sendError(res, 'Not found', 404);
      }
    });
    server.listen(PORT, () => {
      console.log(`OFFX MCP Server running on http://localhost:${PORT}`);
    });
    return;
  }
  // MCP mode (stdio only)
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
    const args = request.params.arguments;
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
  console.log('OFFX MCP Server running in MCP stdio mode');
}

runServer().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
