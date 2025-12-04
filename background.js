// background.js
const smartFillInstruction = "\n\nRespond ONLY with the correct option.";
const chatSystemInstruction = `You are a helpful and friendly assistant designed for general conversation. Provide clear, concise, and helpful answers if user provide a question with several options just use the options as response with explaination.`;

const ACTIVATION_SERVER_URL = "https://script.google.com/macros/s/AKfycbz90SNLOKlVVEszt3gKwi_x61iu_8NYXpKJ5ZC0LwPALNClNtaPdZj8UDQE3NjCnHTu/exec"; // Replace with your actual backend URL
const BACKEND_PUBLIC_KEY = "SMK-TARUNA-BANGSA-EKSTENSI-RZKYNT-2025"; // Replace with a strong key for HMAC or public key for JWT

// Key for storing the last activation response in local storage
const LAST_ACTIVATION_RESPONSE_KEY = "lastActivationResponse";
const LICENSE_CACHE_KEY = "licenseCache";
const CACHE_DURATION_MS = 10 * 60 * 1000; // 1 hour

chrome.runtime.onInstalled.addListener(function (details) {
  // On first install, open a welcome page.
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'https://rizqiahansetiawan.ct.ws/ext/welcome.html' });
  }

  // On install or update, run a check for a new version.
  // A small delay is used to ensure network is available.
  setTimeout(checkForUpdates, 2000);

  // Create Context Menus
  chrome.contextMenus.create({
    id: "smart-fill-field",
    title: "Smart Fill This Field",
    contexts: ["editable"]
  });

  chrome.contextMenus.create({
    id: "fake-fill-field",
    title: "Generate Fake Data",
    contexts: ["editable"]
  });
});

// Handle Context Menu Clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "smart-fill-field") {
    chrome.tabs.sendMessage(tab.id, { action: "contextMenuSmartFill" });
  } else if (info.menuItemId === "fake-fill-field") {
    chrome.tabs.sendMessage(tab.id, { action: "contextMenuFakeFill" });
  }
});

// This script handles smart fill requests to Gemini or OpenAI depending on user settings.
console.log("Background service worker started.");

// Function to generate a UUID (similar to v4)
function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function getDeviceIdentifier() {
  let { deviceIdentifier } = await chrome.storage.local.get("deviceIdentifier");
  if (!deviceIdentifier) {
    deviceIdentifier = generateUuid();
    await chrome.storage.local.set({ deviceIdentifier: deviceIdentifier });
  }
  return deviceIdentifier;
}

// Ensure device ID exists on startup
getDeviceIdentifier();

async function verifyBackendSignature(data, signature, sharedSecret) {
  const canonicalJsonStringify = (obj) => {
    const sortedObj = Object.keys(obj)
      .sort()
      .reduce((acc, key) => {
        acc[key] = obj[key];
        return acc;
      }, {});
    return JSON.stringify(sortedObj);
  };

  const canonicalDataString = canonicalJsonStringify(data);

  console.log("DEBUG BG: verifyBackendSignature called.");
  console.log(`DEBUG BG: Shared Secret used: "${sharedSecret}"`);
  console.log(`DEBUG BG: Signature received: "${signature}"`);
  console.log(`DEBUG BG: Canonical Data to sign: "${canonicalDataString}"`);

  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(sharedSecret);
    const dataToSign = encoder.encode(canonicalDataString); // Use the canonical string

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );

    if (!/^[0-9a-fA-F]+$/.test(signature)) {
      console.error("DEBUG BG: Signature is not a valid hex string. Received: " + signature);
      return false;
    }

    const hexToArrayBuffer = (hex) => {
      const typedArray = new Uint8Array(hex.match(/[0-9a-f]{2}/gi).map(function (h) {
        return parseInt(h, 16)
      }));
      return typedArray.buffer;
    };

    const verified = await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      hexToArrayBuffer(signature),
      dataToSign
    );

    if (verified) {
      console.log("DEBUG BG: Backend signature successfully verified.");
    } else {
      console.warn("DEBUG BG: Backend signature verification FAILED.");
    }
    return verified;
  } catch (error) {
    console.error("DEBUG BG: Error during signature verification:", error);
    return false;
  }
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function setApiKeyCooldown(apiKey, seconds = 3) {
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

  const cleanBase = baseUrl?.trim().replace(/\/\/+$/, "");
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
            ...(request.chatContext ? [{ role: "model", parts: [{ text: chatSystemInstruction }] }] : []),
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
        { role: "model", content: chatSystemInstruction },
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

async function verifyActivationWithBackend() {
  // Trigger update check with cooldown.
  checkForUpdates();

  // Check for a valid, non-expired cache entry first
  const { [LICENSE_CACHE_KEY]: cache } = await chrome.storage.local.get(LICENSE_CACHE_KEY);
  if (cache && (Date.now() - cache.timestamp < CACHE_DURATION_MS)) {
    console.log("BG: Returning activation status from cache.");
    return { isActive: cache.isActive, licenseDetails: cache.licenseDetails };
  }

  console.log("BG: Verifying activation status with backend...");
  const { activationKey, deviceIdentifier } = await chrome.storage.local.get(["activationKey", "deviceIdentifier"]);

  if (!activationKey || !deviceIdentifier) {
    console.log("BG: Verification failed: Missing activationKey or deviceIdentifier in local storage.");
    return { isActive: false, licenseDetails: null };
  }

  try {
    const response = await fetch(ACTIVATION_SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'status',
        activationKey: activationKey,
        deviceIdentifier: deviceIdentifier,
      }),
      redirect: 'follow'
    });

    const responseData = await response.json();

    if (response.ok && responseData.data?.status === 'success' && responseData.data?.isActive === true) {
      const licenseDetails = responseData.data.licenseDetails || 'Full';
      console.log(`BG: Verification successful. License: ${licenseDetails}`);

      // Store successful verification in cache
      const newCache = {
        isActive: true,
        licenseDetails: licenseDetails,
        timestamp: Date.now()
      };
      await chrome.storage.local.set({ [LICENSE_CACHE_KEY]: newCache });

      return { isActive: true, licenseDetails: licenseDetails };
    } else {
      const message = responseData.data?.message || 'Unknown status.';
      console.log(`BG: Verification failed or user is inactive. Reason: ${message}`);

      // Also cache failed attempts to prevent spamming the server
      const newCache = {
        isActive: false,
        licenseDetails: null,
        timestamp: Date.now()
      };
      await chrome.storage.local.set({ [LICENSE_CACHE_KEY]: newCache });

      return { isActive: false, licenseDetails: null };
    }
  } catch (error) {
    console.error("BG: Error during activation status check:", error);
    return { isActive: false, licenseDetails: null }; // Network errors mean no activation
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // --- Live Activation Check Workflow ---
  if (request.action === 'checkActivation') {
    (async () => {
      const status = await verifyActivationWithBackend();
      sendResponse(status);
    })();
    return true;
  }

  // --- Activation Workflow ---
  if (request.action === 'activateExtension') {
    (async () => {
      const { activationKey } = request;
      const deviceIdentifier = await getDeviceIdentifier();
      console.log("BG: Menerima permintaan activateExtension.");

      try {
        const fetchOptions = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            activationKey: activationKey,
            deviceIdentifier: deviceIdentifier,
          }),
          redirect: 'follow'
        };

        const response = await fetch(ACTIVATION_SERVER_URL, fetchOptions);
        const responseText = await response.text();
        let responseData = JSON.parse(responseText);

        if (!responseData.data || !responseData.signature) {
          console.error("BG: Respons yang salah dari server: Data atau tanda tangan hilang.");
          sendResponse({ success: false, message: "Respons server salah." });
          return;
        }

        const isSignatureValid = await verifyBackendSignature(responseData.data, responseData.signature, BACKEND_PUBLIC_KEY);

        if (!isSignatureValid) {
          console.error("BG: Aktivasi gagal: Tanda tangan backend tidak valid.");
          sendResponse({ success: false, message: "Invalid server response signature." });
          return;
        }

        const successStatus = response.ok && responseData.data.status === 'success';
        const message = responseData.data.message || (successStatus ? 'Extension activated successfully!' : 'Activation failed.');
        const licenseDetails = responseData.data.licenseDetails || null;

        const finalResponse = {
          success: successStatus,
          message: message,
          licenseDetails: licenseDetails
        };

        if (successStatus) {
          await chrome.storage.local.set({
            activationKey: activationKey,
            deviceIdentifier: deviceIdentifier
          });
          // Invalidate the cache on successful activation
          await chrome.storage.local.remove(LICENSE_CACHE_KEY);
          console.log(`BG: Aktivasi berhasil. Kunci disimpan. Lisensi: ${licenseDetails}`);
        } else {
          await chrome.storage.local.remove(["activationKey"]); // Clear key on failure
          console.log(`BG: Aktivasi gagal: ${message}`);
        }
        await chrome.storage.local.set({ [LAST_ACTIVATION_RESPONSE_KEY]: finalResponse });
        sendResponse(finalResponse);
      } catch (error) {
        const finalResponse = { success: false, message: `Network error: ${error.message}` };
        await chrome.storage.local.remove(["activationKey"]);
        await chrome.storage.local.set({ [LAST_ACTIVATION_RESPONSE_KEY]: finalResponse });
        sendResponse(finalResponse);
      }
    })();
    return true;
  }

  // --- Deactivation Workflow ---
  if (request.action === 'deactivateExtension') {
    (async () => {
      console.log("BG: Menerima permintaan deactivateExtension.");

      const { deviceIdentifier, activationKey } = await chrome.storage.local.get(["deviceIdentifier", "activationKey"]);

      if (!deviceIdentifier || !activationKey) {
        console.error("BG: Deactivation failed: Missing deviceIdentifier or activationKey.");
        await chrome.storage.local.remove(["activationKey", "licenseDetails"]);
        return;
      }

      try {
        await fetch(ACTIVATION_SERVER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'deactivate',
            activationKey: activationKey,
            deviceIdentifier: deviceIdentifier,
          }),
          redirect: 'follow'
        });
        console.log("BG: Deactivation request sent to the server.");
      } catch (error) {
        console.error("BG: Error sending deactivation request to the server:", error);
      } finally {
        // Invalidate the cache on deactivation
        await chrome.storage.local.remove([
          "activationKey",
          "licenseDetails",
          LAST_ACTIVATION_RESPONSE_KEY,
          LICENSE_CACHE_KEY
        ]);
        console.log("BG: Data aktivasi dihapus dari penyimpanan lokal.");
      }
    })();
    return true;
  }

  // Instructions for different contexts
  if (request.action === "callAiApi") { // For Smart Fill
    (async () => {
      const activationStatus = await verifyActivationWithBackend();
      if (!activationStatus.isActive) {
        console.warn("AI API call blocked: Extension not activated.");
        sendResponse({ error: "Extension not activated. Please activate to use Smart Fill." });
        return;
      }
      console.log("--- Background: Received request to call AI API for Smart Fill ---");
      const finalPrompt = request.prompt + smartFillInstruction;
      const storage = await chrome.storage.local.get({ aiProvider: "gemini", openAiConfig: {}, apiKeys: [] });
      callAiApiInternal({ ...request, prompt: finalPrompt, chatContext: false }, sendResponse, storage);
    })();
    return true;
  }

  if (request.action === "callChatApi") { // For Chat AI
    (async () => {
      const activationStatus = await verifyActivationWithBackend();
      if (!activationStatus.isActive) {
        console.warn("Chat API call blocked: Extension not activated.");
        sendResponse({ error: "Extension not activated. Please activate to use AI Chat." });
        return;
      }
      console.log("--- Background: Received request to call Chat API ---");
      const storage = await chrome.storage.local.get({ aiProvider: "gemini", openAiConfig: {}, apiKeys: [] });
      callAiApiInternal({ ...request, prompt: request.prompt, chatContext: true }, sendResponse, storage);
    })();
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
    (async () => {
      const activationStatus = await verifyActivationWithBackend();
      if (!activationStatus.isActive) {
        console.warn("Profile creation blocked: Extension not activated.");
        return;
      }

      console.log('Background: Starting guided profile creation process.', request);

      chrome.scripting.executeScript( // Removed await here
        {
          target: { tabId: request.tabId },
          files: ['content.js'],
        },
        () => { // Callback for when the script has finished injecting and executing
          if (chrome.runtime.lastError) {
            console.error("BG: Failed to inject script:", chrome.runtime.lastError.message);
            // Inform the user via badge
            chrome.action.setBadgeText({ tabId: request.tabId, text: '!' });
            chrome.action.setBadgeBackgroundColor({ tabId: request.tabId, color: '#ff6b7a' });
            setTimeout(() => {
              chrome.action.setBadgeText({ tabId: request.tabId, text: '' });
            }, 3000);
            return;
          }

          // Now send the message after a small delay to ensure the content script's listener is fully set up.
          setTimeout(() => {
            chrome.tabs.sendMessage(request.tabId, { action: 'startSelection', hostname: request.hostname }, (response) => {
              if (chrome.runtime.lastError) {
                console.error("BG: Failed to send 'startSelection' message after injection:", chrome.runtime.lastError.message);
                // Inform the user via badge
                chrome.action.setBadgeText({ tabId: request.tabId, text: '!' });
                chrome.action.setBadgeBackgroundColor({ tabId: request.tabId, color: '#ff6b7a' });
                setTimeout(() => {
                  chrome.action.setBadgeText({ tabId: request.tabId, text: '' });
                }, 3000);
              } else {
                console.log('Background: "startSelection" message sent successfully with response:', response);
              }
            });
          }, 100); // 100ms delay
        }
      ); // End of executeScript call
    })(); // End of async IIFE
    return true;
  }

  // --- Profile Editing Workflow ---
  if (request.action === 'startProfileEditing') {
    (async () => {
      const activationStatus = await verifyActivationWithBackend();
      if (!activationStatus.isActive) {
        console.warn("Profile editing blocked: Extension not activated.");
        return;
      }

      console.log('Background: Starting guided profile editing process.', request);

      chrome.scripting.executeScript(
        {
          target: { tabId: request.tabId },
          files: ['content.js'],
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error("BG: Failed to inject script for editing:", chrome.runtime.lastError.message);
            chrome.action.setBadgeText({ tabId: request.tabId, text: '!' });
            chrome.action.setBadgeBackgroundColor({ tabId: request.tabId, color: '#ff6b7a' });
            setTimeout(() => {
              chrome.action.setBadgeText({ tabId: request.tabId, text: '' });
            }, 3000);
            return;
          }

          setTimeout(() => {
            chrome.tabs.sendMessage(request.tabId, { action: 'startSelection', existingProfile: request.profile, hostname: request.hostname }, (response) => {
              if (chrome.runtime.lastError) {
                console.error("BG: Failed to send 'startSelection' message for editing:", chrome.runtime.lastError.message);
                chrome.action.setBadgeText({ tabId: request.tabId, text: '!' });
                chrome.action.setBadgeBackgroundColor({ tabId: request.tabId, color: '#ff6b7a' });
                setTimeout(() => {
                  chrome.action.setBadgeText({ tabId: request.tabId, text: '' });
                }, 3000);
              } else {
                console.log('Background: "startSelection" message sent successfully for editing:', response);
              }
            });
          }, 100); // 100ms delay
        }
      );
    })();
    return true;
  }

  // --- New Profile Creation Workflow ---
  if (request.action === 'profileCompleted' || request.action === 'profileUpdated') { // Combined actions
    (async () => {
      try {
        const { hostname, profile } = request;
        if (!hostname || !profile) {
          console.error("BG: Invalid profile data received (completion or update).");
          sendResponse({ status: 'error', message: 'Invalid data.' });
          return;
        }

        const { customProfiles } = await chrome.storage.local.get({ customProfiles: {} });
        customProfiles[hostname] = profile; // Overwrites if already exists, which is intended for update
        await chrome.storage.local.set({ customProfiles });

        console.log(`Background: Profile ${request.action === 'profileUpdated' ? 'updated' : 'saved'} for ${hostname}`, profile);
        sendResponse({ status: 'profile_saved' }); // Same response status for simplicity
      } catch (e) {
        console.error("BG: Error saving/updating profile:", e);
        sendResponse({ status: 'error', message: e.message });
      }
    })();
    return true;
  }
});// --- Update Checker ---

const UPDATE_CHECK_ALARM_NAME = 'update-check-alarm';
// IMPORTANT: User must replace this URL with the raw URL to their version.json on GitHub
const VERSION_URL = 'https://raw.githubusercontent.com/RzkyNT/Auto-Fill-Form/main/version.json';
const UPDATE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown for update checks triggered by activation

async function compareVersions(versionA, versionB) {
  const partsA = versionA.split('.').map(Number);
  const partsB = versionB.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const a = partsA[i] || 0;
    const b = partsB[i] || 0;
    if (a > b) return 1;
    if (b > a) return -1;
  }
  return 0;
}

async function checkForUpdates() {
  const { lastUpdateCheckTimestamp } = await chrome.storage.local.get('lastUpdateCheckTimestamp');
  const now = Date.now();

  if (lastUpdateCheckTimestamp && (now - lastUpdateCheckTimestamp < UPDATE_COOLDOWN_MS)) {
    console.log('Update checker: Cooldown period active. Skipping update check.');
    return;
  }

  console.log('Checking for extension updates...');

  if (VERSION_URL.includes('USERNAME/REPONAME')) { // This warning is now handled by the user's setup instructions.
    // console.warn('Update checker: Please replace the placeholder VERSION_URL in background.js');
    // return;
  }

  try {
    const response = await fetch(VERSION_URL, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Failed to fetch version info: ${response.statusText}`);
    }
    const latest = await response.json();
    const currentVersion = chrome.runtime.getManifest().version;

    if (await compareVersions(latest.version, currentVersion) > 0) {
      console.log(`New version found: ${latest.version}. Current version: ${currentVersion}`);
      showUpdateNotification(latest);
    } else {
      console.log('Extension is up to date.');
    }
  } catch (error) {
    console.error('Error checking for updates:', error);
  } finally {
    // Update the timestamp after the check, regardless of success or failure
    await chrome.storage.local.set({ lastUpdateCheckTimestamp: now });
  }
}

function showUpdateNotification(versionInfo) {
  const notificationId = 'update-notification';
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'images/icon.png',
    title: 'Pembaruan Tersedia!',
    message: `Versi baru ${versionInfo.version} dari Smart Filler tersedia.`,
    buttons: [{ title: 'Download di GitHub' }],
    priority: 2
  });

  // Store the download URL to be used when the button is clicked
  chrome.storage.local.set({ [notificationId]: versionInfo.release_url });
}

// Listener for notification button clicks
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (notificationId === 'update-notification' && buttonIndex === 0) {
    const { [notificationId]: url } = await chrome.storage.local.get(notificationId);
    if (url) {
      chrome.tabs.create({ url: url });
    }
    chrome.notifications.clear(notificationId);
  }
});

// Schedule the update check
chrome.alarms.create(UPDATE_CHECK_ALARM_NAME, {
  delayInMinutes: 1,
  periodInMinutes: 1440
});

// Listener for the alarm
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === UPDATE_CHECK_ALARM_NAME) {
    checkForUpdates();
  }
});
