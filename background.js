// background.js
const smartFillInstruction = "\n\nRespond ONLY with the correct option.";
const chatSystemInstruction = `You are a helpful and friendly assistant designed for general conversation. Provide clear, concise, and helpful answers.`;

chrome.runtime.onInstalled.addListener(function(details) {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'https://rizqiahsansetiawan.ct.ws/ext/welcome.html' });
  }
});

// This script handles smart fill requests to Gemini or OpenAI depending on user settings.
console.log("Background service worker started.");

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function setApiKeyCooldown(apiKey, seconds = 60) {
  chrome.storage.local.get({ apiKeys: [] }, ({ apiKeys }) => {
    const updated = apiKeys.map(api => {
      if (api.key === apiKey) {
        api.cooldownUntil = Date.now() + seconds * 1000;
        console.warn(`Background: Putting key ending in ...${api.key.slice(-4)} on cooldown.`);
      }
      return api;
    });
    chrome.storage.local.set({ apiKeys: updated });
  });
}

function extractGeminiText(res) {
  if (!res?.candidates?.length) return null;

  const cand = res.candidates[0];

  if (cand.content?.parts?.length) {
    const part = cand.content.parts.find(p => p.text);
    if (part?.text) return part.text;
  }

  if (Array.isArray(cand.content)) {
    for (const part of cand.content) {
      if (part?.text) return part.text;
    }
  }

  if (cand.output_text) return cand.output_text;
  if (cand.text) return cand.text;

  const json = JSON.stringify(res);
  const match = json.match(/"text"\s*:\s*"([^"]+)"/);
  if (match) return match[1];

  return null;
}

function normalizeOpenAiUrl(baseUrl, endpoint) {
  const trimmedEndpoint = endpoint?.trim();
  if (!trimmedEndpoint) return null;

  if (trimmedEndpoint.toLowerCase().startsWith("http")) {
    return trimmedEndpoint;
  }

  const cleanBase = baseUrl?.trim().replace(/\/+$/, "");
  const cleanEndpoint = trimmedEndpoint.replace(/^\/+/, "");
  if (!cleanBase) return trimmedEndpoint;

  return `${cleanBase}/${cleanEndpoint}`;
}

function extractOpenAiText(res) {
  if (!res) return null;

  if (Array.isArray(res.output)) {
    for (const chunk of res.output) {
      if (Array.isArray(chunk.content)) {
        for (const entry of chunk.content) {
          if (typeof entry.text === "string") return entry.text;
        }
      }
      if (typeof chunk.text === "string") return chunk.text;
    }
  }

  if (res.output_text) return res.output_text;
  if (typeof res.text === "string") return res.text;

  if (Array.isArray(res.choices)) {
    for (const choice of res.choices) {
      if (choice.message?.content) {
        if (typeof choice.message.content === "string") return choice.message.content;
        if (Array.isArray(choice.message.content)) {
          const part = choice.message.content.find(item => typeof item.text === "string");
          if (part?.text) return part.text;
        }
      }
      if (typeof choice.text === "string") return choice.text;
    }
  }

  return null;
}

// callGemini now expects the final, prepared prompt in request.prompt
async function callGemini(request, sendResponse) {
  console.log("--- [DEBUG] callGemini: START ---");
  console.log(`--- [DEBUG] callGemini: Processing request for ${request.chatContext ? "Chat AI" : "Smart Fill AI"} ---`);
  const { apiKeys } = await new Promise(resolve => chrome.storage.local.get({ apiKeys: [] }, resolve));

  if (!apiKeys || apiKeys.length === 0) {
    console.error("--- [DEBUG] callGemini: No API keys configured. ---");
    sendResponse({ error: "No Gemini API keys configured." });
    return;
  }
  
  console.log(`--- [DEBUG] callGemini: ${apiKeys.length} keys available. Shuffling...`);
  const shuffledKeys = [...apiKeys];
  shuffle(shuffledKeys);

  let lastError = null;

  for (const apiKey of shuffledKeys) {
    const now = Date.now();
    if (apiKey.cooldownUntil && apiKey.cooldownUntil > now) {
      console.log(`--- [DEBUG] callGemini: Key ...${apiKey.key.slice(-4)} on cooldown until ${new Date(apiKey.cooldownUntil).toLocaleTimeString()}. Skipping.`);
      continue;
    }

    const activeKey = apiKey.key;
    console.log(`--- [DEBUG] callGemini: Trying key ending in ...${activeKey.slice(-4)}`);

    const API_URL =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${activeKey}`;

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            ...(request.chatContext ? [{ role: "system", parts: [{ text: chatSystemInstruction }] }] : []),
            {
              role: "user",
              parts: [{ text: request.prompt }] // Use request.prompt directly
            }
          ],
          generationConfig: {
            maxOutputTokens: 20000,
            ...(request.chatContext && { temperature: 0.7 }), // Conditionally apply temperature for chat
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
          ]
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.error?.message || `HTTP error! status: ${response.status}`;
        console.warn(`--- [DEBUG] callGemini: API Error for key ...${activeKey.slice(-4)}. Status: ${response.status}.`, data);
        console.log("--- [DEBUG] Gemini API Error details:", data);
        console.log("--- [DEBUG] callGemini: Trying next key...");
        setApiKeyCooldown(activeKey, 60);
        lastError = errorMessage;
        continue;
      }

      const extracted = extractGeminiText(data);
      if (extracted === null) {
        lastError = "Could not extract text from Gemini response.";
        console.warn(`--- [DEBUG] callGemini: Parsing error for key ...${activeKey.slice(-4)}.`, data);
        console.log("--- [DEBUG] callGemini: Trying next key...");
        setApiKeyCooldown(activeKey, 60);
        continue;
      }

      const cleanedText = extracted.trim().replace(/^"|"$/g, "").replace(/\.$/, "");
      console.log(`--- [DEBUG] callGemini: Success with key ...${activeKey.slice(-4)}.`);
      sendResponse({ answer: cleanedText });
      return;

    } catch (err) {
      console.error(`--- [DEBUG] callGemini: Fetch error for key ...${activeKey.slice(-4)}.`, err);
      setApiKeyCooldown(activeKey, 60);
      lastError = err.message;
    }
  }

  console.error("--- [DEBUG] callGemini:All keys failed. ---");
  sendResponse({ error: `All Gemini API keys failed. Last error: ${lastError || "Unknown error."}` });
}

// callOpenAi now expects the final, prepared prompt in request.prompt
async function callOpenAi(request, sendResponse, config) {
  console.log("--- [DEBUG] callOpenAi: START ---");
  console.log(`--- [DEBUG] callOpenAi: Processing request for ${request.chatContext ? "Chat AI" : "Smart Fill AI"} ---`);
  console.log("--- [DEBUG] callOpenAi received config:", config);

  const { baseUrl, endpoint, model, token } = config || {};
  console.log("--- [DEBUG] Extracted baseUrl:", baseUrl, "endpoint:", endpoint);
  if (!baseUrl || !endpoint || !model || !token) {
    sendResponse({ error: "OpenAI configuration is incomplete. Please set base URL, endpoint, model, and bearer token." });
    return;
  }

  const url = normalizeOpenAiUrl(baseUrl, endpoint); // <<< MISSING LINE RE-ADDED >>>
  console.log("--- [DEBUG] Constructed URL:", url);

  const body = {
  model,
  // hanya kirim temperature jika model mendukungnya
  ...(request.chatContext && !model.includes("nano") && { temperature: 0.7 }),
};

  
  const isChatCompletionsEndpoint = endpoint.toLowerCase().includes("/chat/completions");

  if (isChatCompletionsEndpoint) {
    if (request.chatContext) {
      // For chat context with Chat Completions API
      body.messages = [
        { role: "system", content: chatSystemInstruction },
        { role: "user", content: request.prompt },
      ];
    } else {
      // For non-chat context (Smart Fill) with Chat Completions API
      body.messages = [
        { role: "user", content: request.prompt },
      ];
    }
  } else {
    // For non-Chat Completions API (Completions API, often uses 'input')
    if (request.chatContext) {
      // For chat context with Completions API, combine system instruction and prompt into 'input'
      body.input = `${chatSystemInstruction}\n\nUser: ${request.prompt}`;
    } else {
      // For non-chat context (Smart Fill) with Completions API
      body.input = request.prompt;
    }
  }

    console.log("--- [DEBUG] OpenAI Request Body:", body); // Correctly placed debug log
    try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const textBody = await response.text();
    let data = null;
    if (textBody) {
      try {
        data = JSON.parse(textBody);
      } catch (parseError) {
        console.warn("--- [DEBUG] callOpenAi: Failed to parse JSON response", parseError, textBody);
        if (!response.ok) {
          sendResponse({ error: textBody || `HTTP error! status: ${response.status}` });
          return;
        }
        sendResponse({ error: "OpenAI returned invalid JSON." });
        return;
      }
    }

    if (!response.ok) {
      const errorMessage = data?.error?.message || textBody || `HTTP error! status: ${response.status}`;
      console.warn("--- [DEBUG] callOpenAi: API error", { status: response.status, body: data || textBody });
      sendResponse({ error: errorMessage });
      return;
    }

    const extracted = extractOpenAiText(data);
    if (!extracted) {
      console.warn("--- [DEBUG] callOpenAi: Unable to extract response text", data);
      sendResponse({ error: "Could not parse OpenAI response." });
      return;
    }

    const cleanedText = extracted.trim().replace(/^"|"$/g, "").replace(/\.$/, "");
    console.log("-- [DEBUG] callOpenAi: Success.");
    sendResponse({ answer: cleanedText });
  } catch (err) {
    console.error("--- [DEBUG] callOpenAi: Network/fetch error", err);
    sendResponse({ error: err.message });
  }
}

let profileCreationState = {};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Instructions for different contexts
  if (request.action === "callAiApi") { // For Smart Fill
    console.log("--- Background: Received request to call AI API for Smart Fill ---");
    const finalPrompt = request.prompt + smartFillInstruction;
    chrome.storage.local.get({ aiProvider: "gemini", openAiConfig: {}, apiKeys: [] }, (storage) => {
      // Pass chatContext: false for Smart Fill
      callAiApiInternal({ ...request, prompt: finalPrompt, chatContext: false }, sendResponse, storage);
    });
    return true;
  }
  
  if (request.action === "callChatApi") { // For Chat AI
    console.log("--- Background: Received request to call Chat API ---");
    // For chat, we simply pass the original request.prompt. The system instruction
    // will be used by callGemini/callOpenAi based on chatContext: true
    chrome.storage.local.get({ aiProvider: "gemini", openAiConfig: {}, apiKeys: [] }, (storage) => {
      // Pass chatContext: true for Chat AI
      callAiApiInternal({ ...request, prompt: request.prompt, chatContext: true }, sendResponse, storage);
    });
    return true;
  }

  // Internal helper to avoid code duplication in onMessage listener
  function callAiApiInternal(req, resSender, storage) {
    if (storage.aiProvider === "openai") {
      callOpenAi(req, resSender, storage.openAiConfig);
    } else {
      callGemini(req, resSender);
    }
  }

  // --- Profile Creation Workflow ---
  if (request.action === 'startProfileCreation') {
    console.log('Background: Starting profile creation.', request);
    profileCreationState = {
      tabId: request.tabId,
      hostname: request.hostname,
      step: 'questionContainer',
    };
    chrome.tabs.sendMessage(request.tabId, { action: 'startSelection', options: { type: 'questionContainer', multi: false } });
    return true;
  }

  if (request.action === 'elementSelected') {
    console.log('Background: Received selected element.', request);
    const { tabId, step } = profileCreationState;
    if (sender.tab.id !== tabId) {
      console.error("Background: Received elementSelected from wrong tab.");
      return;
    }
    if (step === 'questionContainer' && request.selector) {
      profileCreationState.questionListContainerSelector = request.selector;
      profileCreationState.step = 'questionBlock';
      chrome.tabs.sendMessage(tabId, { action: 'startSelection', options: { type: 'questionBlock', multi: false } });
    } else if (step === 'questionBlock' && request.selector) {
      profileCreationState.exampleQuestionBlockSelector = request.selector;
      profileCreationState.step = 'questionText';
      chrome.tabs.sendMessage(tabId, { action: 'startSelection', options: { type: 'questionText', multi: false, relativeTo: profileCreationState.exampleQuestionBlockSelector } });
    } else if (step === 'questionText' && request.relativeSelector) {
      profileCreationState.questionTextRelativeSelector = request.relativeSelector;
      profileCreationState.step = 'answers';
      chrome.tabs.sendMessage(tabId, { action: 'startSelection', options: { type: 'answer', multi: true, relativeTo: profileCreationState.exampleQuestionBlockSelector } });
    } else if (step === 'answers' && request.relativeSelectors) {
      const {
        hostname,
        questionListContainerSelector,
        exampleQuestionBlockSelector,
        questionTextRelativeSelector,
      } = profileCreationState;
      const newProfile = {
        questionListContainer: questionListContainerSelector,
        questionBlock: exampleQuestionBlockSelector,
        questionText: questionTextRelativeSelector,
        answers: request.relativeSelectors
      };
      chrome.storage.local.get({ customProfiles: {} }, (result) => {
        const profiles = result.customProfiles;
        profiles[hostname] = newProfile;
        chrome.storage.local.set({ customProfiles: profiles }, () => {
          console.log('Background: Profile saved for', hostname);
          chrome.tabs.sendMessage(tabId, { action: 'showToast', toast: { icon: 'success', title: `Profile saved for ${hostname}` } });
        });
      });
      profileCreationState = {};
    }
    return true;
  }
});
