// --- Buttons ---
document.getElementById("fill").addEventListener("click", () => triggerFill("fakeFiller:run"));
document.getElementById("smart-fill").addEventListener("click", () => triggerFill("fakeFiller:smartFill"));

async function triggerFill(eventName) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (event) => window.dispatchEvent(new CustomEvent(event)),
    args: [eventName],
  });
}


// --- Settings ---
const autoRunCheckbox = document.getElementById("auto-run");
const apiKeysTextarea = document.getElementById("api-keys");
const saveKeysButton = document.getElementById("save-keys");
const providerRadios = document.querySelectorAll('input[name="ai-provider"]');
const openAiBaseUrlInput = document.getElementById("openai-base-url");
const openAiEndpointInput = document.getElementById("openai-endpoint");
const openAiModelInput = document.getElementById("openai-model");
const openAiTokenInput = document.getElementById("openai-token");
const saveOpenAiButton = document.getElementById("save-openai");

// Load all settings on popup open
document.addEventListener("DOMContentLoaded", () => {
  // Load auto-run setting
  chrome.storage.sync.get(["autoRun"], (result) => {
    autoRunCheckbox.checked = !!result.autoRun;
  });
  
  // Load API keys
  chrome.storage.local.get(["apiKeys", "aiProvider", "openAiConfig"], (result) => {
    if (result.apiKeys && Array.isArray(result.apiKeys)) {
      apiKeysTextarea.value = result.apiKeys.map(item => item.key).join('\n');
    }

    const provider = result.aiProvider || "gemini";
    providerRadios.forEach(radio => {
      radio.checked = radio.value === provider;
    });

    const config = result.openAiConfig || {};
    openAiBaseUrlInput.value = config.baseUrl || "";
    openAiEndpointInput.value = config.endpoint || "";
    openAiModelInput.value = config.model || "";
    openAiTokenInput.value = config.token || "";
  });
});

// Save auto-run setting
autoRunCheckbox.addEventListener("change", () => {
  chrome.storage.sync.set({ autoRun: autoRunCheckbox.checked });
});

// Persist provider selection immediately
providerRadios.forEach(radio => {
  radio.addEventListener("change", () => {
    if (radio.checked) {
      chrome.storage.local.set({ aiProvider: radio.value });
    }
  });
});

// Save API keys
saveKeysButton.addEventListener("click", () => {
  const keysString = apiKeysTextarea.value;
  const keys = keysString.split('\n').map(k => k.trim()).filter(Boolean);
  
  const apiKeys = keys.map(key => ({
    key: key,
    cooldownUntil: 0,
  }));

  chrome.storage.local.set({ apiKeys: apiKeys }, () => {
    saveKeysButton.textContent = "Saved!";
    setTimeout(() => {
      saveKeysButton.textContent = "Save Keys";
    }, 1500);
  });
});

// Save OpenAI settings
saveOpenAiButton.addEventListener("click", () => {
  const config = {
    baseUrl: openAiBaseUrlInput.value.trim(),
    endpoint: openAiEndpointInput.value.trim(),
    model: openAiModelInput.value.trim(),
    token: openAiTokenInput.value.trim(),
  };

  chrome.storage.local.set({ openAiConfig: config }, () => {
    saveOpenAiButton.textContent = "Saved!";
    setTimeout(() => {
      saveOpenAiButton.textContent = "Save OpenAI Settings";
    }, 1500);
  });
});
