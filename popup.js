document.getElementById("activation-key-input").addEventListener("input", function () {
  this.value = this.value.toUpperCase();
});

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
const triggerButtonOpacityInput = document.getElementById("overlay-opacity");
const triggerButtonOpacityValueSpan = document.getElementById("trigger-button-opacity-value");
const htmlRoot = document.documentElement;
const manageProfilesButton = document.getElementById("manage-profiles");
const viewHistoryButton = document.getElementById("view-history");
const resetSessionButton = document.getElementById("reset-session");

// --- Activation Elements ---
const activationKeyInput = document.getElementById("activation-key-input");
const activateExtensionButton = document.getElementById("activate-extension");
const activationStatusDiv = document.getElementById("activation-status");

// --- Current Status Display Elements ---
const displayActivationKey = document.getElementById("display-activation-key");
const displayLicenseStatus = document.getElementById("display-license-status");
const displayLicenseDetails = document.getElementById("display-license-details");
const deactivateExtensionButton = document.getElementById("deactivate-extension");

const LAST_ACTIVATION_RESPONSE_KEY = "lastActivationResponse";

// View Elements
const mainView = document.getElementById('main-view');
const profilesView = document.getElementById('profiles-view');
const activationView = document.getElementById('activation-view');
const featuresView = document.getElementById('features-view');
const backToSettingsButton = document.getElementById('back-to-settings');


// Profile Elements
const profilesList = document.getElementById('profiles-list');
const addNewProfileButton = document.getElementById('add-new-profile');

async function sendColorUpdateToContentScript(elementId, color) {
  console.log(`[Popup.js] Attempting to send color update: ${elementId} = ${color}`);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'updateColor',
      elementId: elementId,
      color: color
    }).catch(error => console.error("[Popup.js] Error sending color update to content script:", error));
  }
}


// Load all settings on popup open
document.addEventListener("DOMContentLoaded", () => {
  console.log("Popup DOM loaded. Sending 'checkActivation' message to background script.");
  
  // On popup open, always ask the background script for the current activation status
  chrome.runtime.sendMessage({ action: 'checkActivation' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Popup: Error communicating with background script:", chrome.runtime.lastError.message);
      // Fallback to a deactivated state if the background script is not available
      renderPopupUI(false, null);
      return;
    }
    
    console.log("Popup: Received activation status from background:", response);
    renderPopupUI(response?.isActive || false, response?.licenseDetails || null);
  });

  // Load other non-activation-related settings from storage
  chrome.storage.local.get(["autoRun", "triggerButtonBgColor", "triggerIconSpanColor", "aiProvider", "openAiConfig", "themeMode", "triggerButtonOpacity"], (result) => { // Updated storage key
    autoRunCheckbox.checked = !!result.autoRun;
    console.log("[Popup.js] Loaded settings from storage:", result);
    
    // Initialize Coloris for Trigger Button Background
    Coloris({
      el: '#trigger-button-bg-color',
      theme: 'large',
      themeMode: darkModeToggle.checked ? 'dark' : 'light',
      alpha: false,
      format: 'hex',
      formatToggle: false,
      swatches: [
        '#EDE1FF', '#25D366', '#FF6B7A', '#FFD700', '#ADD8E6', '#90EE90'
      ],
      eyedropper: true // Enable eyedropper
    });
    document.getElementById("trigger-button-bg-color").value = result.triggerButtonBgColor || '#EDE1FF';
    sendColorUpdateToContentScript('trigger-button-bg-color', document.getElementById("trigger-button-bg-color").value);
    document.addEventListener('coloris:pick', (event) => {
      if (event.detail.el && event.detail.el.id === 'trigger-button-bg-color') {
        sendColorUpdateToContentScript('trigger-button-bg-color', event.detail.color);
      }
    });

    // Initialize Coloris for Trigger Icon Span Color
    Coloris({
      el: '#trigger-icon-span-color',
      theme: 'large',
      themeMode: darkModeToggle.checked ? 'dark' : 'light',
      alpha: false,
      format: 'hex',
      formatToggle: false,
      swatches: [
        '#5E3BAE', '#000000', '#FFFFFF', '#FF6347', '#4682B4', '#DAA520'
      ],
      eyedropper: true // Enable eyedropper
    });
    document.getElementById("trigger-icon-span-color").value = result.triggerIconSpanColor || '#5E3BAE';
    sendColorUpdateToContentScript('trigger-icon-span-color', document.getElementById("trigger-icon-span-color").value);
    document.addEventListener('coloris:pick', (event) => {
      if (event.detail.el && event.detail.el.id === 'trigger-icon-span-color') {
        sendColorUpdateToContentScript('trigger-icon-span-color', event.detail.color);
      }
    });
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

    const triggerButtonOpacity = result.triggerButtonOpacity !== undefined ? result.triggerButtonOpacity : 100; // Default to 100%
    triggerButtonOpacityInput.value = triggerButtonOpacity;
    triggerButtonOpacityValueSpan.textContent = `${triggerButtonOpacity}%`;
    sendTriggerButtonOpacityUpdateToContentScript(parseFloat(triggerButtonOpacity) / 100); // Updated function call

    // Apply theme to Coloris.js picker as well
    Coloris.set('themeMode', darkModeToggle.checked ? 'dark' : 'light');
  });
});

// Save UI settings
document.getElementById("save-ui-settings").addEventListener("click", () => {
  const triggerButtonBgColor = document.getElementById("trigger-button-bg-color").value;
  const triggerIconSpanColor = document.getElementById("trigger-icon-span-color").value;
  const triggerButtonOpacity = parseInt(triggerButtonOpacityInput.value); // Corrected source and variable name

  chrome.storage.local.set({ 
    triggerButtonBgColor: triggerButtonBgColor, 
    triggerIconSpanColor: triggerIconSpanColor,
    triggerButtonOpacity: triggerButtonOpacity // Corrected storage key
  }, () => {
    const saveButton = document.getElementById("save-ui-settings");
    saveButton.textContent = "Saved!";
    setTimeout(() => {
      saveButton.textContent = "Save UI Settings";
    }, 1500);
  });
});

// Save auto-run setting
autoRunCheckbox.addEventListener("change", () => {
  chrome.storage.local.set({ autoRun: autoRunCheckbox.checked });
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

function renderPopupUI(isActivated, licenseDetails) {
  if (isActivated) {
    activationView.classList.remove("active");
    featuresView.classList.add("active");
    activationStatusDiv.innerHTML = `<span style="color: var(--color-accent);">Activated!</span> License: ${licenseDetails || 'Full'}`;
    activationKeyInput.classList.add("hidden");
    activateExtensionButton.classList.add("hidden");

    // NEW: Update current activation status display
    chrome.storage.local.get(["activationKey"], (result) => { // Get the stored key
        displayActivationKey.textContent = result.activationKey || 'N/A';
        displayLicenseStatus.textContent = 'Active'; // Always active if this branch is hit
        displayLicenseDetails.textContent = licenseDetails || 'Full';
        deactivateExtensionButton.classList.remove("hidden"); // Show deactivate button
    });

  } else {
    activationView.classList.add("active");
    featuresView.classList.remove("active");
    activationStatusDiv.innerHTML = `<span style="color: #ff6b7a;">Not Activated.</span> Please enter your key.`;
    activationKeyInput.classList.remove("hidden");
    activateExtensionButton.classList.remove("hidden");

    // NEW: Clear current activation status display
    displayActivationKey.textContent = 'Not available';
    displayLicenseStatus.textContent = 'Inactive';
    displayLicenseDetails.textContent = 'N/A';
    deactivateExtensionButton.classList.add("hidden"); // Hide deactivate button
  }

  // Feature buttons are enabled/disabled by activation status
  document.getElementById("smart-fill").disabled = !isActivated;
  document.getElementById("manage-profiles").disabled = !isActivated;
  document.getElementById("add-new-profile").disabled = !isActivated;
  document.getElementById("fill").disabled = !isActivated; // Also disable fill with random data
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

triggerButtonOpacityInput.addEventListener("input", () => {
  const opacityValue = triggerButtonOpacityInput.value;
  triggerButtonOpacityValueSpan.textContent = `${opacityValue}%`;
  chrome.storage.local.set({ triggerButtonOpacity: parseInt(opacityValue) });
  sendTriggerButtonOpacityUpdateToContentScript(parseFloat(opacityValue) / 100);
});

// Repurposed function for trigger button opacity
async function sendTriggerButtonOpacityUpdateToContentScript(opacity) {
  console.log(`[Popup.js] Attempting to send trigger button opacity update: ${opacity}`);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'updateTriggerButtonOpacity', // New action name for content script
      opacity: opacity
    }).catch(error => console.error("[Popup.js] Error sending trigger button opacity update to content script:", error));
  }
}

viewHistoryButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});

resetSessionButton.addEventListener("click", () => {
  chrome.storage.local.remove("answeredQuestionHashes", () => {
    if (chrome.runtime.lastError) {
      console.error("Error resetting session:", chrome.runtime.lastError);
      Swal.fire({
        title: 'Error!',
        text: 'Could not reset the session. Please check the console.',
        icon: 'error',
        background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
        color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
      });
    } else {
      Swal.fire({
        title: 'Success!',
        text: 'Current session has been reset. You can now re-answer questions on the page.',
        icon: 'success',
        background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
        color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
      }).then(() => {
        location.reload();
      });
    }
  });
});

  activateExtensionButton.addEventListener("click", async () => {
    const activationKey = activationKeyInput.value.trim();
    if (!activationKey) {
      Swal.fire({
        title: 'Error',
        text: 'Please enter an activation key.',
        icon: 'error',
        background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
        color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
      });
      return;
    }

    activationStatusDiv.innerHTML = `Activating...`;
    activateExtensionButton.disabled = true;

    chrome.runtime.sendMessage(
    {
      action: 'activateExtension',
      activationKey: activationKey
    },
    async (response) => {
      if (chrome.runtime.lastError) {
        console.warn("Popup: Message port closed before response. Retrieving result from local storage...");
        await new Promise(resolve => setTimeout(resolve, 150));
        const { lastActivationResponse } = await chrome.storage.local.get(LAST_ACTIVATION_RESPONSE_KEY);
        console.log("Popup: Result from local storage for LAST_ACTIVATION_RESPONSE_KEY:", lastActivationResponse);

        if (lastActivationResponse && Object.keys(lastActivationResponse).length > 0) {
          console.log("Popup: Processing stored activation response:", lastActivationResponse);
          processActivationResponse(lastActivationResponse);
          await chrome.storage.local.remove(LAST_ACTIVATION_RESPONSE_KEY);
        } else {
          console.error("Popup: Error: chrome.runtime.lastError, AND NO STORED ACTIVATION RESPONSE FOUND IN LOCAL STORAGE.");
          activationStatusDiv.innerHTML = `<span style="color: #ff6b7a;">Error: ${chrome.runtime.lastError.message || 'Unknown communication error.'}</span>`;
          renderPopupUI(false, null);
          Swal.fire({
            title: 'Activation Failed',
            text: `An unexpected error occurred: ${chrome.runtime.lastError.message || 'Please try again.'}`,
            icon: 'error',
            background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
            color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
          });
        }
        activateExtensionButton.disabled = false;
        return;
      }

      // ---- SUCCESS CASE (no runtime error) ----
      processActivationResponse(response);
      activateExtensionButton.disabled = false;
    }
  ); // ← ini penting!

    activateExtensionButton.disabled = false;
  });

// Deactivate Extension button listener
deactivateExtensionButton.addEventListener("click", async () => {
  const confirmDeactivation = await Swal.fire({
    title: 'Are you sure?',
    text: 'This will deactivate the extension on this device. Continue?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Yes, deactivate it!',
    cancelButtonText: 'No, cancel',
    background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
    color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
  });
  if (confirmDeactivation.isConfirmed) {
    // Message the background script to perform deactivation (server call and local cleanup)
    chrome.runtime.sendMessage({ action: 'deactivateExtension' }, () => {
      Swal.fire({
        title: 'Deactivated!',
        text: 'The extension has been deactivated. The popup will now reload.',
        icon: 'success',
        background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
        color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
      }).then(() => {
        location.reload(); // Reload to reflect the new state
      });
    });
  }
});

// New helper function to process activation response and update UI
function processActivationResponse(response) {
    if (response.success) {
      Swal.fire({
        title: 'Success!',
        text: 'Extension activated successfully. The popup will now reload.',
        icon: 'success',
        background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
        color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
      }).then(() => {
        location.reload(); // Reload to reflect the new state fetched from backend
      });
    } else {
      renderPopupUI(false, null); // Keep this for immediate feedback on failure
      activationStatusDiv.innerHTML = `<span style="color: #ff6b7a;">Activation Failed: ${response.message || 'Invalid key or server error.'}</span>`;
      Swal.fire({
        title: 'Activation Failed',
        text: response.message || 'Invalid key or server error.',
        icon: 'error',
        background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
        color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
      });
    }
}
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
  activationView.classList.remove('active');
  featuresView.classList.remove('active');

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
          <button class="button-primary edit-profile-button" data-hostname="${hostname}">Edit</button>
          <button class="button-danger delete-profile-button" data-hostname="${hostname}">Delete</button>
        </div>
      `;
      profilesList.appendChild(li);
    }
  });
}

profilesList.addEventListener('click', (e) => {
  if (e.target.classList.contains('delete-profile-button')) {
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
  } else if (e.target.classList.contains('edit-profile-button')) {
    const hostname = e.target.dataset.hostname;
    editProfile(hostname);
  }
});

const openTestProfileButton = document.getElementById("open-test-profile");
if (openTestProfileButton) {
  openTestProfileButton.addEventListener("click", () => {
chrome.tabs.create({
  url: "https://rizqiahsansetiawan.ct.ws/ext/test_profile.html"
});
  });
}


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

async function editProfile(hostname) {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    Swal.fire({
      title: 'Error',
      text: 'Could not find an active tab. Please open a tab and try again.',
      icon: 'error',
      background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
      color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
    });
    return;
  }

  if (tab.url.startsWith('chrome://')) {
    Swal.fire({
      title: 'Error',
      text: 'Cannot edit profiles on Chrome system pages.',
      icon: 'error',
      background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
      color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
    });
    return;
  }
  
  if (new URL(tab.url).hostname !== hostname) {
      Swal.fire({
          title: 'Error',
          text: `Cannot edit this profile. You are currently on ${new URL(tab.url).hostname}, but the profile is for ${hostname}. Please navigate to the correct website to edit its profile.`,
          icon: 'error',
          background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
          color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
      });
      return;
  }

  const { customProfiles } = await chrome.storage.local.get({ customProfiles: {} });
  const profileToEdit = customProfiles[hostname];

  if (!profileToEdit) {
    Swal.fire({
      title: 'Error',
      text: `Profile for ${hostname} not found.`,
      icon: 'error',
      background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
      color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
    });
    return;
  }

  chrome.runtime.sendMessage({
    action: 'startProfileEditing', // New action for editing
    tabId: tab.id,
    hostname: hostname,
    profile: profileToEdit, // Pass the profile to the content script
  });

  window.close();
}

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

// --- Export Profiles ---
document.getElementById('export-profiles').addEventListener('click', async () => {
  const { customProfiles } = await chrome.storage.local.get({ customProfiles: {} });
  const dataStr = JSON.stringify(customProfiles, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'smart_filler_profiles.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  Swal.fire({
    title: 'Profiles Exported!',
    text: 'Your custom profiles have been saved to smart_filler_profiles.json',
    icon: 'success',
    background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
    color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
  });
});

// --- Import Profiles ---
document.getElementById('import-profiles').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});

document.getElementById('import-file-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const importedProfiles = JSON.parse(e.target.result);

      if (typeof importedProfiles !== 'object' || Array.isArray(importedProfiles)) {
        throw new Error('Invalid JSON format. Expected an object.');
      }
      
      // Basic validation: check if imported profiles have expected structure keys
      for (const hostname in importedProfiles) {
        const profile = importedProfiles[hostname];
        if (!profile.questionListContainer || !profile.questionBlock || !profile.questionText || !profile.answerField) {
          throw new Error(`Profile for ${hostname} has an invalid structure.`);
        }
      }

      const { customProfiles } = await chrome.storage.local.get({ customProfiles: {} });
      
      const confirmResult = await Swal.fire({
        title: 'Import Profiles',
        html: `Do you want to merge these profiles with your existing ones?
               <br><br>Existing profiles with the same hostname will be <strong>overwritten</strong>.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, import them!',
        cancelButtonText: 'No, cancel',
        background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
        color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
      });

      if (confirmResult.isConfirmed) {
        const mergedProfiles = { ...customProfiles, ...importedProfiles };
        await chrome.storage.local.set({ customProfiles: mergedProfiles });
        loadProfiles(); // Reload the list to show imported profiles
        Swal.fire({
          title: 'Profiles Imported!',
          text: 'Your custom profiles have been successfully imported.',
          icon: 'success',
          background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
          color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
        });
      }

    } catch (error) {
      console.error('Error importing profiles:', error);
      Swal.fire({
        title: 'Import Failed!',
        text: `There was an error importing your profiles: ${error.message}. Please ensure it's a valid JSON file.`,
        icon: 'error',
        background: darkModeToggle.checked ? '#0B0F14' : '#ffffff',
        color: darkModeToggle.checked ? '#F2F4F6' : '#2b2b2b'
      });
    } finally {
      // Clear the file input value to allow importing the same file again
      event.target.value = '';
    }
  };
  reader.readAsText(file);
});

