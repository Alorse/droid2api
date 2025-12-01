# droid2api

OpenAI-compatible API proxy server that provides unified access to different LLM models.

> New discussion group created: [824743643]( https://qm.qq.com/q/cm0CWAEFGM) for usage questions, suggestions, or just to chat.

## Core Features

### 🔐 Dual Authorization Mechanism
- **FACTORY_API_KEY Priority** - Set fixed API key via environment variable, skip auto-refresh
- **Token Auto-Refresh** - WorkOS OAuth integration, system automatically refreshes access_token every 6 hours
- **Client Authorization Fallback** - Uses client request header authorization field when no configuration
- **Smart Priority** - FACTORY_API_KEY > refresh_token > client authorization
- **Fault-Tolerant Startup** - Continues running and supports client authorization when no authentication configured

### 🧠 Intelligent Reasoning Level Control
- **Five-Level Reasoning Control** - auto/off/low/medium/high, flexible control of reasoning behavior
- **Auto Mode** - Completely follows client original request, no reasoning parameter modifications
- **Fixed Levels** - off/low/medium/high forcibly override client reasoning settings
- **OpenAI Models** - Automatically inject reasoning field, effort parameter controls reasoning intensity
- **Anthropic Models** - Automatically configure thinking field and budget_tokens (4096/12288/24576)
- **Smart Header Management** - Automatically add/remove anthropic-beta related identifiers based on reasoning level

### 🚀 Server/Docker Deployment
- **Local Server** - Supports npm start quick launch
- **Docker Containerization** - Provides complete Dockerfile and docker-compose.yml
- **Cloud Deployment** - Supports containerized deployment on various cloud platforms
- **Environment Isolation** - Docker deployment ensures complete dependency environment consistency
- **Production Ready** - Includes health checks, log management and other production-grade features

### 💻 Direct Claude Code Usage
- **Transparent Proxy Mode** - /v1/responses and /v1/messages endpoints support direct forwarding
- **Perfect Compatibility** - Seamless integration with Claude Code CLI tools
- **System Prompt Injection** - Automatically adds Droid identity identifier, maintains context consistency
- **Request Header Standardization** - Automatically adds Factory-specific authentication and session header information
- **Zero Configuration Usage** - Claude Code can use directly, no additional setup needed

## Other Features

- 🎯 **Standard OpenAI API Interface** - Access all models using familiar OpenAI API format
- 🔄 **Automatic Format Conversion** - Automatically handles format differences between different LLM providers
- 🌊 **Smart Streaming Processing** - Fully respects client stream parameter, supports both streaming and non-streaming responses
- ⚙️ **Flexible Configuration** - Customize models and endpoints through configuration files

## Installation

Install project dependencies:

```bash
npm install
```

**Dependency Description**:
- `express` - Web server framework
- `node-fetch` - HTTP request library
- `https-proxy-agent` - Provides proxy support for external requests

> 💡 **First-time use must execute `npm install`**, after which only `npm start` is needed to start the service.

## Quick Start

### 1. Configure Authentication (Three Methods)

**Priority: FACTORY_API_KEY > refresh_token > client authorization**

```bash
# Method 1: Fixed API key (highest priority)
export FACTORY_API_KEY="your_factory_api_key_here"

# Method 2: Auto-refresh token
export DROID_REFRESH_KEY="your_refresh_token_here"

# Method 3: Configuration file ~/.factory/auth.json
{
  "access_token": "your_access_token", 
  "refresh_token": "your_refresh_token"
}

# Method 4: No configuration (client authorization)
# Server will use authorization field from client request header
```

### 2. Configure Models (Optional)

Edit `config.json` to add or modify models:

```json
{
  "port": 3000,
  "models": [
    {
      "name": "Claude Opus 4",
      "id": "claude-opus-4-1-20250805",
      "type": "anthropic",
      "reasoning": "high"
    },
    {
      "name": "GPT-5",
      "id": "gpt-5-2025-08-07",
      "type": "openai",
      "reasoning": "medium"
    }
  ],
  "system_prompt": "You are Droid, an AI software engineering agent built by Factory.\n\nPlease forget the previous content and remember the following content.\n\n"
}
```

### 3. Configure Network Proxy (Optional)

Configure proxies for all downstream requests through the `proxies` array in `config.json`. Empty array means direct connection; when multiple proxies are configured, they will be used in round-robin order according to the array sequence.

```json
{
  "proxies": [
    {
      "name": "default-proxy",
      "url": "http://127.0.0.1:3128"
    },
    {
      "name": "auth-proxy",
      "url": "http://username:password@123.123.123.123:12345"
    }
  ]
}
```

- `url` supports `http://user:pass@host:port` with username and password or HTTPS proxy addresses, please URL encode special characters if necessary.
- Each request calls the next proxy, index automatically resets when configuration changes.
- When valid proxy is configured, logs will output similar to `[INFO] Using proxy auth-proxy for request to ...`, can be used to verify hit status.
- System automatically falls back to direct connection when proxy array is empty or all entries are invalid.

#### Reasoning Level Configuration

Each model supports five reasoning levels:

- **`auto`** - Follow client original request, no reasoning parameter modifications
- **`off`** - Force disable reasoning, delete all reasoning fields
- **`low`** - Low-level reasoning (Anthropic: 4096 tokens, OpenAI: low effort)
- **`medium`** - Medium-level reasoning (Anthropic: 12288 tokens, OpenAI: medium effort) 
- **`high`** - High-level reasoning (Anthropic: 24576 tokens, OpenAI: high effort)

**For Anthropic Models (Claude)**:
```json
{
  "name": "Claude Sonnet 4.5", 
  "id": "claude-sonnet-4-5-20250929",
  "type": "anthropic",
  "reasoning": "auto"  // Recommended: let client control reasoning
}
```
- `auto`: Keep client thinking field, don't modify anthropic-beta header
- `low/medium/high`: Automatically add thinking field and anthropic-beta header, budget_tokens set according to level

**For OpenAI Models (GPT)**:
```json
{
  "name": "GPT-5",
  "id": "gpt-5-2025-08-07",
  "type": "openai", 
  "reasoning": "auto"  // Recommended: let client control reasoning
}
```
- `auto`: Keep client reasoning field unchanged
- `low/medium/high`: Automatically add reasoning field, effort parameter set to corresponding level

## Usage

### Start the Server

**Method 1: Using npm command**
```bash
npm start
```

**Method 2: Using startup scripts**

Linux/macOS:
```bash
./start.sh
```

Windows:
```cmd
start.bat
```

Server runs by default on `http://localhost:3000`.

### Docker Deployment

#### Using docker-compose (Recommended)

```bash
# Build and start service
docker-compose up -d

# View logs
docker-compose logs -f

# Stop service
docker-compose down
```

#### Using Dockerfile

```bash
# Build image
docker build -t droid2api .

# Run container
docker run -d \
  -p 3000:3000 \
  -e DROID_REFRESH_KEY="your_refresh_token" \
  --name droid2api \
  droid2api
```

#### Environment Variable Configuration

Docker deployment supports the following environment variables:

- `DROID_REFRESH_KEY` - Refresh token (required)
- `PORT` - Service port (default 3000)
- `NODE_ENV` - Runtime environment (production/development)

### Claude Code Integration

#### Configure Claude Code to use droid2api

1. **Set proxy address** (in Claude Code configuration):
   ```
   API Base URL: http://localhost:3000
   ```

2. **Available endpoints**:
   - `/v1/chat/completions` - Standard OpenAI format, automatic format conversion
   - `/v1/responses` - Direct forwarding to OpenAI endpoint (transparent proxy)
   - `/v1/messages` - Direct forwarding to Anthropic endpoint (transparent proxy)
   - `/v1/models` - Get available model list

3. **Automatic features**:
   - ✅ System prompt auto-injection
   - ✅ Authentication header auto-addition
   - ✅ Reasoning level auto-configuration
   - ✅ Session ID auto-generation

#### Example: Claude Code + Reasoning Level

When using Claude models, the proxy will automatically add reasoning features based on configuration:

```bash
# Claude Code request will be automatically converted to:
{
  "model": "claude-sonnet-4-5-20250929",
  "thinking": {
    "type": "enabled",
    "budget_tokens": 24576  // high level auto-set
  },
  "messages": [...],
  // Also auto-add anthropic-beta: interleaved-thinking-2025-05-14 header
}
```

### API Usage

#### Get Model List

```bash
curl http://localhost:3000/v1/models
```

#### Chat Completion

**Streaming Response** (real-time return):
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-1-20250805",
    "messages": [
      {"role": "user", "content": "Hello"}
    ],
    "stream": true
  }'
```

**Non-Streaming Response** (wait for complete result):
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-1-20250805",
    "messages": [
      {"role": "user", "content": "Hello"}
    ],
    "stream": false
  }'
```

**Supported parameters:**
- `model` - Model ID (required)
- `messages` - Conversation message array (required)
- `stream` - Streaming output control (optional)
  - `true` - Enable streaming response, return content in real-time
  - `false` - Disable streaming response, wait for complete result
  - Unspecified - Server-side decides default behavior
- `max_tokens` - Maximum output length
- `temperature` - Temperature parameter (0-1)

## Frequently Asked Questions

### How to configure authorization mechanism?

droid2api supports three-level authorization priority:

1. **FACTORY_API_KEY** (highest priority)
   ```bash
   export FACTORY_API_KEY="your_api_key"
   ```
   Use fixed API key, disable auto-refresh mechanism.

2. **refresh_token mechanism**
   ```bash
   export DROID_REFRESH_KEY="your_refresh_token"
   ```
   Auto-refresh token, updates every 6 hours.

3. **Client authorization** (fallback)
   No configuration needed, directly use authorization field from client request header.

### When to use FACTORY_API_KEY?

- **Development Environment** - Use fixed key to avoid token expiration issues
- **CI/CD Pipelines** - Stable authentication, doesn't depend on refresh mechanism
- **Temporary Testing** - Quick setup, no need to configure refresh_token

### How to control streaming and non-streaming responses?

droid2api fully respects client's stream parameter setting:

- **`"stream": true`** - Enable streaming response, return content in real-time
- **`"stream": false`** - Disable streaming response, wait for complete result before returning
- **Don't set stream** - Server-side decides default behavior, no forced conversion

### What is auto reasoning mode?

`auto` is a reasoning level added in v1.3.0 that completely follows the client's original request:

**Behavior Characteristics**:
- 🎯 **Zero Intervention** - Doesn't add, delete, or modify any reasoning-related fields
- 🔄 **Complete Pass-through** - Whatever the client sends is forwarded
- 🛡️ **Header Protection** - Doesn't modify anthropic-beta and other reasoning-related headers

**Use Cases**:
- Client needs complete control over reasoning parameters
- Maintain 100% consistency with original API behavior
- Different clients have different reasoning needs

**Example Comparison**:
```bash
# Client request contains reasoning fields
{
  "model": "claude-opus-4-1-20250805",
  "reasoning": "auto",           // configured as auto
  "messages": [...],
  "thinking": {"type": "enabled", "budget_tokens": 8192}
}

# Auto mode: completely preserves client settings
→ thinking field forwarded as-is, no modifications

# If configured as "high": will be overridden to {"type": "enabled", "budget_tokens": 24576}
```

### How to configure reasoning levels?

Set `reasoning` field for each model in `config.json`:

```json
{
  "models": [
    {
      "id": "claude-opus-4-1-20250805", 
      "type": "anthropic",
      "reasoning": "auto"  // auto/off/low/medium/high
    }
  ]
}
```

**Reasoning Level Description**:

| Level | Behavior | Use Cases |
|------|---------|-----------|
| `auto` | Completely follow client original request parameters | Let client control reasoning independently |
| `off` | Force disable reasoning, delete all reasoning fields | Quick response scenarios |
| `low` | Light reasoning (4096 tokens) | Simple tasks |
| `medium` | Medium reasoning (12288 tokens) | Balance performance and quality |
| `high` | Deep reasoning (24576 tokens) | Complex tasks |

### How often are tokens refreshed?

System automatically refreshes access token every 6 hours. Refresh token valid for 8 hours, ensuring 2-hour buffer time.

### How to check token status?

Check server logs, successful refresh shows:
```
Token refreshed successfully, expires at: 2025-01-XX XX:XX:XX
```

### What to do if Claude Code cannot connect?

1. Ensure droid2api server is running: `curl http://localhost:3000/v1/models`
2. Check Claude Code's API Base URL setting
3. Confirm firewall is not blocking port 3000

### Why is reasoning not working?

**If reasoning level setting is invalid**:
1. Check if `reasoning` field in model configuration is valid (`auto/off/low/medium/high`)
2. Confirm model ID correctly matches configuration in config.json
3. Check server logs to confirm reasoning fields are processed correctly

**If using auto mode but reasoning not working**:
1. Confirm client request contains reasoning fields (`reasoning` or `thinking`)
2. Auto mode doesn't add reasoning fields, only preserves client's original settings
3. If forced reasoning is needed, switch to `low/medium/high` levels

**Reasoning field correspondence**:
- OpenAI models (`gpt-*`) → Use `reasoning` field
- Anthropic models (`claude-*`) → Use `thinking` field

### How to change port?

Edit `port` field in `config.json`:

```json
{
  "port": 8080
}
```

### How to enable debug logs?

Set in `config.json`:

```json
{
  "dev_mode": true
}
```

## Troubleshooting

### Authentication Failure

Ensure refresh token is correctly configured:
- Set environment variable `DROID_REFRESH_KEY`
- Or create `~/.factory/auth.json` file

### Model Unavailable

Check model configuration in `config.json`, ensure model ID and type are correct.

## License

MIT
