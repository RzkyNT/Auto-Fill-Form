// This script handles the Gemini API call with key rotation.

console.log("Background service worker started.");

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

async function getAvailableApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get({ apiKeys: [] }, ({ apiKeys }) => {
      const now = Date.now();
      if (!apiKeys || apiKeys.length === 0) return resolve(null);

      shuffle(apiKeys); // Randomize the key order

      for (const api of apiKeys) {
        if (!api.cooldownUntil || api.cooldownUntil <= now) {
          console.log(`Background: Found available API key ending in ...${api.key.slice(-4)}`);
          return resolve(api.key);
        }
      }
      console.warn("Background: All API keys are currently on cooldown.");
      resolve(null);
    });
  });
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
  const activeKey = await getAvailableApiKey();

  if (!activeKey) {
    sendResponse({ error: "All available API keys are on cooldown. Add more keys." });
    return;
  }

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
      if (data.error?.status === "RESOURCE_EXHAUSTED") {
        console.warn(`Background: Key ending in ...${activeKey.slice(-4)} is rate-limited.`);
        setApiKeyCooldown(activeKey, 60);
        console.log("Background: Retrying with the next available key...");
        handleApiRequest(request, sendResponse);
        return;
      }
      throw new Error(`API Error: ${data.error?.message || response.statusText}`);
    }

    const extracted = extractGeminiText(data);
    if (extracted === null) { // More robust check for null
      throw new Error("Could not extract text from API response. RAW RESPONSE: " + JSON.stringify(data, null, 2));
    }

    const cleanedText = extracted.trim().replace(/^"|"$/g, "").replace(/\.$/, "");

    console.log("Background: Sending answer:", cleanedText);
    sendResponse({ answer: cleanedText });

  } catch (err) {
    console.error("Background: API error:", err);
    sendResponse({ error: err.message });
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "callGeminiApi") {
    console.log("--- Background: Received request to call Gemini API ---");
    handleApiRequest(request, sendResponse);
    return true;
  }
});
