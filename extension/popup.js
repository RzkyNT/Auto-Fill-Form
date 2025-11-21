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
const geminiSettingsEl = document.getElementById("gemini-settings");
const openAiSettingsEl = document.getElementById("openai-settings");
const darkModeToggle = document.getElementById("dark-mode-toggle");
const htmlRoot = document.documentElement;
const historyList = document.getElementById("history-list");
const clearHistoryButton = document.getElementById("clear-history");

// Load all settings on popup open
document.addEventListener("DOMContentLoaded", () => {
  // Load auto-run setting
  chrome.storage.sync.get(["autoRun"], (result) => {
    autoRunCheckbox.checked = !!result.autoRun;
  });
  
  // Load API keys
  chrome.storage.local.get(["apiKeys", "aiProvider", "openAiConfig", "themeMode"], (result) => {
    if (result.apiKeys && Array.isArray(result.apiKeys)) {
      apiKeysTextarea.value = result.apiKeys.map(item => item.key).join('\n');
    }

    const provider = result.aiProvider || "gemini";
    providerRadios.forEach(radio => {
      radio.checked = radio.value === provider;
    });
    updateProviderSections(provider);

    const config = result.openAiConfig || {};
    openAiBaseUrlInput.value = config.baseUrl || "";
    openAiEndpointInput.value = config.endpoint || "";
    openAiModelInput.value = config.model || "";
    openAiTokenInput.value = config.token || "";

    const themeMode = result.themeMode || "light";
    applyTheme(themeMode === "dark");
    darkModeToggle.checked = themeMode === "dark";
    renderHistory(result.smartFillHistory || []);
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
      updateProviderSections(radio.value);
    }
  });
});

function updateProviderSections(provider) {
  if (provider === "openai") {
    geminiSettingsEl.classList.add("hidden");
    openAiSettingsEl.classList.remove("hidden");
  } else {
    geminiSettingsEl.classList.remove("hidden");
    openAiSettingsEl.classList.add("hidden");
  }
}

function applyTheme(isDark) {
  htmlRoot.classList.toggle("dark", isDark);
}

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

darkModeToggle.addEventListener("change", () => {
  const isDark = darkModeToggle.checked;
  applyTheme(isDark);
  chrome.storage.local.set({ themeMode: isDark ? "dark" : "light" });
});

clearHistoryButton.addEventListener("click", () => {
  chrome.storage.local.set({ smartFillHistory: [] }, () => {
    renderHistory([]);
  });
});

function renderHistory(history) {
  if (!historyList) return;
  historyList.innerHTML = "";
  if (!history || history.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "Belum ada riwayat smart fill.";
    empty.className = "history-empty";
    historyList.appendChild(empty);
    return;
  }

  history.forEach(entry => {
    const li = document.createElement("li");
    li.className = "history-entry";
    li.innerHTML = `
      <div class="history-row">
        <span class="history-title">${entry.formName || "Unknown form"}</span>
        <span class="history-time">${new Date(entry.timestamp).toLocaleString()}</span>
      </div>
      <div class="history-question"><strong>Pertanyaan:</strong> ${entry.question || "Tidak ada pertanyaan"}</div>
      <div class="history-answer"><strong>Jawaban:</strong> ${entry.answer || "Tidak ada jawaban"}</div>
      <div class="history-status"><strong>Status:</strong> ${entry.status}</div>
      <details>
        <summary>Detail proses</summary>
        ${Array.isArray(entry.events) ? entry.events.map(evt => `<div class="history-event">${new Date(evt.timestamp).toLocaleTimeString()} — ${evt.label}${evt.detail ? `: ${evt.detail}` : ""}</div>`).join('') : ''}
      </details>
    `;
    historyList.appendChild(li);
  });
}
