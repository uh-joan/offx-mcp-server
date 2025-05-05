# OFFX MCP Server

MCP Server for searching drugs, adverse events, alerts, and scores in the OFFX (Target Safety) database.

## Installation

```bash
# Using npm (if published)
npm install @uh-joan/offx-mcp-server
```

## Quick Start

1. Set up your environment variables:
```env
OFFX_API_TOKEN=your_offx_api_token
USE_HTTP=true  # Optional: run as HTTP server
PORT=3000      # Optional: specify port for HTTP server
```

2. Run the server:
```bash
# As MCP server
npx offx-mcp-server

# As HTTP server
USE_HTTP=true PORT=3000 npx offx-mcp-server
```

## Tools

1. `search_drugs`
   - Search drugs by name
   - Input: `{ drug: string }`
   - Example: `{ "drug": "everolimus" }`

2. `get_drugs`
   - Get drugs by **either** both `target_id` and `action_id` (together), **or** only `adverse_event_id` (not just one of target_id/action_id)
   - Input: `{ target_id?: string, action_id?: string, adverse_event_id?: string, page?: number }`
   - You must provide:
     - both `target_id` and `action_id` (for target/class search), **or**
     - only `adverse_event_id` (for adverse event search)
   - `page` defaults to 1 if not specified
   - Examples:
     - `{ "target_id": "123", "action_id": "456" }`
     - `{ "adverse_event_id": "10001551" }`

3. `get_alerts`
   - Get alerts for a drug (by `drug_id`) or a target (by `target_id`, with optional `action_id`)
   - Input: `{ drug_id?: string, target_id?: string, action_id?: string, page?: number, adverse_event_id?: string, ref_source_type?: string, alert_type?: string, alert_phase?: string, alert_level_evidence?: string, alert_onoff_target?: string, alert_severity?: string, alert_causality?: string, alert_species?: string, alert_date_from?: string, alert_date_to?: string, order_by_date?: string, order_by_adv?: string }`
   - Requirements:
     - You must provide **exactly one** of: `drug_id` or `target_id` (not both, not neither)
     - For drug alerts: `drug_id` is **required**
     - For target alerts: `target_id` is **required**, `action_id` is optional
     - `page` is required but defaults to 1 if not specified
   - Examples:
     - `{ "drug_id": "11204", "page": 1 }`
     - `{ "target_id": "158", "page": 1 }`
     - `{ "target_id": "158", "action_id": "15", "page": 2, "alert_type": "serious" }`

4. `get_score`
   - Get drug score by `drug_id` (and optionally `adverse_event_id`), **or** get target/class score by `target_id` and `action_id` (and optionally `adverse_event_id`)
   - Input: `{ drug_id?: string, adverse_event_id?: string, target_id?: string, action_id?: string }`
   - Requirements:
     - You must provide **either** `drug_id` (alone), **or** both `target_id` and `action_id` (together)
     - Do **not** provide neither, all, or just one of `target_id`/`action_id`
   - Examples:
     - `{ "drug_id": "99402" }`
     - `{ "drug_id": "99402", "adverse_event_id": "10001551" }`
     - `{ "target_id": "158", "action_id": "15" }`
     - `{ "target_id": "158", "action_id": "15", "adverse_event_id": "10001551" }`

5. `get_drug`
   - Get drug masterview by drug id (with optional filters)
   - Input: `{ drug_id: string, page: number, adverse_event_id?: string, ref_source_type?: string, alert_type?: string, alert_phase?: string, alert_level_evidence?: string, alert_severity?: string, alert_causality?: string, alert_species?: string, alert_date_from?: string, alert_date_to?: string }`
   - Examples:
     - `{ "drug_id": "11204", "page": 1 }`
     - `{ "drug_id": "11204", "page": 2, "alert_type": "serious" }`

6. `search_adverse_events`
   - Search adverse events by name (min 3 chars)
   - Input: `{ adverse_event: string }`
   - Example: `{ "adverse_event": "Anaemia" }`

7. `get_adverse_events`
   - Get adverse events by drug id or target id (provide exactly one)
   - Input: `{ drug_id?: string, target_id?: string }`
   - Examples:
     - `{ "drug_id": "12345" }`
     - `{ "target_id": "67890" }`

8. `search_targets`
   - Search targets by target name
   - Input: `{ target: string }`
   - Example: `{ "target": "ALK" }`

9. `get_target`
   - Get target masterview by `target_id` and `action_id` (both required; with optional filters)
   - Input: `{ target_id: string, action_id: string, page?: number, adverse_event_id?: string, ref_source_type?: string, alert_type?: string, alert_phase?: string, alert_level_evidence?: string, alert_onoff_target?: string, alert_severity?: string, alert_causality?: string, alert_species?: string, alert_date_from?: string, alert_date_to?: string }`
   - Requirements:
     - Both `target_id` and `action_id` are **required**
     - `page` is optional and defaults to 1 if not specified
   - Examples:
     - `{ "target_id": "158", "action_id": "15" }`
     - `{ "target_id": "158", "action_id": "15", "page": 2, "alert_type": "serious" }`

10. `get_targets`
   - Get primary or secondary targets for a drug by `drug_id`, or targets by `adverse_event_id`
   - Input: `{ drug_id?: string, type?: 'primary' | 'secondary', adverse_event_id?: string }`
   - Requirements:
     - You must provide **exactly one** of: `drug_id` or `adverse_event_id` (not both, not neither)
     - If `drug_id` is provided and `type` is not specified, it defaults to `'primary'`
   - Returns:
     - `{ primary_targets: [...] }` or `{ secondary_targets: [...] }` (for drug search)
     - `{ targets: [...] }` (for adverse event search)
   - Examples:
     - `{ "drug_id": "11204" }` (returns primary targets)
     - `{ "drug_id": "11204", "type": "secondary" }`
     - `{ "adverse_event_id": "10001551" }`

## Features

- Direct access to OFFX (Target Safety) drug and safety database
- Search by drug, adverse event, target, action, or name
- Retrieve alerts and scores for drugs
- Structured JSON responses
- Pagination support for large result sets

## OFF-X Drug Score

The **OFF-X Drug Score** is a rule-based algorithm that summarizes the strength of evidence for a drug–adverse event association, based on all available safety alerts in OFF-X.

- **What it measures:** Strength and quality of evidence for a drug–adverse event association, considering all available alerts (regulatory, clinical, literature, etc.).
- **Key parameters:**
  - Number and type of alerts
  - Source and study type
  - Association reference and causality
  - Development phase
- **Qualitative labels:** Very High, High, Medium, Low, Not Associated, Class Evidence Only, Combination Evidence Only
- **Important notes:**
  - Does **not** imply causality, prevalence, or severity.
  - Lack of a score may reflect lack of published evidence, not lack of association.

## OFF-X Target/Class Score

The **OFF-X Target/Class Score** estimates the strength of evidence for an association between a class of drugs (sharing the same target action) and an adverse event, using all available class and drug-level alerts in OFF-X.

- **What it measures:** Evidence that an adverse event could be a class effect for drugs sharing a mechanism (target action).
- **Main use cases:**
  - Identifying emerging class liabilities
  - Comparing safety profiles for different targets
  - Deconvoluting toxicity mechanisms
  - Target safety assessment and off-target panel building
- **Key parameters:**
  - Number and type of class alerts
  - Source, study type, association reference, causality, development phase
  - Evidence from OFF-X Drug Scores of class members
  - % of drugs in the class associated with the adverse event
- **Qualitative labels:**
  - Very High: Strong evidence from both class alerts and drug scores
  - High: Strong evidence from either class alerts or drug scores
  - Medium: Growing evidence
  - Low/Very Low: Preliminary or scarce evidence
  - Not Associated: Evidence refutes the association
- **Important notes:**
  - Does **not** imply causality, prevalence, or severity.
  - Lack of a score may reflect lack of published evidence, not lack of association.
  - Score may be affected by data availability and coverage in OFF-X.

For more details, see the official OFF-X documentation or contact Clarivate.

## HTTP API Endpoints

When running in HTTP mode (USE_HTTP=true), the following REST endpoint is available:

1. `POST /search_drugs`
   - Search for adverse events for a drug by drug_id
   - Body: JSON object with `{ drug_id: string }`

> **Note:** Other endpoints are not yet implemented for HTTP mode. Use MCP mode for full tool support.

## Setup

### Environment Variables
The server requires an OFFX API token:

```env
OFFX_API_TOKEN=your_offx_api_token
```

### Installing on Claude Desktop
Before starting make sure [Node.js](https://nodejs.org/) is installed on your desktop for `npx` to work.
1. Go to: Settings > Developer > Edit Config

2. Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "offx": {
      "command": "npx",
      "args": [
        "-y",
        "@uh-joan/offx-mcp-server"
      ],
      "env": {
        "OFFX_API_TOKEN": "your_offx_api_token"
      }
    }
  }
}
```

3. Restart Claude Desktop and start exploring drug safety data!

## Build (for devs)

```bash
git clone https://github.com/uh-joan/offx-mcp-server.git
cd offx-mcp-server
npm install
npm run build
```

For local development:
```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your credentials
vim .env  # or use your preferred editor

# Start the server
npm run start
```