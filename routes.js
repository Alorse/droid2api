import express from 'express';
import fetch from 'node-fetch';
import { getConfig, getModelById, getEndpointByType, getSystemPrompt, getModelReasoning, getRedirectedModelId, getModelProvider } from './config.js';
import { logInfo, logDebug, logError, logRequest, logResponse } from './logger.js';
import { transformToAnthropic, getAnthropicHeaders } from './transformers/request-anthropic.js';
import { transformToOpenAI, getOpenAIHeaders } from './transformers/request-openai.js';
import { transformToCommon, getCommonHeaders } from './transformers/request-common.js';
import { AnthropicResponseTransformer } from './transformers/response-anthropic.js';
import { OpenAIResponseTransformer } from './transformers/response-openai.js';
import { getApiKey } from './auth.js';
import { getNextProxyAgent } from './proxy-manager.js';

const router = express.Router();

/**
 * Convert a /v1/responses API result to a /v1/chat/completions-compatible format.
 * Works for non-streaming responses.
 */
function convertResponseToChatCompletion(resp) {
  if (!resp || typeof resp !== 'object') {
    throw new Error('Invalid response object');
  }

  const outputMsg = (resp.output || []).find(o => o.type === 'message');
  const textBlocks = outputMsg?.content?.filter(c => c.type === 'output_text') || [];
  const content = textBlocks.map(c => c.text).join('');

  const chatCompletion = {
    id: resp.id ? resp.id.replace(/^resp_/, 'chatcmpl-') : `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: resp.created_at || Math.floor(Date.now() / 1000),
    model: resp.model || 'unknown-model',
    choices: [
      {
        index: 0,
        message: {
          role: outputMsg?.role || 'assistant',
          content: content || ''
        },
        finish_reason: resp.status === 'completed' ? 'stop' : 'unknown'
      }
    ],
    usage: {
      prompt_tokens: resp.usage?.input_tokens ?? 0,
      completion_tokens: resp.usage?.output_tokens ?? 0,
      total_tokens: resp.usage?.total_tokens ?? 0
    }
  };

  return chatCompletion;
}

router.get('/v1/models', (req, res) => {
  logInfo('GET /v1/models');
  
  try {
    const config = getConfig();
    const models = config.models.map(model => ({
      id: model.id,
      object: 'model',
      created: Date.now(),
      owned_by: model.type,
      permission: [],
      root: model.id,
      parent: null
    }));

    const response = {
      object: 'list',
      data: models
    };

    logResponse(200, null, response);
    res.json(response);
  } catch (error) {
    logError('Error in GET /v1/models', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Standard OpenAI chat completion handler (with format conversion)
async function handleChatCompletions(req, res) {
  logInfo('POST /v1/chat/completions');

  try {
    const openaiRequest = req.body;
    const modelId = getRedirectedModelId(openaiRequest.model);

    if (!modelId) {
      return res.status(400).json({ error: 'model is required' });
    }

    const model = getModelById(modelId);
    if (!model) {
      return res.status(404).json({ error: `Model ${modelId} not found` });
    }

    const endpoint = getEndpointByType(model.type);
    if (!endpoint) {
      return res.status(500).json({ error: `Endpoint type ${model.type} not found` });
    }

    logInfo(`Routing to ${model.type} endpoint: ${endpoint.base_url}`);

    // Get API key (will auto-refresh if needed)
    let authHeader;
    try {
      authHeader = await getApiKey(req.headers.authorization);
    } catch (error) {
      logError('Failed to get API key', error);
      return res.status(500).json({ 
        error: 'API key not available',
        message: 'Failed to get or refresh API key. Please check server logs.'
      });
    }

    let transformedRequest;
    let headers;
    const clientHeaders = req.headers;

    // Log received client headers for debugging
    logDebug('Client headers received', {
      'x-factory-client': clientHeaders['x-factory-client'],
      'x-session-id': clientHeaders['x-session-id'],
      'x-assistant-message-id': clientHeaders['x-assistant-message-id'],
      'user-agent': clientHeaders['user-agent']
    });

    // Update request body with redirected model ID before transformation
    const requestWithRedirectedModel = { ...openaiRequest, model: modelId };

    // Get provider from model config
    const provider = getModelProvider(modelId);

    if (model.type === 'anthropic') {
      transformedRequest = transformToAnthropic(requestWithRedirectedModel);
      const isStreaming = openaiRequest.stream === true;
      headers = getAnthropicHeaders(authHeader, clientHeaders, isStreaming, modelId, provider);
    } else if (model.type === 'openai') {
      transformedRequest = transformToOpenAI(requestWithRedirectedModel);
      headers = getOpenAIHeaders(authHeader, clientHeaders, provider);
    } else if (model.type === 'common') {
      transformedRequest = transformToCommon(requestWithRedirectedModel);
      headers = getCommonHeaders(authHeader, clientHeaders, provider);
    } else {
      return res.status(500).json({ error: `Unknown endpoint type: ${model.type}` });
    }

    logRequest('POST', endpoint.base_url, headers, transformedRequest);

    const proxyAgentInfo = getNextProxyAgent(endpoint.base_url);
    const fetchOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify(transformedRequest)
    };

    if (proxyAgentInfo?.agent) {
      fetchOptions.agent = proxyAgentInfo.agent;
    }

    const response = await fetch(endpoint.base_url, fetchOptions);

    logInfo(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logError(`Endpoint error: ${response.status}`, new Error(errorText));
      return res.status(response.status).json({ 
        error: `Endpoint returned ${response.status}`,
        details: errorText 
      });
    }

    const isStreaming = transformedRequest.stream === true;

    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // common type direct forwarding, don't use transformer
      if (model.type === 'common') {
        try {
          for await (const chunk of response.body) {
            res.write(chunk);
          }
          res.end();
          logInfo('Stream forwarded (common type)');
        } catch (streamError) {
          logError('Stream error', streamError);
          res.end();
        }
      } else {
        // anthropic and openai types use transformer
        let transformer;
        if (model.type === 'anthropic') {
          transformer = new AnthropicResponseTransformer(modelId, `chatcmpl-${Date.now()}`);
        } else if (model.type === 'openai') {
          transformer = new OpenAIResponseTransformer(modelId, `chatcmpl-${Date.now()}`);
        }

        try {
          for await (const chunk of transformer.transformStream(response.body)) {
            res.write(chunk);
          }
          res.end();
          logInfo('Stream completed');
        } catch (streamError) {
          logError('Stream error', streamError);
          res.end();
        }
      }
    } else {
      const data = await response.json();
      if (model.type === 'openai') {
        try {
          const converted = convertResponseToChatCompletion(data);
          logResponse(200, null, converted);
          res.json(converted);
        } catch (e) {
          // If conversion fails, fallback to original data
          logResponse(200, null, data);
          res.json(data);
        }
      } else {
        // anthropic/common: keep existing logic, direct forwarding
        logResponse(200, null, data);
        res.json(data);
      }
    }

  } catch (error) {
    logError('Error in /v1/chat/completions', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

// Direct forwarding OpenAI request (no format conversion)
async function handleDirectResponses(req, res) {
  logInfo('POST /v1/responses');

  try {
    const openaiRequest = req.body;
    const modelId = getRedirectedModelId(openaiRequest.model);

    if (!modelId) {
      return res.status(400).json({ error: 'model is required' });
    }

    const model = getModelById(modelId);
    if (!model) {
      return res.status(404).json({ error: `Model ${modelId} not found` });
    }

    // Only allow openai type endpoints
    if (model.type !== 'openai') {
      return res.status(400).json({ 
        error: 'Invalid endpoint type',
        message: `/v1/responses endpoint only supports openai type endpoints, current model ${modelId} is ${model.type} type`
      });
    }

    const endpoint = getEndpointByType(model.type);
    if (!endpoint) {
      return res.status(500).json({ error: `Endpoint type ${model.type} not found` });
    }

    logInfo(`Direct forwarding to ${model.type} endpoint: ${endpoint.base_url}`);

    // Get API key - support client x-api-key for anthropic endpoint
    let authHeader;
    try {
      const clientAuthFromXApiKey = req.headers['x-api-key']
        ? `Bearer ${req.headers['x-api-key']}`
        : null;
      authHeader = await getApiKey(req.headers.authorization || clientAuthFromXApiKey);
    } catch (error) {
      logError('Failed to get API key', error);
      return res.status(500).json({ 
        error: 'API key not available',
        message: 'Failed to get or refresh API key. Please check server logs.'
      });
    }

    const clientHeaders = req.headers;
    
    // Get provider from model config
    const provider = getModelProvider(modelId);
    
    // Get headers
    const headers = getOpenAIHeaders(authHeader, clientHeaders, provider);

    // Inject system prompt to instructions field, and update redirected model ID
    const systemPrompt = getSystemPrompt();
    const modifiedRequest = { ...openaiRequest, model: modelId };
    if (systemPrompt) {
      // If there are existing instructions, prepend system prompt
      if (modifiedRequest.instructions) {
        modifiedRequest.instructions = systemPrompt + modifiedRequest.instructions;
      } else {
        // Otherwise set system prompt directly
        modifiedRequest.instructions = systemPrompt;
      }
    }

    // Handle reasoning field
    const reasoningLevel = getModelReasoning(modelId);
    if (reasoningLevel === 'auto') {
      // Auto mode: keep original request's reasoning field unchanged
      // If original request has reasoning field, keep it; otherwise don't add one
    } else if (reasoningLevel && ['low', 'medium', 'high'].includes(reasoningLevel)) {
      modifiedRequest.reasoning = {
        effort: reasoningLevel,
        summary: 'auto'
      };
    } else {
      // If configuration is off or invalid, remove reasoning field
      delete modifiedRequest.reasoning;
    }

    logRequest('POST', endpoint.base_url, headers, modifiedRequest);

    // Forward modified request
    const proxyAgentInfo = getNextProxyAgent(endpoint.base_url);
    const fetchOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify(modifiedRequest)
    };

    if (proxyAgentInfo?.agent) {
      fetchOptions.agent = proxyAgentInfo.agent;
    }

    const response = await fetch(endpoint.base_url, fetchOptions);

    logInfo(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logError(`Endpoint error: ${response.status}`, new Error(errorText));
      return res.status(response.status).json({ 
        error: `Endpoint returned ${response.status}`,
        details: errorText 
      });
    }

    const isStreaming = openaiRequest.stream === true;

    if (isStreaming) {
      // Direct forwarding streaming response, no conversion
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        // Directly forward original response stream to client
        for await (const chunk of response.body) {
          res.write(chunk);
        }
        res.end();
        logInfo('Stream forwarded successfully');
      } catch (streamError) {
        logError('Stream error', streamError);
        res.end();
      }
    } else {
      // Direct forwarding non-streaming response, no conversion
      const data = await response.json();
      logResponse(200, null, data);
      res.json(data);
    }

  } catch (error) {
    logError('Error in /v1/responses', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

// Direct forwarding Anthropic request (no format conversion)
async function handleDirectMessages(req, res) {
  logInfo('POST /v1/messages');

  try {
    const anthropicRequest = req.body;
    const modelId = getRedirectedModelId(anthropicRequest.model);

    if (!modelId) {
      return res.status(400).json({ error: 'model is required' });
    }

    const model = getModelById(modelId);
    if (!model) {
      return res.status(404).json({ error: `Model ${modelId} not found` });
    }

    // Only allow anthropic type endpoints
    if (model.type !== 'anthropic') {
      return res.status(400).json({ 
        error: 'Invalid endpoint type',
        message: `/v1/messages endpoint only supports anthropic type endpoints, current model ${modelId} is ${model.type} type`
      });
    }

    const endpoint = getEndpointByType(model.type);
    if (!endpoint) {
      return res.status(500).json({ error: `Endpoint type ${model.type} not found` });
    }

    logInfo(`Direct forwarding to ${model.type} endpoint: ${endpoint.base_url}`);

    // Get API key - support client x-api-key for anthropic endpoint
    let authHeader;
    try {
      const clientAuthFromXApiKey = req.headers['x-api-key']
        ? `Bearer ${req.headers['x-api-key']}`
        : null;
      authHeader = await getApiKey(req.headers.authorization || clientAuthFromXApiKey);
    } catch (error) {
      logError('Failed to get API key', error);
      return res.status(500).json({ 
        error: 'API key not available',
        message: 'Failed to get or refresh API key. Please check server logs.'
      });
    }

    const clientHeaders = req.headers;
    
    // Get provider from model config
    const provider = getModelProvider(modelId);
    
    // Get headers
    const isStreaming = anthropicRequest.stream === true;
    const headers = getAnthropicHeaders(authHeader, clientHeaders, isStreaming, modelId, provider);

    // Inject system prompt to system field, and update redirected model ID
    const systemPrompt = getSystemPrompt();
    const modifiedRequest = { ...anthropicRequest, model: modelId };
    if (systemPrompt) {
      if (modifiedRequest.system && Array.isArray(modifiedRequest.system)) {
        // If there is already a system array, prepend system prompt at the beginning
        modifiedRequest.system = [
          { type: 'text', text: systemPrompt },
          ...modifiedRequest.system
        ];
      } else {
        // Otherwise create a new system array
        modifiedRequest.system = [
          { type: 'text', text: systemPrompt }
        ];
      }
    }

    // Handle thinking field
    const reasoningLevel = getModelReasoning(modelId);
    if (reasoningLevel === 'auto') {
      // Auto mode: keep original request's thinking field unchanged
      // If original request has thinking field, keep it; otherwise don't add one
    } else if (reasoningLevel && ['low', 'medium', 'high'].includes(reasoningLevel)) {
      const budgetTokens = {
        'low': 4096,
        'medium': 12288,
        'high': 24576
      };
      
      modifiedRequest.thinking = {
        type: 'enabled',
        budget_tokens: budgetTokens[reasoningLevel]
      };
    } else {
      // If configuration is off or invalid, remove thinking field
      delete modifiedRequest.thinking;
    }

    logRequest('POST', endpoint.base_url, headers, modifiedRequest);

    // Forward modified request
    const proxyAgentInfo = getNextProxyAgent(endpoint.base_url);
    const fetchOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify(modifiedRequest)
    };

    if (proxyAgentInfo?.agent) {
      fetchOptions.agent = proxyAgentInfo.agent;
    }

    const response = await fetch(endpoint.base_url, fetchOptions);

    logInfo(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logError(`Endpoint error: ${response.status}`, new Error(errorText));
      return res.status(response.status).json({ 
        error: `Endpoint returned ${response.status}`,
        details: errorText 
      });
    }

    if (isStreaming) {
      // Direct forwarding streaming response, no conversion
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        // Directly forward original response stream to client
        for await (const chunk of response.body) {
          res.write(chunk);
        }
        res.end();
        logInfo('Stream forwarded successfully');
      } catch (streamError) {
        logError('Stream error', streamError);
        res.end();
      }
    } else {
      // Direct forwarding non-streaming response, no conversion
      const data = await response.json();
      logResponse(200, null, data);
      res.json(data);
    }

  } catch (error) {
    logError('Error in /v1/messages', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

// Handle Anthropic count_tokens request
async function handleCountTokens(req, res) {
  logInfo('POST /v1/messages/count_tokens');

  try {
    const anthropicRequest = req.body;
    const modelId = getRedirectedModelId(anthropicRequest.model);

    if (!modelId) {
      return res.status(400).json({ error: 'model is required' });
    }

    const model = getModelById(modelId);
    if (!model) {
      return res.status(404).json({ error: `Model ${modelId} not found` });
    }

    // Only allow anthropic type endpoints
    if (model.type !== 'anthropic') {
      return res.status(400).json({
        error: 'Invalid endpoint type',
        message: `/v1/messages/count_tokens endpoint only supports anthropic type endpoints, current model ${modelId} is ${model.type} type`
      });
    }

    const endpoint = getEndpointByType('anthropic');
    if (!endpoint) {
      return res.status(500).json({ error: 'Endpoint type anthropic not found' });
    }

    // Get API key
    let authHeader;
    try {
      const clientAuthFromXApiKey = req.headers['x-api-key']
        ? `Bearer ${req.headers['x-api-key']}`
        : null;
      authHeader = await getApiKey(req.headers.authorization || clientAuthFromXApiKey);
    } catch (error) {
      logError('Failed to get API key', error);
      return res.status(500).json({
        error: 'API key not available',
        message: 'Failed to get or refresh API key. Please check server logs.'
      });
    }

    const clientHeaders = req.headers;
    
    // Get provider from model config
    const provider = getModelProvider(modelId);
    
    const headers = getAnthropicHeaders(authHeader, clientHeaders, false, modelId, provider);

    // Build count_tokens endpoint URL
    const countTokensUrl = endpoint.base_url.replace('/v1/messages', '/v1/messages/count_tokens');

    // Update model ID in request body to redirected ID
    const modifiedRequest = { ...anthropicRequest, model: modelId };

    logInfo(`Forwarding to count_tokens endpoint: ${countTokensUrl}`);
    logRequest('POST', countTokensUrl, headers, modifiedRequest);

    const proxyAgentInfo = getNextProxyAgent(countTokensUrl);
    const fetchOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify(modifiedRequest)
    };

    if (proxyAgentInfo?.agent) {
      fetchOptions.agent = proxyAgentInfo.agent;
    }

    const response = await fetch(countTokensUrl, fetchOptions);

    logInfo(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logError(`Count tokens error: ${response.status}`, new Error(errorText));
      return res.status(response.status).json({
        error: `Endpoint returned ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    logResponse(200, null, data);
    res.json(data);

  } catch (error) {
    logError('Error in /v1/messages/count_tokens', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

// Register routes
router.post('/v1/chat/completions', handleChatCompletions);
router.post('/v1/responses', handleDirectResponses);
router.post('/v1/messages', handleDirectMessages);
router.post('/v1/messages/count_tokens', handleCountTokens);

export default router;
