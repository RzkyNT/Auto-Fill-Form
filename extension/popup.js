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

// Load all settings on popup open
document.addEventListener("DOMContentLoaded", () => {
  // Load auto-run setting
  chrome.storage.sync.get(["autoRun"], (result) => {
    autoRunCheckbox.checked = !!result.autoRun;
  });
  
  // Load API keys
  chrome.storage.local.get(["apiKeys"], (result) => {
    if (result.apiKeys && Array.isArray(result.apiKeys)) {
      apiKeysTextarea.value = result.apiKeys.map(item => item.key).join('\n');
    }
  });
});

// Save auto-run setting
autoRunCheckbox.addEventListener("change", () => {
  chrome.storage.sync.set({ autoRun: autoRunCheckbox.checked });
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
