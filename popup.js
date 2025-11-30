// --- Buttons ---
document.getElementById("fill").addEventListener("click", () => triggerFill("fakeFiller:run"));
document.getElementById("smart-fill").addEventListener("click", () => triggerFill("fakeFiller:smartFill"));

async function triggerFill(eventName) {
  console.log(`Triggering event: ${eventName}`);
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
const overlayToggle = document.getElementById("overlay-toggle");
const htmlRoot = document.documentElement;
const manageProfilesButton = document.getElementById("manage-profiles");
const viewHistoryButton = document.getElementById("view-history");

// View Elements
const mainView = document.getElementById('main-view');
const profilesView = document.getElementById('profiles-view');
const backToSettingsButton = document.getElementById('back-to-settings');

// Profile Elements
const profilesList = document.getElementById('profiles-list');
const addNewProfileButton = document.getElementById('add-new-profile');

// Load all settings on popup open
document.addEventListener("DOMContentLoaded", () => {
  // Load auto-run setting
  chrome.storage.sync.get(["autoRun"], (result) => {
    autoRunCheckbox.checked = !!result.autoRun;
  });
  
  // Load API keys and other settings
  chrome.storage.local.get(["apiKeys", "aiProvider", "openAiConfig", "themeMode", "showOverlay"], (result) => {
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

    const showOverlay = result.showOverlay !== false;
    overlayToggle.checked = showOverlay;
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
  htmlRoot.classList.toggle("light", !isDark);
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

overlayToggle.addEventListener("change", () => {
  chrome.storage.local.set({ showOverlay: overlayToggle.checked });
});

viewHistoryButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});

// Event Listeners for View Switching
manageProfilesButton.addEventListener('click', () => {
  showView(profilesView);
  loadProfiles(); // Load profiles when the view is activated
});

backToSettingsButton.addEventListener('click', () => {
  showView(mainView);
});

function showView(viewElement) {
  mainView.classList.remove('active');
  profilesView.classList.remove('active');
  viewElement.classList.add('active');
}


// --- Profiles Logic (from profiles.js) ---
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function loadProfiles() {
  chrome.storage.local.get({ customProfiles: {} }, (result) => {
    const profiles = result.customProfiles;
    profilesList.innerHTML = '';
    if (Object.keys(profiles).length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No custom profiles yet.';
      li.style.textAlign = 'center';
      li.style.padding = '20px';
      profilesList.appendChild(li);
      return;
    }

    for (const hostname in profiles) {
      const profile = profiles[hostname];
      const li = document.createElement('li');
      li.className = 'profile-card';
      li.innerHTML = `
        <div class="hostname">${hostname}</div>
        <div class="actions">
          <button class="button-danger" data-hostname="${hostname}">Delete</button>
        </div>
      `;
      profilesList.appendChild(li);
    }
  });
}

profilesList.addEventListener('click', (e) => {
  if (e.target.classList.contains('button-danger')) {
    const hostname = e.target.dataset.hostname;
    Swal.fire({
      title: 'Are you sure?',
      text: `Do you want to delete the profile for ${hostname}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete it!',
      cancelButtonText: 'No, cancel',
      background: darkModeToggle.checked ? '#0B0F14' : '#ffffff', // Theme-aware
      color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b' // Theme-aware
    }).then((result) => {
      if (result.isConfirmed) {
        chrome.storage.local.get({ customProfiles: {} }, (res) => {
          const profiles = res.customProfiles;
          delete profiles[hostname];
          chrome.storage.local.set({ customProfiles: profiles }, () => {
            loadProfiles();
            Swal.fire({
              title: 'Deleted!',
              text: 'The profile has been deleted.',
              icon: 'success',
              background: darkModeToggle.checked ? '#0B0F14' : '#ffffff', // Theme-aware
              color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b' // Theme-aware
            });
          });
        });
      }
    });
  }
});

addNewProfileButton.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    Swal.fire({
      title: 'Error',
      text: 'Could not find an active tab. Please open a tab and try again.',
      icon: 'error',
      background: darkModeToggle.checked ? '#0B0F14' : '#ffffff', // Theme-aware
      color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b' // Theme-aware
    });
    return;
  }
  
  if (tab.url.startsWith('chrome://')) {
    Swal.fire({
      title: 'Error',
      text: 'Cannot create profiles for Chrome system pages.',
      icon: 'error',
      background: darkModeToggle.checked ? '#0B0F14' : '#ffffff', // Theme-aware
      color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b' // Theme-aware
    });
    return;
  }

  const hostname = new URL(tab.url).hostname;

  // Send a message to the background script to start the process
  chrome.runtime.sendMessage({
    action: 'startProfileCreation',
    tabId: tab.id,
    hostname: hostname,
  });

  // Close the popup as the rest of the workflow is handled on the content page
  window.close();
});

function startElementSelection(tabId, options) {
  return new Promise((resolve, reject) => {
      // Send a message to the content script to start selection mode
      chrome.tabs.sendMessage(tabId, { action: 'startSelection', options: options }, (response) => {
          if (chrome.runtime.lastError) {
              return reject(new Error('Could not connect to the page. Please reload the tab and try again.'));
          }
          if (response.error) {
              return reject(new Error(response.error));
          }
          if(response.selector || response.selectors) {
              resolve(response.selector || response.selectors);
          } else {
              reject(new Error('Selection was cancelled or failed.'));
          }
      });
  });
}

