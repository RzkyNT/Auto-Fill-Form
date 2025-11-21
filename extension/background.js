// This script handles the Gemini API call with key rotation.

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

  // 1. Newest Gemini format: { candidates[0].content: { role, parts } }
  if (cand.content?.parts?.length) {
    const part = cand.content.parts.find(p => p.text);
    if (part?.text) return part.text;
  }

  // 2. Sometimes "content" is an array of parts
  if (Array.isArray(cand.content)) {
    for (const part of cand.content) {
      if (part?.text) return part.text;
    }
  }

  // 3. Older models used output_text
  if (cand.output_text) return cand.output_text;

  // 4. Some return { text: "...." }
  if (cand.text) return cand.text;

  // 5. Fallback: flatten entire JSON and search for any string-like text
  const json = JSON.stringify(res);
  const match = json.match(/"text"\s*:\s*"([^"]+)"/);
  if (match) return match[1];

  return null;
}

async function handleApiRequest(request, sendResponse) {
  console.log("--- [DEBUG] handleApiRequest: START ---");
  const { apiKeys } = await new Promise(resolve => chrome.storage.local.get({ apiKeys: [] }, resolve));

  if (!apiKeys || apiKeys.length === 0) {
    console.error("--- [DEBUG] handleApiRequest: END. No API keys configured. ---");
    sendResponse({ error: "No API keys configured." });
    return;
  }

  console.log(`--- [DEBUG] handleApiRequest: Found ${apiKeys.length} keys. Shuffling...`);
  const shuffledKeys = [...apiKeys];
  shuffle(shuffledKeys);

  let lastError = null;

  for (const apiKey of shuffledKeys) {
    const now = Date.now();
    if (apiKey.cooldownUntil && apiKey.cooldownUntil > now) {
      console.log(`--- [DEBUG] handleApiRequest: Key ...${apiKey.key.slice(-4)} is on cooldown until ${new Date(apiKey.cooldownUntil).toLocaleTimeString()}. Skipping.`);
      continue;
    }

    const activeKey = apiKey.key;
    console.log(`--- [DEBUG] handleApiRequest: Loop iteration. Trying key ending in ...${activeKey.slice(-4)}`);

    const API_URL =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${activeKey}`;

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: request.prompt + "\n\nRespond ONLY with the correct option." }]
            }
          ],
          generationConfig: {
            maxOutputTokens: 20000,
            temperature: 0
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
        console.warn(`--- [DEBUG] handleApiRequest: API Error for key ...${activeKey.slice(-4)}. Status: ${response.status}. Response Body:`, data);
        console.log("--- [DEBUG] handleApiRequest: Trying next available key...");
        setApiKeyCooldown(activeKey, 60);
        lastError = errorMessage;
        continue;
      }

      const extracted = extractGeminiText(data);
      if (extracted === null) {
        lastError = "Could not extract text from API response.";
        console.warn(`--- [DEBUG] handleApiRequest: Error with key ...${activeKey.slice(-4)}: ${lastError} RAW:`, data);
        console.log("--- [DEBUG] handleApiRequest: Trying next available key...");
        setApiKeyCooldown(activeKey, 60);
        continue;
      }

      const cleanedText = extracted.trim().replace(/^"|"$/g, "").replace(/\.$/, "");
      console.log(`--- [DEBUG] handleApiRequest: Success with key ...${activeKey.slice(-4)}. Sending response.`);
      console.log("--- [DEBUG] handleApiRequest: END ---");
      sendResponse({ answer: cleanedText });
      return;

    } catch (err) {
      console.error(`--- [DEBUG] handleApiRequest: Network/fetch error for key ...${activeKey.slice(-4)}. Error:`, err);
      console.log("--- [DEBUG] handleApiRequest: Trying next available key...");
      lastError = err.message;
      setApiKeyCooldown(activeKey, 60);
    }
  }

  console.error("--- [DEBUG] handleApiRequest: END. All keys failed. ---");
  sendResponse({ error: `All API keys failed. Last error: ${lastError || "Unknown error. Check background script logs."}` });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "callGeminiApi") {
    console.log("--- Background: Received request to call Gemini API ---");
    handleApiRequest(request, sendResponse);
    return true;
  }
});
