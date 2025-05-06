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

## Features
- Direct access to OFFX (Target Safety) drug and safety database
- Search by drug, adverse event, target, action, or name
- Retrieve alerts and scores for drugs
- Structured JSON responses
- Pagination support for large result sets

## Supported Formats

The following types are OFFX-API compatible:

| Field   | Format      | Comments                       |
|---------|-------------|--------------------------------|
| dates   | yyyy-mm-dd  | Specification ISO 8601         |
| strings | String      | No quotes needed in JSON       |
| numbers | Integer     | Only accepts integers          |

## Optional Filter Parameters

The following filters are OFFX-API compatible. For fields that accept multiple values, use comma-separated numbers (e.g., `adverse_event_id=10000059,10000081`).

| Field                | Format                  | Allowed Values/Comments                                                                                       |
|----------------------|-------------------------|--------------------------------------------------------------------------------------------------------------|
| Adverse Event        | Comma separated number  | Example: `adverse_event_id=10000059,10000081,10001761`                                                      |
| Alert Type           | Comma separated number  | 1 - Class Alert, 2 - Drug Alert                                                                             |
| Alert Phase          | Comma separated number  | 1 - Clinical/Postmarketing, 2 - Preclinical, 3 - Clinical, 4 - Postmarketing, 5 - Target Discovery, 6 - Phase I, 7 - Phase II, 8 - Phase III, 9 - Phase IV, 10 - Phase I/II, 11 - Phase II/III, 12 - Phase III/IV |
| Reference source type| Comma separated number  | 9 - Congress, 10 - Website Reference, 11 - Company Communication, 27 - Health Organization, 24 - Database, 22 - DailyMed, 23 - Regulatory Agency Briefing, 25 - Patent, 12 - Medical Society Communication, 13 - Research Institution Communication, 14 - Regulatory Agency Communication, 15 - Regulatory Agency Guideline, 16 - Patient Advocacy Group communication, 17 - Other, 18 - Book, 19 - Journal, 20 - Congress Alert, 21 - Congress & Conferences, 26 - Clinical Trial Registry |
| Level of evidence    | Comma separated number  | 1 - Confirmed/Reported, 2 - Suspected, 3 - Refuted/Not Associated                                           |
| On/Off Target        | Comma separated number  | 1 - On-Target, 2 - Off-Target, 3 - Not Specified                                                            |
| Alert Severity       | String                  | yes, no                                                                                                     |
| Ordering             | String                  | order_by_date=desc/asc, order_by_adv=desc/asc                                                               |

Refer to these tables when using filter parameters in the endpoints below.

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
     - `{ "target_id": "158", "action_id": "15", "page": 2, "alert_type": "2" }`

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
     - `{ "target_id": "158", "action_id": "15", "page": 2, "alert_type": "2" }`

5. `get_drug`
   - Get drug masterview by drug id (with optional filters)
   - Input: `{ drug_id: string, page: number, adverse_event_id?: string, ref_source_type?: string, alert_type?: string, alert_phase?: string, alert_level_evidence?: string, alert_severity?: string, alert_causality?: string, alert_species?: string, alert_date_from?: string, alert_date_to?: string }`
   - Examples:
     - `{ "drug_id": "11204", "page": 1 }`
     - `{ "drug_id": "11204", "page": 2, "alert_type": "2" }`

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
     - `{ "target_id": "158", "action_id": "15", "page": 2, "alert_type": "2" }`

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

> **Note:** See the Supported Formats and Optional Filter Parameters sections above for allowed values and formats for filter fields such as `adverse_event_id`, `alert_type`, `alert_phase`, `ref_source_type`, `alert_level_evidence`, `alert_onoff_target`, `alert_severity`, and ordering fields.

## HTTP API Endpoints

When running in HTTP mode (`USE_HTTP=true`), the following REST endpoints are available. All endpoints accept a POST request with a JSON body as described below:

1. `POST /search_drugs`
   - Search drugs by name
   - Body: `{ "drug": "semaglutide" }`

2. `POST /get_drugs`
   - Get drugs by both `target_id` and `action_id` (together), or by `adverse_event_id`
   - Body: `{ "target_id": "165", "action_id": "4" }` or `{ "adverse_event_id": "10001551" }`

3. `POST /get_alerts`
   - Get alerts for a drug (by `drug_id`) or a target (by `target_id`, with optional `action_id`)
   - Body: `{ "drug_id": "140448", "page": 1 }` or `{ "target_id": "165", "action_id": "4", "page": 1 }`

4. `POST /get_score`
   - Get drug score by `drug_id` (optionally with `adverse_event_id`), or target/class score by `target_id` and `action_id`
   - Body: `{ "drug_id": "140448" }` or `{ "target_id": "165", "action_id": "4" }`

5. `POST /get_drug`
   - Get drug masterview by `drug_id` (with optional filters)
   - Body: `{ "drug_id": "140448", "page": 1 }`

6. `POST /search_adverse_events`
   - Search adverse events by name (min 3 chars)
   - Body: `{ "adverse_event": "Anaemia" }`

7. `POST /get_adverse_events`
   - Get adverse events by `drug_id` or `target_id` (provide exactly one)
   - Body: `{ "drug_id": "140448" }` or `{ "target_id": "165" }`

8. `POST /search_targets`
   - Search targets by target name
   - Body: `{ "target": "GLP-1 receptor" }`

9. `POST /get_target`
   - Get target masterview by `target_id` and `action_id` (both required; with optional filters)
   - Body: `{ "target_id": "165", "action_id": "4", "page": 1 }`

10. `POST /get_targets`
    - Get primary or secondary targets for a drug by `drug_id`, or targets by `adverse_event_id`
    - Body: `{ "drug_id": "140448" }` (returns primary targets), `{ "drug_id": "140448", "type": "secondary" }`, or `{ "adverse_event_id": "10001551" }`

> **Note:** All endpoints return structured JSON responses. See the tool documentation above for detailed input requirements and response formats.

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

## Docker

```bash
docker build -t offx-mcp-server .
docker run -i --env-file .env offx-mcp-server
```

## License

This MCP server is licensed under the MIT License.

## Disclaimer

OFF-X™ is a commercial product and trademark of Clarivate Analytics. This MCP server requires valid OFF-X API credentials to function. To obtain credentials and learn more about OFF-X, please visit Clarivate's OFF-X page.

This project is not affiliated with, endorsed by, or sponsored by Clarivate Analytics. All product names, logos, and brands are property of their respective owners.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

> **Note:** For `alert_type`, use only numeric codes as a string:
>
> | Code | Alert Type   |
> |------|--------------|
> | 1    | Class Alert  |
> | 2    | Drug Alert   |
>
> You can specify more than one, e.g. `"alert_type": "1,2"`.