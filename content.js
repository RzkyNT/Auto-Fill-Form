if (window.hasRunContentScript) {
  console.warn("Content script already run. Skipping re-initialization.");
} else {
  window.hasRunContentScript = true;
  initContentScript(); // <== jalankan semua logic di sini
}
function initContentScript() {
// --- Message Listener ---
// The main listener is updated to route to the new guided profile creation mode.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showContentToast' && request.toast) {
    showContentToast(request.toast.title, request.toast.icon);
    sendResponse({ status: 'ok' });
  } else if (request.action === 'startSelection') {
    // This now triggers the new guided mode. Pass existingProfile and hostname if available.
    startGuidedProfileCreation(request.existingProfile, request.hostname); 
    sendResponse({ status: 'guided_selection_started' });
  }
  // It's crucial to return true if you intend to send a response asynchronously,
  // although in this refactored version, most responses are simple acknowledgements.
  return true; 
});

// Listen for manual trigger
window.addEventListener("fakeFiller:run", doFakeFill);
window.addEventListener("fakeFiller:smartFill", doSmartFill);


let smartFillSession = null;
let answerToastTimer = null;
let kahootHighlightedOption = null;
let quizContentObserver = null;
let debounceTimer = null;
let isLightTheme = false; // Global variable to store theme state

function debounce(func, delay) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(func, delay);
}

function initializeSmartFillSession() {
  smartFillSession = {
    stopRequested: false,
    stopSignalResolver: null, // New field to hold the resolve function
    currentQuestionHash: null, // To prevent re-processing the same question
    totalSteps: 0,
    completedSteps: 0,
    currentEntry: null,
  };
}


function ensureSmartFillSession() {
  if (!smartFillSession) {
    initializeSmartFillSession();
  }
}

// Auto-run if enabled
function injectSweetAlert2() {
  return new Promise((resolve) => {
    if (window.Swal) return resolve(true); // Sudah loaded

    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = chrome.runtime.getURL('vendor/sweetalert2/sweetalert2.min.css');
    document.head.appendChild(cssLink);

    const jsScript = document.createElement('script');
    jsScript.src = chrome.runtime.getURL('vendor/sweetalert2/sweetalert2.min.js');
    jsScript.onload = () => resolve(true); // <--- MENUNGGU SELESAI
    document.head.appendChild(jsScript);
  });
}

async function showToast(icon, title, timer = 3000) {
  await injectSweetAlert2(); // <--- pastikan loaded dulu

  if (!window.Swal) {
    showContentToast(title, icon);
    return;
  }

  Swal.fire({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer,
    timerProgressBar: true,
    icon,
    text: title,
    background: isLightTheme ? '#ffffff' : '#0B0F14',
    color: isLightTheme ? '#2b2b2b' : '#F2F4F6'
  });
}

window.addEventListener('load', async () => {
  chrome.storage.sync.get(["autoRun"], (result) => {
    if (result.autoRun) {
      setTimeout(doFakeFill, 500);
    }
  });

  
  // Inject SweetAlert2 here
  injectSweetAlert2();

  // Create the UI first
  await createTriggerOverlay();
  enableUserSelect();

  // Always update the button state on load, but do not try to enter fullscreen automatically.
  updateFullscreenButtonState();
});

  // Fetch theme preference on load
  chrome.storage.local.get("themeMode", (result) => {
    isLightTheme = (result.themeMode === "light");
  });

async function doFakeFill() {
  const isGForm = window.location.hostname === 'docs.google.com' && window.location.pathname.includes('/forms/');
  
  if (isGForm) {
    console.log("Smart Filler Running (Google Form Mode)...");
    await doFakeFillGForm();
  } else {
    console.log("Smart Filler Running (Standard Mode)...");
    await doFakeFillStandard();
  }
}

/**
 * Fills standard HTML forms with random data.
 */
async function doFakeFillStandard() {
  const fields = document.querySelectorAll("input:not([type=hidden]), textarea, select");
  
  for (const f of fields) {
    if (f.value && f.type !== 'radio' && f.type !== 'checkbox') continue;

    const type = f.type?.toLowerCase() || f.tagName.toLowerCase();
    const metadata = getFieldMetadata(f);

    if (type === "text" || type === "email" || type === "tel" || type === "search" || type === "url") {
      if (metadata.includes('nik')) f.value = FakeGen.randomNIK();
      else if (metadata.includes('phone') || metadata.includes('telp')) f.value = FakeGen.randomPhoneNumber();
      else if (type === "email" || metadata.includes('email')) f.value = FakeGen.randomEmail();
      else if (metadata.includes('nama') || metadata.includes('name')) f.value = FakeGen.randomName();
      else if (metadata.includes('address') || metadata.includes('alamat')) f.value = await FakeGen.randomAddress();
      else f.value = await FakeGen.randomWords(2);
    } else if (type === "password") {
      f.value = FakeGen.randomString(12);
    } else if (type === "number") {
      f.value = FakeGen.randomNumber();
    } else if (type === "textarea") {
      f.value = await FakeGen.randomWords(20);
    } else if (type === "checkbox") {
      f.checked = Math.random() > 0.5;
    } else if (type === "radio") {
      const radios = document.getElementsByName(f.name);
      if (radios.length > 0) FakeGen.pick(Array.from(radios)).checked = true;
    } else if (f.tagName.toLowerCase() === "select") {
      if (f.options.length > 1) f.selectedIndex = FakeGen.randomNumber(1, f.options.length - 1);
    }

    f.dispatchEvent(new Event("input", { bubbles: true }));
    f.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/**
 * Fills Google Forms with random data.
 */
async function doFakeFillGForm() {
    const questions = document.querySelectorAll('div[role="listitem"]');

    for (const q of questions) {
        const questionText = (q.querySelector('div[role="heading"]')?.textContent || '').trim().toLowerCase();

        // 1. Text Inputs
        const textInput = q.querySelector('input[type="text"], textarea');
        if (textInput) {
            if (questionText.includes('nik')) textInput.value = FakeGen.randomNIK();
            else if (questionText.includes('phone') || questionText.includes('telp')) textInput.value = FakeGen.randomPhoneNumber();
            else if (questionText.includes('email')) textInput.value = FakeGen.randomEmail();
            else if (questionText.includes('nama') || questionText.includes('name')) textInput.value = FakeGen.randomName();
            else if (questionText.includes('address') || questionText.includes('alamat')) textInput.value = await FakeGen.randomAddress();
            else if (textInput.tagName.toLowerCase() === 'textarea') textInput.value = await FakeGen.randomWords(25);
            else textInput.value = await FakeGen.randomWords(3);
            
            textInput.dispatchEvent(new Event('input', { bubbles: true }));
            continue;
        }

        // 2. Multiple Choice & Checkboxes
        const choices = q.querySelectorAll('div[role="radio"], div[role="checkbox"]');
        if (choices.length > 0) {
            if (choices[0].getAttribute('role') === 'radio') {
                FakeGen.pick(Array.from(choices)).click();
            } else {
                choices.forEach(c => { if (Math.random() > 0.5) c.click(); });
            }
            continue;
        }

        // 3. Dropdown
        const dropdown = q.querySelector('div[role="listbox"]');
        if (dropdown) {
            dropdown.click();
            await new Promise(resolve => setTimeout(resolve, 200));
            const options = document.querySelectorAll('div[role="option"][data-value]');
            const validOptions = Array.from(options).filter(o => o.getAttribute('data-value'));
            if (validOptions.length > 0) {
                FakeGen.pick(validOptions).click();
            }
        }
    }
}

/**
 * Sends a prompt to the background service worker to call the configured AI provider.
 * @param {string} prompt The prompt to send to the AI.
 * @returns {Promise<string>} A promise that resolves with the AI's answer.
 */
function getAiResponse(prompt) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "callAiApi", prompt }, (response) => {
      if (chrome.runtime.lastError) {
        // Handle errors from the extension runtime itself
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (response.error) {
        return reject(new Error(response.error));
      }
      resolve(response.answer);
    });
  });
}

function formatAiResponseForDisplay(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Creates an overlay that exposes the current smart-fill progress.
 */
function createProgressOverlay() {
  removeProgressOverlay();
  if (!smartFillSession) {
    initializeSmartFillSession();
  }
  const overlay = document.createElement("div");
  overlay.id = "fake-filler-overlay";
  overlay.innerHTML = `
    <div class="overlay-card">
      <div class="overlay-header">
        <div>
          <div class="overlay-title">Smart Filler AI</div>
          <div class="overlay-detail">Memperhatikan instruksi...</div>
        </div>
        <button type="button" class="overlay-stop-button">Stop</button>
      </div>
      <div class="overlay-status">Preparing smart fill...</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%;"></div>
      </div>
      <ul class="overlay-history"></ul>
    </div>
  `;
  const style = document.createElement("style");
  style.id = "fake-filler-overlay-style";
  style.textContent = `
    #fake-filler-overlay {
      position: fixed;
      inset: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483647;
      background: rgba(4, 7, 13, 0.82);
    }
    .overlay-card {
      background: rgba(4,7,13,0.9);
      border-radius: 16px;
      padding: 20px;
      max-width: 360px;
      width: 100%;
      border: 1px solid rgba(255,255,255,0.06);
      box-shadow: 0 30px 80px rgba(0,0,0,0.65);
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      text-align: left;
      color: #F2F4F6;
    }
    .overlay-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }
    .overlay-title {
      font-size: 1.2em;
      font-weight: 700;
      color: #25D366;
    }
    .overlay-detail {
      font-size: 0.85em;
      color: rgba(242,244,246,0.65);
    }
    .overlay-status {
      font-size: 1em;
      font-weight: 600;
      color: #F2F4F6;
      margin-bottom: 12px;
    }
    .overlay-history {
      list-style: none;
      padding: 0;
      margin: 12px 0 0 0;
      max-height: 160px;
      overflow-y: auto;
      border-top: 1px solid rgba(255,255,255,0.08);
      padding-top: 8px;
    }
    .overlay-history li {
      margin-bottom: 6px;
      font-size: 0.85em;
      color: rgba(242,244,246,0.75);
    }
    .progress-bar {
      width: 100%;
      height: 6px;
      background: rgba(255,255,255,0.08);
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 12px;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(135deg, #25D366, #2BE07B);
      transition: width 0.2s ease;
      width: 0;
    }
    .overlay-stop-button {
      background: transparent;
      color: #ff6b7a;
      border: 1px solid rgba(255,107,122,0.6);
      border-radius: 8px;
      padding: 6px 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s ease, color 0.2s ease;
    }
    .overlay-stop-button:hover {
      background: rgba(255,107,122,0.15);
      color: #fff;
    }
  `;
  document.body.appendChild(style);
  document.body.appendChild(overlay);
  const stopButton = overlay.querySelector(".overlay-stop-button");
  stopButton.addEventListener("click", () => {
    if (smartFillSession) {
      smartFillSession.stopRequested = true;
      updateProgressOverlay("Cancellation requested", "Tunggu sampai AI berhenti");
      // Resolve the promise to stop handleCustomProfile
      if (smartFillSession.stopSignalResolver) {
        smartFillSession.stopSignalResolver();
        smartFillSession.stopSignalResolver = null;
      }
    }
  });
}

function updateProgressOverlay(status, detail) {
  const overlay = document.getElementById("fake-filler-overlay");
  if (!overlay) return;
  const statusEl = overlay.querySelector(".overlay-status");
  if (statusEl && status) statusEl.textContent = status;
  appendProgressHistory(status, detail);
  recordHistoryEvent(status, detail);
}

function appendProgressHistory(status, detail) {
  const overlay = document.getElementById("fake-filler-overlay");
  if (!overlay) return;
  const historyEl = overlay.querySelector(".overlay-history");
  if (!historyEl) return;
  const formattedDetail = formatAiResponseForDisplay(detail); // Apply formatting
  const entry = document.createElement("li");
  entry.innerHTML = `<strong>${status}</strong>${formattedDetail ? ` — ${formattedDetail}` : ""}`;
  historyEl.prepend(entry);
  while (historyEl.children.length > 6) {
    historyEl.removeChild(historyEl.lastChild);
  }
}

function recordHistoryEvent(status, detail) {
  if (!smartFillSession?.currentEntry) return;
  smartFillSession.currentEntry.events = smartFillSession.currentEntry.events || [];
  smartFillSession.currentEntry.events.push({
    label: status,
    detail: detail || "",
    timestamp: Date.now(),
  });
  if (smartFillSession.currentEntry.events.length > 12) {
    smartFillSession.currentEntry.events.shift();
  }
}

function updateProgressBar(ratio) {
  const overlay = document.getElementById("fake-filler-overlay");
  if (!overlay) return;
  const fill = overlay.querySelector(".progress-fill");
  if (!fill) return;
  const percent = Math.min(100, Math.max(0, ratio * 100));
  fill.style.width = `${percent}%`;
}

function removeProgressOverlay() {
  const overlay = document.getElementById("fake-filler-overlay");
  const style = document.getElementById("fake-filler-overlay-style");
  if (overlay) overlay.remove();
  if (style) style.remove();
  if (smartFillSession) {
    smartFillSession.stopRequested = false;
    smartFillSession.totalSteps = 0;
    smartFillSession.completedSteps = 0;
    smartFillSession.currentEntry = null;
  }
}

function startHistoryEntry(questionText, platform) {
  if (!smartFillSession) return;
  smartFillSession.currentEntry = {
    formName: document.title || window.location.hostname,
    formUrl: window.location.href,
    question: questionText,
    answer: "",
    choices: [],
    status: "pending",
    timestamp: Date.now(),
    platform: platform || "unknown",
    events: [],
  };
}

function finalizeHistoryEntry(status, answer) {
  if (!smartFillSession?.currentEntry) return;
  smartFillSession.currentEntry.status = status;
  smartFillSession.currentEntry.answer = answer || smartFillSession.currentEntry.answer;
  smartFillSession.currentEntry.timestamp = Date.now();
  saveSmartFillHistory(smartFillSession.currentEntry);
  smartFillSession.currentEntry = null;
}

function saveSmartFillHistory(entry) {
  const record = {
    formName: entry.formName || "",
    formUrl: entry.formUrl || window.location.href,
    question: entry.question || "",
    answer: entry.answer || "",
    choices: entry.choices || [],
    status: entry.status || "answered",
    timestamp: entry.timestamp || Date.now(),
    events: entry.events || [],
  };

  chrome.storage.local.get({ smartFillHistory: [] }, (result) => {
    const history = [record, ...result.smartFillHistory].slice(0, 40);
    chrome.storage.local.set({ smartFillHistory: history });
  });
}

/**
 * Retrieves the list of answered question hashes from local storage.
 * @returns {Promise<string[]>} A promise that resolves with an array of hashes.
 */
function getAnsweredQuestionHashes() {
  return new Promise(resolve => {
    chrome.storage.local.get({ answeredQuestionHashes: [] }, (result) => {
      resolve(result.answeredQuestionHashes || []);
    });
  });
}

/**
 * Adds a hash to the list of answered questions in local storage.
 * Keeps the list at a maximum of 200 entries.
 * @param {string} newHash The hash to add.
 * @returns {Promise<void>}
 */
async function addAnsweredQuestionHash(newHash) {
  if (!newHash) return;
  const hashes = await getAnsweredQuestionHashes();
  if (!hashes.includes(newHash)) {
    const updatedHashes = [newHash, ...hashes].slice(0, 200);
    return new Promise(resolve => {
      chrome.storage.local.set({ answeredQuestionHashes: updatedHashes }, () => {
        console.log(`Question hash saved as answered.`);
        resolve();
      });
    });
  }
}

/**
 * Injects CSS to re-enable user selection on pages that disable it.
 */
function enableUserSelect() {
  const style = document.createElement("style");
  style.id = "enable-user-select-style";
  style.textContent = `
    /* Re-enable text selection */
    * {
      -webkit-user-select: text !important; /* Safari */
      -moz-user-select: text !important;    /* Firefox */
      -ms-user-select: text !important;     /* IE 10+ */
      user-select: text !important;         /* Standard */
    }
  `;
  document.head.appendChild(style);

  // Forcefully re-enable context menu and selection.
  // Use capturing to prevent other listeners from running.
  const stopPropagation = e => e.stopPropagation();
  document.addEventListener('contextmenu', stopPropagation, true);
  document.addEventListener('selectstart', stopPropagation, true);
  document.addEventListener('dragstart', stopPropagation, true);

  // Nullify any inline event handlers on the body and document
  document.body.oncontextmenu = null;
  document.body.onselectstart = null;
  document.body.ondragstart = null;
  document.oncontextmenu = null;
  document.onselectstart = null;
  document.ondragstart = null;
}

// Action Button SVG icons
const fullscreenEnterIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M200-200h280v-80H280v-200h-80v280Zm280-560v-80h280v280h-80v-200H480Z"/></svg>`;
const fullscreenExitIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M280-200v-280h80v200h200v80H280Zm400-320v-200H480v-80h280v280h-80Z"/></svg>`;
const runAiIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></svg>`;
const cancelAiIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>`;
const resetSessionIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>`;
const chatIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M80-240v-480h800v480H80Zm120-80h560v-320H200v320Zm0 0v-320 320Z"/></svg>`;

/**
 * Shows a simple toast notification on the page.
 * @param {string} message The message to display.
 * @param {('success'|'error')} type The type of toast, for styling.
 */
function showContentToast(message, type = 'success') {
  const toastId = 'smart-fill-content-toast';
  const existingToast = document.getElementById(toastId);
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.id = toastId;
  toast.textContent = message;
  
  Object.assign(toast.style, {
    position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
    padding: '12px 20px', borderRadius: '8px', color: 'white', zIndex: '2147483647',
    fontFamily: '"Segoe UI", sans-serif', fontSize: '14px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    transition: 'opacity 0.3s ease, transform 0.3s ease', opacity: '0', transform: 'translate(-50%, 10px)'
  });
  toast.style.backgroundColor = type === 'error' ? '#d32f2f' : '#25D366';

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%)';
  }, 10);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, 10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Updates the fullscreen button's icon and style.
 */
function updateFullscreenButtonState() {
  const fullscreenButton = document.getElementById('fullscreen-button');
  if (!fullscreenButton) return;
  if (document.fullscreenElement) {
    fullscreenButton.classList.add('active');
    fullscreenButton.innerHTML = fullscreenExitIcon;
    fullscreenButton.title = 'Exit Fullscreen';
  } else {
    fullscreenButton.classList.remove('active');
    fullscreenButton.innerHTML = fullscreenEnterIcon;
    fullscreenButton.title = 'Enter Fullscreen';
  }
}



/**
 * Updates the AI button's icon and style based on the processing state.
 */
function updateAiButtonState(isProcessing) {
  const runAiButton = document.getElementById('run-ai-button');
  if (!runAiButton) return; // Do nothing if the button isn't on the page

  if (isProcessing) {
    runAiButton.classList.add('processing');
    runAiButton.innerHTML = cancelAiIcon;
    runAiButton.title = 'Cancel AI';
  } else {
    runAiButton.classList.remove('processing');
    runAiButton.innerHTML = runAiIcon;
    runAiButton.title = 'Run AI';
  }
}

/**
 * Creates a floating action button to trigger the Smart Fill.
 */
async function createTriggerOverlay() {
  const { customProfiles } = await chrome.storage.local.get({ customProfiles: {} });
  const host = window.location.hostname;
  const hasCustomProfile = !!customProfiles[host];
  const supportedPlatforms = ['docs.google.com', 'wayground.com', 'quizziz.com', 'kahoot.it', 'play.kahoot.it', '115.124.76.241'];
  const shouldShowOverlay = hasCustomProfile || supportedPlatforms.some(p => host.includes(p));

  if (!shouldShowOverlay) return;
  if (document.getElementById('smart-fill-trigger-container')) return;

  const triggerContainer = document.createElement("div");
  triggerContainer.id = "smart-fill-trigger-container";
  triggerContainer.innerHTML = `
    <button id="smart-fill-trigger-button">
        <div class="smart-fill-icon"><span></span><span></span><span></span></div>
    </button>
    <a href="#" id="run-ai-button" class="social-icon" title="Run AI">${runAiIcon}</a>
    <a href="#" id="fullscreen-button" class="social-icon" title="Toggle Fullscreen">${fullscreenEnterIcon}</a>
    <a href="#" id="reset-session-button" class="social-icon" title="Reset Session">${resetSessionIcon}</a>
    <a href="#" id="chat-overlay-button" class="social-icon" title="AI Chat">${chatIcon}</a>
  `;

  const style = document.createElement("style");
  style.id = "smart-fill-trigger-style";
  style.textContent = `
    #smart-fill-trigger-container {
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483645;
      width: 64px; height: 64px; display: flex; justify-content: center; align-items: center;
    }
    #smart-fill-trigger-button {
      width: 100%; height: 100%; background: #EDE1FF; border-radius: 18px; border: none;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      transition: transform .3s cubic-bezier(0.68, -0.55, 0.265, 1.55), box-shadow .2s ease;
      position: relative; z-index: 10;
    }
    #smart-fill-trigger-container.active #smart-fill-trigger-button { transform: rotate(45deg); }
    #smart-fill-trigger-button:hover { box-shadow: 0 6px 15px rgba(0,0,0,0.28); }
    #smart-fill-trigger-button .smart-fill-icon { display: flex; flex-direction: column; gap: 5px; transition: transform 0.2s ease; }
    #smart-fill-trigger-container.active #smart-fill-trigger-button .smart-fill-icon { transform: rotate(-45deg); }
    #smart-fill-trigger-button .smart-fill-icon span { width: 24px; height: 4px; background: #5E3BAE; border-radius: 4px; }
    .social-icon {
      position: absolute; display: flex; align-items: center; justify-content: center;
      width: 48px; height: 48px; border-radius: 50%; background: #f0f0f0;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); text-decoration: none;
      opacity: 0; visibility: hidden; transform: scale(0.5);
      transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55); z-index: 5;
    }
    #smart-fill-trigger-container.active .social-icon {
        opacity: 1;
        visibility: visible;
        transform: scale(1);
    }
    
    /* Correctly arrange all 4 buttons in a 90-degree arc */
    #smart-fill-trigger-container.active #run-ai-button {
      transform: translate(0, -80px); /* Top */
      transition-delay: 0.05s;
    }
    #smart-fill-trigger-container.active #chat-overlay-button {
      transform: translate(-57px, -57px); /* Diagonal Up-Left */
      transition-delay: 0.1s;
    }
    #smart-fill-trigger-container.active #fullscreen-button {
      transform: translate(-80px, 0); /* Left */
      transition-delay: 0.15s;
    }
     #smart-fill-trigger-container.active #reset-session-button {
      transform: translate(-70px, 40px); /* Custom position below left */
      transition-delay: 0.2s;
    }

    .social-icon:hover { 
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2); 
    }
    #run-ai-button:hover { background: #c8e6c9; }
    #run-ai-button.processing, #run-ai-button.processing:hover { background-color: #ffcdd2; }
    #fullscreen-button:hover { background: #bbdefb; }
    #fullscreen-button.active, #fullscreen-button.active:hover { background-color: #81d4fa; }
    #reset-session-button:hover { background: #ffecb3; }
    #chat-overlay-button:hover { background: #d1c4e9; }
  `;

  document.head.appendChild(style);
  document.body.appendChild(triggerContainer);

  document.getElementById('smart-fill-trigger-button').addEventListener('click', (e) => {
    e.preventDefault();
    triggerContainer.classList.toggle('active');
  });

  document.getElementById('run-ai-button').addEventListener('click', (e) => {
    e.preventDefault();
    triggerContainer.classList.remove('active');
    const isProcessing = e.currentTarget.classList.contains('processing');
    if (isProcessing) {
      ensureSmartFillSession();
      if (smartFillSession) smartFillSession.stopRequested = true;
      updateAiButtonState(false);
    } else {
      doSmartFill();
    }
  }, { capture: true });

  document.getElementById('fullscreen-button').addEventListener('click', (e) => {
    e.preventDefault();
    handleFullscreen();
    triggerContainer.classList.remove('active');
  });

  document.getElementById('reset-session-button').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.storage.local.remove("answeredQuestionHashes", () => {
      showContentToast(chrome.runtime.lastError ? "Error resetting session" : "Current page session has been reset.", chrome.runtime.lastError ? "error" : "success");
    });
    triggerContainer.classList.remove('active');
  });

  document.getElementById('chat-overlay-button').addEventListener('click', (e) => {
    e.preventDefault();
    const chatOverlay = document.getElementById('ai-chat-overlay-container');
    if (chatOverlay) chatOverlay.style.display = 'flex';
    triggerContainer.classList.remove('active');
  });

  updateFullscreenButtonState();
  updateAiButtonState(false);
  document.addEventListener('fullscreenchange', updateFullscreenButtonState);
  document.addEventListener('click', (e) => {
    if (!triggerContainer.contains(e.target) && triggerContainer.classList.contains('active')) {
      triggerContainer.classList.remove('active');
    }
  });
  createChatOverlay(); // Create the chat window, but keep it hidden
}

function createChatOverlay() {
  if (document.getElementById('ai-chat-overlay-container')) return;

  const chatContainer = document.createElement('div');
  chatContainer.id = 'ai-chat-overlay-container';
  chatContainer.style.display = 'none';
  chatContainer.innerHTML = `
    <div id="ai-chat-window">
      <div id="ai-chat-header">
        <h3>AI Chat</h3>
        <div>
          <button id="ai-chat-clear-button" title="Clear History">Clear</button>
          <button id="ai-chat-close-button" title="Close">&times;</button>
        </div>
      </div>
      <div id="ai-chat-messages"></div>
      <form id="ai-chat-form">
        <input type="text" id="ai-chat-input" placeholder="Ask the AI..." autocomplete="off">
        <button type="submit">Send</button>
      </form>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #ai-chat-overlay-container { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 2147483646; align-items: center; justify-content: center; }
    #ai-chat-window { width: 90%; max-width: 500px; height: 70%; max-height: 600px; background: #0B0F14; color: #F2F4F6; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); display: flex; flex-direction: column; }
    #ai-chat-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    #ai-chat-header div { display: flex; gap: 10px; }
    #ai-chat-header button { background: none; border: none; font-size: 16px; color: #aaa; cursor: pointer; }
    #ai-chat-close-button { font-size: 24px; padding: 0 5px; }
    #ai-chat-clear-button { font-size: 14px; border: 1px solid #555; padding: 4px 8px; border-radius: 6px;}
    #ai-chat-clear-button:hover, #ai-chat-close-button:hover { color: #fff; }
    #ai-chat-messages { flex-grow: 1; overflow-y: auto; padding: 20px; }
    .chat-message-bubble { max-width: 85%; padding: 10px 15px; border-radius: 15px; margin-bottom: 12px; line-height: 1.5; word-wrap: break-word; }
    .user-message { background: #25D366; color: #04070D; margin-left: auto; border-bottom-right-radius: 4px; }
    .bot-message { background: #11161C; color: #F2F4F6; margin-right: auto; border-bottom-left-radius: 4px; }
    .bot-message.error { background: rgba(255,107,122,0.2); color: #ff6b7a; }
    .loading-dots span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #888; animation: wave 1.3s linear infinite; }
    .loading-dots span:nth-of-type(2) { animation-delay: -1.1s; }
    .loading-dots span:nth-of-type(3) { animation-delay: -0.9s; }
    @keyframes wave { 0%, 60%, 100% { transform: initial; } 30% { transform: translateY(-8px); } }
    #ai-chat-form { display: flex; gap: 10px; padding: 15px 20px; border-top: 1px solid rgba(255,255,255,0.1); }
    #ai-chat-input { flex-grow: 1; background: #11161C; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 10px; color: #F2F4F6; }
    #ai-chat-form button { background: #25D366; color: #04070D; border: none; border-radius: 8px; padding: 10px 15px; cursor: pointer; }

    .chat-message-bubble { position: relative; } /* Needed for absolute positioning of button */
    .copy-message-button {
      position: absolute;
      top: 5px;
      right: 5px;
      background: rgba(255, 255, 255, 0.1);
      border: none;
      border-radius: 4px;
      padding: 3px;
      cursor: pointer;
      opacity: 0; /* Hidden by default */
      transition: opacity 0.2s ease;
      color: #F2F4F6;
    }
    .chat-message-bubble:hover .copy-message-button {
      opacity: 1; /* Show on hover */
    }
    .copy-message-button:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  `;
  
  document.head.appendChild(style);
  document.body.appendChild(chatContainer);

  const messagesContainer = document.getElementById('ai-chat-messages');
  const chatForm = document.getElementById('ai-chat-form');
  const input = document.getElementById('ai-chat-input');
  
  document.getElementById('ai-chat-close-button').addEventListener('click', () => chatContainer.style.display = 'none');
  chatContainer.addEventListener('click', (e) => { if (e.target === chatContainer) chatContainer.style.display = 'none'; });
  document.getElementById('ai-chat-clear-button').addEventListener('click', clearChatHistory);

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const messageText = input.value.trim();
    if (!messageText) return;
    
    const userMessage = { sender: 'user', text: messageText, timestamp: Date.now() };
    appendChatMessage(userMessage);
    saveChatMessage(userMessage);
    input.value = '';
    showChatLoadingIndicator();

    chrome.runtime.sendMessage({ action: "callChatApi", prompt: messageText }, (response) => {
      removeChatLoadingIndicator();
      const text = chrome.runtime.lastError?.message || response.error || response.answer;
      const isError = !!(chrome.runtime.lastError || response.error);
      const botMessage = { sender: 'bot', text: text, timestamp: Date.now(), isError: isError };
      appendChatMessage(botMessage);
      saveChatMessage(botMessage);
    });
  });

  function appendChatMessage(message) {
    const bubble = document.createElement('div');
    bubble.className = `chat-message-bubble ${message.sender}-message`;
    if (message.isError) bubble.classList.add('error');

    const messageContent = message.text;

    if (message.sender === 'bot') {
      // Use the new safe renderer for bot messages
      renderChatWithLatex(messageContent, bubble);
      
      const copyIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentColor"><path d="M160-400v400h480v-400H160Zm80 80h320v240H240v-240Zm-80-480v-80h480v80H160Zm560 560v-560h80v560h-80Zm-400-400v-80h480v80H320Zm80-80v-80h480v80H400Zm80-80v-80h480v80H480Z"/></svg>`;
      const copyButton = document.createElement('button');
      copyButton.className = 'copy-message-button';
      copyButton.innerHTML = copyIcon;
      copyButton.title = 'Copy to clipboard';
      copyButton.onclick = () => {
        navigator.clipboard.writeText(message.text)
          .then(() => {
            showContentToast('Copied to clipboard!', 'success');
          })
          .catch(err => {
            console.error('Failed to copy text: ', err);
            showContentToast('Failed to copy text.', 'error');
          });
      };
      bubble.appendChild(copyButton);

    } else {
      bubble.textContent = messageContent;
    }
    
    messagesContainer.appendChild(bubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  function showChatLoadingIndicator() {
    const bubble = document.createElement('div');
    bubble.id = 'chat-loading-indicator';
    bubble.className = 'chat-message-bubble bot-message loading-dots';
    bubble.innerHTML = '<span></span><span></span><span></span>';
    messagesContainer.appendChild(bubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function removeChatLoadingIndicator() {
    const indicator = document.getElementById('chat-loading-indicator');
    if (indicator) indicator.remove();
  }

  async function saveChatMessage(message) {
    const { aiChatHistory = [] } = await chrome.storage.local.get('aiChatHistory');
    aiChatHistory.push(message);
    const cappedHistory = aiChatHistory.slice(-50); // Keep last 50 messages
    await chrome.storage.local.set({ aiChatHistory: cappedHistory });
  }

  async function loadChatHistory() {
    const { aiChatHistory = [] } = await chrome.storage.local.get('aiChatHistory');
    messagesContainer.innerHTML = '';
    aiChatHistory.forEach(appendChatMessage);
  }

  function clearChatHistory() {
    messagesContainer.innerHTML = '';
    chrome.storage.local.remove('aiChatHistory');
    appendChatMessage({ sender: 'bot', text: 'Chat history cleared.' });
  }

  loadChatHistory(); // Load history when overlay is created
}

/**
 * Toggles fullscreen mode.
 */
function handleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => console.error(`Error enabling full-screen: ${err.message}`));
  } else {
    document.exitFullscreen();
  }
}

/**
 * Fills forms intelligently using Gemini AI.
 */
async function doSmartFill() {
  console.log("doSmartFill function initiated in content script.");
  updateAiButtonState(true); // Set button to "Cancel" state
  console.log("--- Smart Fill Initialized ---");
  ensureSmartFillSession();
  const showOverlay = await getOverlayPreference();
  if (showOverlay) {
    createProgressOverlay();
  } else {
    removeProgressOverlay();
  }
  let encounteredError = null;

  const { customProfiles } = await chrome.storage.local.get({ customProfiles: {} });
  const hostname = window.location.hostname;
  const customProfile = customProfiles[hostname];

  if (customProfile) {
    console.log(`Custom profile found for ${hostname}.`);
    try {
        await handleCustomProfile(customProfile);
    } catch (error) {
        encounteredError = error;
        // Error handling is duplicated, might refactor later
        console.error("Error during Custom Profile Smart Fill:", error);
        updateProgressOverlay("Error", error.message);
        finalizeHistoryEntry("error", smartFillSession?.currentEntry?.answer || "");
        showContentToast(`An error occurred: ${error.message}`, 'error');
    } finally {
        console.log("--- Smart Fill Finally Block ---");
        // Cleanup is now handled directly by handleCustomProfile when its stopPromise resolves.
        // This block only cleans up general UI and resets session state.
        if (smartFillSession) {
            if (smartFillSession.stopRequested) {
                 updateProgressOverlay("Smart fill stopped", "Smart form filling stopped by user.");
            } else {
                // This branch implies the continuous process might have completed without explicit stop,
                // which is less likely for quizzes, but still cleans up.
                updateProgressOverlay("Smart fill complete", "Smart form filling completed!");
            }
            // Ensure UI is removed
            removeProgressOverlay();
        }
        updateAiButtonState(false); // Reset button state
        smartFillSession = null; // Clear session state for next run
    }
  } else {
    const isGForm = hostname === 'docs.google.com' && window.location.pathname.includes('/forms/');
    const isWayground = hostname.includes('wayground.com');
    const isQuizziz = hostname.includes('quizziz.com');
    const isKahoot = hostname.includes('kahoot.it') || hostname.includes('play.kahoot.it');
    const isCbt = hostname === '115.124.76.241';

    if (!isGForm && !isWayground && !isQuizziz && !isKahoot && !isCbt) {
      showContentToast("Smart Fill currently supports Google Forms, wayground.com, quizziz.com, kahoot.it, and the CBT instance.", 'error');
      console.warn("Smart Fill aborted: Unsupported host.");
      removeProgressOverlay();
      updateAiButtonState(false); // Reset button state
      return;
    }

    try {
      if (isGForm) {
        await handleGoogleForms();
      } else {
        await handleQuizPlatforms(hostname);
      }
    } catch (error) {
      encounteredError = error;
      console.error("Error during Smart Fill:", error);
      updateProgressOverlay("Error", error.message);
      finalizeHistoryEntry("error", smartFillSession?.currentEntry?.answer || "");
      showContentToast(`An error occurred while using the AI provider: ${error.message}`, 'error');
    } finally {
      console.log("--- Smart Fill Completed ---");
      if (smartFillSession) {
        if (!encounteredError && !(smartFillSession && smartFillSession.stopRequested)) {
          updateProgressOverlay("Smart fill complete", "Smart form filling completed!");
          updateProgressBar(1);
          setTimeout(removeProgressOverlay, 600);
        } else {
          setTimeout(removeProgressOverlay, 1500);
        }
      }
      updateAiButtonState(false); // Reset button state when done
    }
  }
}

async function processCurrentQuizState(profile) {
  try {
    if (smartFillSession?.stopRequested) {
      console.log("processCurrentQuizState: Stop requested.");
      return; // Exit if stop is requested
    }
    
    clearKahootRecommendation(); // Just in case
    
    const questionElement = document.querySelector(profile.question);
    const rawQuestionText = questionElement ? questionElement.textContent : null; // Get raw text to hash

    if (!rawQuestionText) {
      console.warn("processCurrentQuizState: Could not find question element or text. Waiting for next mutation.");
      // If the question element is not found, it might be in an intermediate state.
      // We don't throw an error here, just wait for the element to appear via mutation.
      return;
    }

    const currentQuestionHash = btoa(encodeURIComponent(rawQuestionText)); // Simple hash for comparison
    
    const answeredHashes = await getAnsweredQuestionHashes();
    if (answeredHashes.includes(currentQuestionHash)) {
      console.log("Question already answered in a previous session. Skipping.");
      // Optional: Visual feedback that it's skipped
      if (questionElement) {
        questionElement.style.border = "2px solid #28a745"; // Green border
        setTimeout(() => { if(questionElement) questionElement.style.border = ""; }, 2000);
      }
      return;
    }

    if (smartFillSession.currentQuestionHash === currentQuestionHash) {
      console.log("processCurrentQuizState: Question text is the same. Skipping processing.");
      return; // Do nothing if the question hasn't changed
    }
    smartFillSession.currentQuestionHash = currentQuestionHash; // Update hash

    const questionText = sanitizeQuizText(rawQuestionText);
    if (!questionText) {
        console.warn("processCurrentQuizState: Sanitized question text is empty. Waiting for next mutation.");
        return;
    }

    startHistoryEntry(questionText, "custom");
    updateProgressOverlay("Listening to question", questionText);
    
    const answerElements = Array.from(document.querySelectorAll(profile.answers.join(',')));
    const options = answerElements.map(el => ({ label: sanitizeQuizText(el.textContent), element: el })).filter(opt => opt.label);

    if (!options.length) {
        console.warn("processCurrentQuizState: Could not find any answer elements using the saved selectors. Waiting for next mutation.");
        return;
    }

    if (smartFillSession?.currentEntry) {
      smartFillSession.currentEntry.choices = options.map(opt => opt.label);
    }
    
    const prompt = `Question: "${questionText}"\nOptions: [${options.map(opt => opt.label).join(", ")}]\n\nFrom the options, which is the most likely correct answer? Respond with only the exact text of the best option. Do not add any explanation.`;
    console.log("Sending Prompt to Background:", prompt);
    updateProgressOverlay("Consulting AI provider...", questionText);

    const aiAnswer = await getAiResponse(prompt);
    console.log("AI Answer received:", aiAnswer);
    console.log("Comparing against options:", options.map(o => o.label));
    updateProgressOverlay("Matching AI response...", aiAnswer);

    const target = matchOption(options, aiAnswer);

    if (target) {
        target.element.click();
        finalizeHistoryEntry("answered (custom)", target.label);
        await addAnsweredQuestionHash(currentQuestionHash);
    } else {
        finalizeHistoryEntry("no match (custom)", aiAnswer);
    }
    updateProgressBar(1);

  } catch (error) {
    console.error("Error during processing quiz state:", error);
    updateProgressOverlay("Error", error.message);
    finalizeHistoryEntry("error", smartFillSession?.currentEntry?.answer || "");
    showContentToast('error', `An error occurred: ${error.message}`, 5000);
    // On error, the process should stop
    if (smartFillSession) {
      smartFillSession.stopRequested = true;
      if (smartFillSession.stopSignalResolver) {
        smartFillSession.stopSignalResolver();
        smartFillSession.stopSignalResolver = null;
      }
    }
    if (quizContentObserver) { // Ensure observer is disconnected on error
      quizContentObserver.disconnect();
      quizContentObserver = null;
    }
  }
}

async function handleCustomProfile(profile) {
  clearKahootRecommendation();

  const questionListContainer = document.querySelector(profile.questionListContainer);
  if (!questionListContainer) {
    throw new Error("Question list container element not found. Profile may be invalid or page not ready.");
  }

  ensureSmartFillSession();
  const showOverlay = await getOverlayPreference();
  if (showOverlay) {
    createProgressOverlay();
  } else {
    removeProgressOverlay();
  }

  const allQuestions = questionListContainer.querySelectorAll(profile.questionBlock);
  smartFillSession.totalSteps = allQuestions.length;
  console.log(`Found ${allQuestions.length} questions using custom profile.`);

  for (let i = 0; i < allQuestions.length; i++) {
    if (smartFillSession?.stopRequested) {
      console.log("Smart fill stopped by user during question iteration.");
      break;
    }
    const questionElement = allQuestions[i];
    await processSingleCustomProfileQuestion(questionElement, profile, i + 1, allQuestions.length);
    // Add a small delay to avoid overwhelming the page or the AI
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  removeProgressOverlay();
  updateAiButtonState(false);
  console.log("Custom profile smart fill process completed.");
}

// New function to process a single question based on the custom profile
async function processSingleCustomProfileQuestion(questionBlockElement, profile, index, total) {
  try {
    const questionTextElement = questionBlockElement.querySelector(profile.questionText);
    if (!questionTextElement) {
      console.warn(`Could not find question text within block for question ${index}. Skipping.`);
      return;
    }
    const questionText = (questionTextElement.textContent || '').trim();

    if (!questionText) {
      console.warn(`Question text is empty for question ${index}. Skipping.`);
      return;
    }

    const questionHash = btoa(encodeURIComponent(questionText));
    const answeredHashes = await getAnsweredQuestionHashes();
    if (answeredHashes.includes(questionHash)) {
      console.log(`Question ${index} already answered. Skipping.`);
      return;
    }

    startHistoryEntry(questionText);
    console.log(`--- Processing Question ${index}/${total}: "${questionText}"`);
    updateProgressOverlay(`Reading question ${index}/${total}`, questionText);

    const detectedAnswerField = getAnswerFieldAndTypeInBlock(questionBlockElement);

    if (!detectedAnswerField) {
        console.warn(`No identifiable answer field found in question block ${index}. Skipping.`);
        finalizeHistoryEntry("no identifiable answer field", smartFillSession?.currentEntry?.answer || "");
        await addAnsweredQuestionHash(questionHash);
        smartFillSession.completedSteps = index;
        updateProgressBar(index / Math.max(1, total));
        return;
    }

    let aiAnswer = null;

    if (detectedAnswerField.type === 'text_input') {
        const inputElement = detectedAnswerField.element;
        const prompt = `Provide a concise and appropriate answer for the following question: "${questionText}"`;
        updateProgressOverlay("Consulting AI provider...", questionText);
        aiAnswer = await getAiResponse(prompt);
        inputElement.value = aiAnswer;
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        finalizeHistoryEntry("answered (text input)", aiAnswer);
    } else if (detectedAnswerField.type === 'multiple_choice' || detectedAnswerField.type === 'checkbox_group') {
        const options = [];
        for (const el of detectedAnswerField.elements) {
            options.push({ element: el, label: (function() {
                let labelText = '';
                // 1. Try to find the text of the associated option via 'for' attribute
                if (el.id) {
                    const associatedLabel = questionBlockElement.querySelector(`label[for="${el.id}"]`);
                    if (associatedLabel) {
                        labelText = associatedLabel.textContent.trim();
                    }
                }
                
                // 2. If not found, try parent's text content (common for structures like <div><input>Text</div>)
                if (!labelText && el.parentElement) {
                    labelText = el.parentElement.textContent.trim();
                }

                // 3. If still not found, try next or previous sibling's text content
                if (!labelText && el.nextElementSibling) {
                    labelText = el.nextElementSibling.textContent.trim();
                }
                if (!labelText && el.previousElementSibling) {
                    labelText = el.previousElementSibling.textContent.trim();
                }
                
                // 4. Fallback to el.value if it's not a generic "on", "1", or "true" and it provides meaningful text
                if (!labelText && el.value && el.value.toLowerCase() !== 'on' && el.value.toLowerCase() !== '1' && el.value.toLowerCase() !== 'true') {
                    labelText = el.value;
                }
                
                // 5. Final fallback to ID for debugging if nothing else works
                if (!labelText) {
                    labelText = el.id;
                }
                return labelText;
            })() });
        }

        if (options.length === 0) {
            console.warn(`No answer options found for question ${index}. Skipping.`);
            finalizeHistoryEntry("no options", smartFillSession?.currentEntry?.answer || "");
            await addAnsweredQuestionHash(questionHash);
            return;
        }

        if (smartFillSession?.currentEntry) {
          smartFillSession.currentEntry.choices = options.map(opt => opt.label);
        }

        const prompt = `Question: "${questionText}"\nOptions: [${options.map(opt => opt.label).join(", ")}]\n\nFrom the options, which is the most likely correct answer? Respond with only the exact text of the best option. Do not add any explanation.`;
        updateProgressOverlay("Consulting AI provider...", questionText);
        aiAnswer = await getAiResponse(prompt);
        console.log("AI Answer received:", aiAnswer);
        console.log("Comparing against options:", options.map(o => o.label));
        updateProgressOverlay("Matching AI response...", aiAnswer);

        const target = matchOption(options, aiAnswer);
        if (target) {
            target.element.click();
            finalizeHistoryEntry("answered (choice)", target.label);
        } else {
            finalizeHistoryEntry("no match", aiAnswer);
        }
    } else if (detectedAnswerField.type === 'single_checkbox') {
        const checkboxElement = detectedAnswerField.element;
        const prompt = `Based on the question "${questionText}", should the checkbox be checked? Respond with only "YES" or "NO".`;
        updateProgressOverlay("Consulting AI provider...", questionText);
        aiAnswer = await getAiResponse(prompt);
        if (aiAnswer.toLowerCase() === 'yes') {
            checkboxElement.checked = true;
            finalizeHistoryEntry("checked", "YES");
        } else {
            checkboxElement.checked = false;
            finalizeHistoryEntry("unchecked", "NO");
        }
        checkboxElement.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (detectedAnswerField.type === 'dropdown') {
        const selectElement = detectedAnswerField.element;
        const options = Array.from(selectElement.options).map(opt => ({ element: opt, label: opt.textContent }));
        if (options.length === 0) {
            console.warn(`No options found for dropdown in question ${index}. Skipping.`);
            finalizeHistoryEntry("no dropdown options", smartFillSession?.currentEntry?.answer || "");
            await addAnsweredQuestionHash(questionHash);
            return;
        }

        if (smartFillSession?.currentEntry) {
            smartFillSession.currentEntry.choices = options.map(opt => opt.label);
        }

        const prompt = `Question: "${questionText}"\nDropdown Options: [${options.map(opt => opt.label).join(", ")}]\n\nFrom the options, which is the most likely correct option? Respond with only the exact text of the best option. Do not add any explanation.`;
        updateProgressOverlay("Consulting AI provider...", questionText);
        aiAnswer = await getAiResponse(prompt);
        console.log("AI Answer received:", aiAnswer);
        updateProgressOverlay("Matching AI response...", aiAnswer);

        const target = options.find(opt => normalizeQuizText(opt.label) === normalizeQuizText(aiAnswer));
        if (target) {
            selectElement.value = target.element.value;
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
            finalizeHistoryEntry("answered (dropdown)", target.label);
        } else {
            finalizeHistoryEntry("no match (dropdown)", aiAnswer);
        }
    } else {
        console.warn(`Unknown detected answer field type: ${detectedAnswerField.type} for question ${index}. Skipping.`);
        finalizeHistoryEntry("unknown type", smartFillSession?.currentEntry?.answer || "");
    }
    
    await addAnsweredQuestionHash(questionHash);
    smartFillSession.completedSteps = index;
    updateProgressBar(index / Math.max(1, total));

  } catch (error) {
    finalizeHistoryEntry("error", smartFillSession?.currentEntry?.answer || "");
    showContentToast(`An error occurred: ${error.message}`, 'error');
    if (smartFillSession) smartFillSession.stopRequested = true;
  }
}


function getOverlayPreference() {
  return new Promise(resolve => {
    chrome.storage.local.get({ showOverlay: true }, (result) => {
      resolve(result.showOverlay !== false);
    });
  });
}

async function handleGoogleForms() {
  const questions = document.querySelectorAll('div[role="listitem"]');
  console.log(`Found ${questions.length} question items.`);
  smartFillSession.totalSteps = questions.length;

  for (const [index, q] of questions.entries()) {
    if (smartFillSession?.stopRequested) break;
    try {
      await processGoogleFormQuestion(q, index, questions.length);
    } catch (error) {
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function processGoogleFormQuestion(q, index, total) {
  console.log(`\n--- Processing Question ${index + 1} ---`);
  updateProgressOverlay(
    `Reading question ${index + 1}/${total}`,
    q.querySelector('div[role="heading"]')?.textContent?.trim() || "No label detected"
  );
  const questionText = (q.querySelector('div[role="heading"]')?.textContent || '').trim();
  if (!questionText) {
    console.warn("Could not find question text for this item. Skipping.");
    return;
  }

  const questionHash = btoa(encodeURIComponent(questionText));
  const answeredHashes = await getAnsweredQuestionHashes();
  if (answeredHashes.includes(questionHash)) {
    console.log("Question already answered. Skipping.");
    // Visual indicator for G-Forms
    q.style.transition = 'background-color 0.5s ease';
    q.style.backgroundColor = 'rgba(232, 245, 233, 1)'; // A light green from Google's palette
    return;
  }

  startHistoryEntry(questionText);
  console.log(`Question Text: "${questionText}"`);

  try {
    await fillGoogleFormQuestion(q, questionText, questionHash);
  } catch (error) {
    finalizeHistoryEntry("error", smartFillSession?.currentEntry?.answer || "");
    throw error;
  }

  smartFillSession.completedSteps = index + 1;
  updateProgressBar((index + 1) / Math.max(1, smartFillSession.totalSteps));
  if (smartFillSession?.stopRequested) {
    updateProgressOverlay("Stopped", "Pengisian dihentikan oleh pengguna.");
  }
}

async function fillGoogleFormQuestion(q, questionText, questionHash) {
  try {
    const choices = q.querySelectorAll('div[role="radio"], div[role="checkbox"]');
    if (choices.length > 0) {
      const choiceLabels = Array.from(choices).map(c => (c.getAttribute('aria-label') || c.textContent || "").trim()).filter(Boolean);
      
      if (smartFillSession?.currentEntry) {
        smartFillSession.currentEntry.choices = choiceLabels;
      }

      smartFillSession.currentEntry.events = [];
      if (choiceLabels.length === 0) {
        console.warn("Found choices but could not extract any labels. Skipping.");
        return;
      }
      console.log("Detected Choices:", choiceLabels);
      const prompt = `Question: "${questionText}"\nOptions: [${choiceLabels.join(", ")}]\n\nFrom the options, which is the most likely correct answer? Respond with only the exact text of the best option. Do not add any explanation.`;
      console.log("Sending Prompt to Background:", prompt);
      updateProgressOverlay("Consulting AI provider...", choiceLabels.join(", "));
      if (smartFillSession?.stopRequested) {
        throw new Error("User stopped the smart fill.");
      }
      const aiAnswer = await getAiResponse(prompt);
      updateProgressOverlay("Matching AI response...", aiAnswer);
      console.log(`AI Answer Received: "${aiAnswer}"`);
      const targetChoice = Array.from(choices).find(c => {
        const label = (c.getAttribute('aria-label') || c.textContent || "").trim();
        return label && (label.toLowerCase().includes(aiAnswer.toLowerCase()) || aiAnswer.toLowerCase().includes(label.toLowerCase()));
      });
      if (targetChoice) {
        const matchedLabel = (targetChoice.getAttribute('aria-label') || targetChoice.textContent || "").trim();
        targetChoice.click();
        finalizeHistoryEntry("answered (choice)", matchedLabel || aiAnswer);
        await addAnsweredQuestionHash(questionHash);
      } else {
        finalizeHistoryEntry("no match", aiAnswer);
      }
      return;
    }

    const textInput = q.querySelector('input[type="text"], textarea');
    if (textInput) {
      console.log("Detected Text Input field.");
      const prompt = `Provide a concise and appropriate answer for the following question: "${questionText}"`;
      console.log("Sending Prompt to Background:", prompt);
      updateProgressOverlay("Consulting AI provider...", questionText);
      const aiResponse = await getAiResponse(prompt);
      updateProgressOverlay("Typing AI answer...", aiResponse);
      console.log(`AI Answer Received: "${aiResponse}"`);
      textInput.value = aiResponse;
      textInput.dispatchEvent(new Event('input', { bubbles: true }));
      finalizeHistoryEntry("answered (text input)", aiResponse);
      await addAnsweredQuestionHash(questionHash);
    }
  } catch (error) {
    throw error;
  }
}

async function handleQuizPlatforms(host) {
  clearKahootRecommendation();
  const questionText = extractQuizQuestion(host);
  if (!questionText) {
    throw new Error("Tidak dapat menemukan pertanyaan pada halaman ini.");
  }

  const questionHash = btoa(encodeURIComponent(questionText));
  const answeredHashes = await getAnsweredQuestionHashes();
  if (answeredHashes.includes(questionHash)) {
      console.log("Question already answered. Skipping.");
      showContentToast('Pertanyaan ini sudah dijawab sebelumnya.', 'info');
      // We need to stop the process gracefully
      if (smartFillSession) {
          removeProgressOverlay();
      }
      updateAiButtonState(false);
      return;
  }

  smartFillSession.totalSteps = 1;
  const platformName = host.includes("wayground.com")
    ? "wayground.com"
    : host.includes("quizziz.com")
      ? "quizziz.com"
      : "kahoot.it";
  startHistoryEntry(questionText, platformName);
  updateProgressOverlay("Listening to question", questionText);
  const options = extractQuizOptions(host);
  if (!options.length) {
    throw new Error("Tidak dapat menemukan opsi jawaban.");
  }

  if (smartFillSession?.currentEntry) {
    smartFillSession.currentEntry.choices = options.map(opt => opt.label);
  }

  const prompt = `Question: "${questionText}"\nOptions: [${options.map(opt => opt.label).join(", ")}]\n\nFrom the options, which is the most likely correct answer? Respond with only the exact text of the best option. Do not add any explanation.`;
  console.log("Sending Prompt to Background:", prompt);
  updateProgressOverlay("Consulting AI provider...", questionText);
  const aiAnswer = await getAiResponse(prompt);
  updateProgressOverlay("Matching AI response...", aiAnswer);
  const target = matchOption(options, aiAnswer);
  if (target) {
    if (host.includes("kahoot.it") || host.includes("play.kahoot.it")) {
      highlightKahootRecommendation(target.element, target.label);
      finalizeHistoryEntry("suggested (kahoot)", target.label);
    } else {
      target.element.click();
      finalizeHistoryEntry("answered (quiz)", target.label);
    }
    await addAnsweredQuestionHash(questionHash);
  } else {
    finalizeHistoryEntry("no match", aiAnswer);
  }
  updateProgressBar(1);
}

function matchOption(options, aiAnswer) {
  const normalizedAnswer = normalizeQuizText(aiAnswer);
  if (!normalizedAnswer) return null;

  let bestMatch = null;
  let maxOverlapScore = -1; // Use a score to pick the best match

  for (const option of options) {
    const normalizedLabel = normalizeQuizText(option.label);
    if (!normalizedLabel) continue;

    // Direct match or strong inclusion checks (highest priority)
    if (normalizedLabel === normalizedAnswer) {
      return option; // Exact match
    }
    if (normalizedAnswer.includes(normalizedLabel)) {
      // AI answer contains the option label (e.g., AI: "The answer is Option A", Label: "Option A")
      return option;
    }
    if (normalizedLabel.includes(normalizedAnswer)) {
      // Option label contains the AI answer (e.g., AI: "Option A", Label: "Option A with more text")
      // This is less common but possible, prioritize if it's the only strong match
      bestMatch = option; // Keep this as a potential best match for now, could be overwritten
      maxOverlapScore = Infinity; // Give it a very high score
      continue;
    }

    // Word overlap check for more flexible matching
    const answerWords = normalizedAnswer.split(' ').filter(word => word.length > 1); // Filter short words
    const labelWords = normalizedLabel.split(' ').filter(word => word.length > 1);

    if (answerWords.length === 0 || labelWords.length === 0) continue;

    let currentOverlap = 0;
    for (const aWord of answerWords) {
      if (labelWords.includes(aWord)) {
        currentOverlap++;
      }
    }
    
    // Calculate a score for this option
    // Consider both the number of shared words and the proportion of words matched
    let score = currentOverlap;
    // Boost score if a significant portion of the answer words are in the label, or vice-versa
    if (answerWords.length > 0 && currentOverlap / answerWords.length > 0.6) { // More than 60% of AI's words are in label
      score += 10;
    }
    if (labelWords.length > 0 && currentOverlap / labelWords.length > 0.6) { // More than 60% of label's words are in AI
      score += 10;
    }


    if (score > maxOverlapScore) {
      maxOverlapScore = score;
      bestMatch = option;
    }
  }

  // Return bestMatch only if a minimum level of confidence (overlap) is met
  // A simple threshold might be that at least one significant word overlaps, or a higher overlap score
  if (maxOverlapScore > 0) { // Can be adjusted, e.g., maxOverlapScore >= 5 or based on word count
      return bestMatch;
  }
  
  return null;
}

function highlightKahootRecommendation(element, label) {
  if (!element) return;
  ensureKahootUiStyles();
  clearKahootRecommendation();
  kahootHighlightedOption = element;
  element.classList.add("fake-filler-kahoot-highlight");
  element.setAttribute("data-fake-filler-recommendation", "true");
  showKahootRecommendationToast(`Rekomendasi AI: ${label}`);
}

function clearKahootRecommendation() {
  if (kahootHighlightedOption) {
    kahootHighlightedOption.classList.remove("fake-filler-kahoot-highlight");
    kahootHighlightedOption.removeAttribute("data-fake-filler-recommendation");
    kahootHighlightedOption = null;
  }
  hideKahootRecommendationToast();
}

function ensureKahootUiStyles() {
  if (document.getElementById("fake-filler-kahoot-style")) return;
  const style = document.createElement("style");
  style.id = "fake-filler-kahoot-style";
  style.textContent = `
    .fake-filler-kahoot-highlight {
      outline: 3px solid #25D366 !important;
      box-shadow: 0 0 18px rgba(37, 211, 102, 0.7);
      border-radius: 16px;
      position: relative;
    }
    .fake-filler-toast {
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translate(-50%, 20px);
      background: #0B0F14;
      color: #F2F4F6;
      padding: 12px 18px;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 600;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
      z-index: 2147483647;
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 18px 40px rgba(0,0,0,0.65);
    }
    .fake-filler-toast.visible {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  `;
  document.head.appendChild(style);
}

function showKahootRecommendationToast(text) {
  ensureKahootUiStyles();
  let toast = document.getElementById("fake-filler-answer-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "fake-filler-answer-toast";
    toast.className = "fake-filler-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });
  if (answerToastTimer) {
    clearTimeout(answerToastTimer);
  }
  answerToastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 4000);
}

function hideKahootRecommendationToast() {
  const toast = document.getElementById("fake-filler-answer-toast");
  if (toast) {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 200);
  }
  if (answerToastTimer) {
    clearTimeout(answerToastTimer);
    answerToastTimer = null;
  }
}

function sanitizeQuizText(text) {
  if (!text) return "";
  let cleaned = text.replace(/\u00A0/g, " ");
  if (typeof cleaned.normalize === "function") {
    cleaned = cleaned.normalize("NFKC");
  }
  cleaned = cleaned
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\uFEFF]/g, "")
    .replace(/ƒ\?["”]?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function normalizeQuizText(text) {
  const sanitized = sanitizeQuizText(text);
  if (!sanitized) return "";
  return sanitized
    .toLowerCase()
    .replace(/['"`“”‘’´]/g, "")
    .replace(/[.,!?;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQuizQuestion(host) {
  if (host === '115.124.76.241') {
    const element = document.querySelector('#isi-tes-soal');
    if (element) {
        // The question is the text before the <hr> tag.
        return element.innerHTML.split('<hr>')[0].trim();
    }
    return null;
  }
  if (host.includes("wayground.com")) {
    const element = document.querySelector('[data-testid="question-container-text"] p');
    return element ? element.textContent.trim() : null;
  }
  if (host.includes("quizziz.com")) {
    const element = document.querySelector('[data-testid="question-title"]');
    return element ? element.textContent.trim() : null;
  }
  if (host.includes("kahoot.it") || host.includes("play.kahoot.it")) {
    const selectors = [
      '.QuestionHeader-questionText',
      '.question-title',
      '[data-automation-id="question-title"]',
      '.QuestionCard-questionTitle',
      '.kahoot-question-page h1',
      '[data-automation-id="question-text"]',
      '[data-functional-selector="block-title"]',
      '.question-title__TitleWrapper-sc-12qj0yr-0',
      '.question-title__Title-sc-12qj0yr-1',
      '.extensive-question-title__Title-sc-1m88qtl-0',
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node && sanitizeQuizText(node.textContent)) {
        return sanitizeQuizText(node.textContent);
      }
    }
  }
  return null;
}

function extractQuizOptions(host) {
  const options = [];
  if (host === '115.124.76.241') {
      const nodes = document.querySelectorAll('#isi-tes-soal .radio');
      nodes.forEach(node => {
          const label = node.querySelector('label')?.textContent.trim();
          const element = node.querySelector('input[type="radio"]');
          if (label && element) {
              options.push({ label, element });
          }
      });
      return options;
  }
  if (host.includes("wayground.com")) {
    const nodes = document.querySelectorAll('.option');
    nodes.forEach(node => {
      const labelElement = node.querySelector('#optionText p');
      const label = labelElement ? labelElement.textContent.trim() : "";
      const element = node;
      if (label) options.push({ label, element });
    });
    return options;
  }

  if (host.includes("quizziz.com")) {
    const nodes = document.querySelectorAll('[data-test="option-text"]');
    nodes.forEach(node => {
      const label = node.textContent.trim();
      const trigger = node.closest('[role="button"], .option');
      if (label && trigger) options.push({ label, element: trigger });
    });
    return options;
  }

  if (host.includes("kahoot.it") || host.includes("play.kahoot.it")) {
    const buttonSelectors = [
      '[data-functional-selector^="answer-"]',
      '[data-automation-id="answer-button"]',
      '.AnswerButton',
      'button.kahoot-answer-card',
    ].join(", ");
    const labelSelectors = [
      '[data-functional-selector^="question-choice-text-"]',
      '.AnswerButton-text',
      '.answer-text',
      '.centered-floated-text__ChoiceText-sc-wq1dlx-6',
      '.break-long-words__WordBreak-sc-12amgy7-0',
    ].join(", ");

    let nodes = document.querySelectorAll(buttonSelectors);
    if (!nodes.length) {
      nodes = document.querySelectorAll('[data-functional-selector^="question-choice-text-"]');
    }

    const seenButtons = new Set();
    nodes.forEach(node => {
      const clickable = node.matches('button,[role="button"]')
        ? node
        : node.closest('button,[role="button"],[data-functional-selector^="answer-"],[data-automation-id="answer-button"]');
      if (!clickable || seenButtons.has(clickable)) return;

      let labelNode = clickable.querySelector(labelSelectors);
      if (!labelNode && node.matches(labelSelectors)) {
        labelNode = node;
      }

      const label = sanitizeQuizText(labelNode ? labelNode.textContent : clickable.textContent);
      if (!label) return;

      seenButtons.add(clickable);
      options.push({ label, element: clickable });
    });
    return options;
  }

  return options;
}

/**
 * Gathers metadata for a standard form field.
 */
function getFieldMetadata(field) {
  let metadata = '';
  const id = field.id;
  const labelFor = id ? document.querySelector(`label[for='${id}']`) : null;

  metadata += (field.name || '').toLowerCase();
  metadata += (field.id || '').toLowerCase();
  metadata += (field.placeholder || '').toLowerCase();
  metadata += (field.getAttribute('aria-label') || '').toLowerCase();
  metadata += (labelFor ? labelFor.textContent : '').toLowerCase();

  return metadata;
}

// =================================================================================
// --- NEW PROFILE CREATION MODE (GUIDED UI) ---
// =================================================================================

// Global state for the profile builder
let profileBuilderState = null;

// CSS selectors for the builder UI elements
const BUILDER_UI_IDS = {
  CONTAINER: 'sf-builder-container',
  INSTRUCTIONS: 'sf-builder-instructions',
  SELECTOR_PREVIEW: 'sf-builder-selector-preview',
  UNDO_BUTTON: 'sf-builder-undo',
  CONFIRM_BUTTON: 'sf-builder-confirm',
  CANCEL_BUTTON: 'sf-builder-cancel',
};

// Main function to start the guided profile creation
function startGuidedProfileCreation(existingProfile = null, currentHostname = null) {
  if (profileBuilderState && profileBuilderState.isActive) {
    console.warn("Profile creation is already active.");
    return;
  }

  // 1. Initialize State
  profileBuilderState = {
    isActive: true,
    isEditing: !!existingProfile, // NEW: Flag to indicate editing mode
    originalHostname: currentHostname, // NEW: Store original hostname
    currentStepIndex: 0,
    hoveredElement: null,
    stagedElement: null,
    steps: [
      {
        key: 'questionListContainer',
        instruction: 'Select the main container that holds ALL questions.',
        selector: null,
        element: null, // NEW: Store element reference for easier manipulation
      },
      {
        key: 'questionBlock',
        instruction: 'Select the container of a SINGLE question (including its text and answers).',
        selector: null,
        element: null,
      },
      {
        key: 'questionText',
        instruction: 'Select the question TEXT within the highlighted question block.',
        selector: null,
        isRelative: true,
        element: null,
      },
      {
        key: 'answerField',
        instruction: 'Select ONE answer input (e.g., radio button, checkbox, or text field).',
        selector: null,
        isMulti: false, // We simplify this for now to get a representative element
        isRelative: true,
        element: null,
      }
    ]
  };

  // If editing an existing profile, pre-fill the steps and jump to the last step
  if (profileBuilderState.isEditing && existingProfile) {
    console.log("Pre-filling builder state with existing profile:", existingProfile);
    
    // Fill in selectors from the existing profile
    profileBuilderState.steps[0].selector = existingProfile.questionListContainer;
    profileBuilderState.steps[1].selector = existingProfile.questionBlock;
    profileBuilderState.steps[2].selector = existingProfile.questionText;
    profileBuilderState.steps[3].selector = existingProfile.answerField.selector; // Assuming answerField.selector exists

    // Attempt to find and store element references for each step
    // This is crucial for relative selectors to work later
    profileBuilderState.steps.forEach((step, index) => {
        if (step.selector) {
            let foundElement = null;
            if (step.isRelative) {
                // For relative selectors, we need the parent's element
                const parentElement = profileBuilderState.steps[index - 1]?.element;
                if (parentElement && step.selector !== ':scope') {
                  foundElement = parentElement.querySelector(step.selector);
                } else if (step.selector === ':scope') {
                  foundElement = parentElement; // If :scope, the element IS the parent
                }
            } else {
                foundElement = document.querySelector(step.selector);
            }
            if (foundElement) {
                step.element = foundElement;
                foundElement.style.outline = '3px solid #28a745'; // Green persistent highlight
                console.log(`Highlighted element for step ${index}:`, foundElement);
            } else {
                console.warn(`Element for step ${index} (${step.selector}) not found on page.`);
            }
        }
    });

    // Start at the last step so user can review/confirm all, or modify any.
    // Or start at step 0 and let them click next. Starting at last step feels more like "editing".
    profileBuilderState.currentStepIndex = 0; // Start at first step for full review
  }


  // 2. Create the UI
  createBuilderUI();
  updateBuilderUI(); // Update UI after potentially setting steps

  // 3. Attach event listeners
  attachBuilderEventListeners();
  
  showContentToast(profileBuilderState.isEditing ? "Editing profile. Review or re-select elements." : "Profile creation started. Click an element to begin.", "info");
}

// Creates the main UI panel for the builder
function createBuilderUI() {
  if (document.getElementById(BUILDER_UI_IDS.CONTAINER)) return;

  const panel = document.createElement('div');
  panel.id = BUILDER_UI_IDS.CONTAINER;
  panel.innerHTML = `
    <div id="sf-builder-content">
      <p id="${BUILDER_UI_IDS.INSTRUCTIONS}"></p>
      <div id="sf-builder-preview-box">
        <span>Selector:</span>
        <code id="${BUILDER_UI_IDS.SELECTOR_PREVIEW}">Hover over an element...</code>
      </div>
    </div>
    <div id="sf-builder-actions">
      <button id="${BUILDER_UI_IDS.UNDO_BUTTON}" class="sf-builder-button" disabled>Undo</button>
      <button id="${BUILDER_UI_IDS.CONFIRM_BUTTON}" class="sf-builder-button" disabled>Confirm Selection</button>
      <button id="${BUILDER_UI_IDS.CANCEL_BUTTON}" class="sf-builder-button sf-builder-button-danger">Cancel</button>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #${BUILDER_UI_IDS.CONTAINER} {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      width: 90%;
      max-width: 700px;
      background: #0B0F14;
      color: #F2F4F6;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
      z-index: 2147483647;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px 20px;
      font-family: 'Segoe UI', sans-serif;
      transition: bottom 0.3s ease;
    }
    #sf-builder-content { flex-grow: 1; }
    #${BUILDER_UI_IDS.INSTRUCTIONS} { margin: 0 0 10px 0; font-size: 16px; }
    #sf-builder-preview-box { background: rgba(0,0,0,0.3); border-radius: 6px; padding: 8px 12px; }
    #sf-builder-preview-box span { color: #888; margin-right: 8px; }
    #${BUILDER_UI_IDS.SELECTOR_PREVIEW} { font-family: 'Courier New', monospace; font-size: 13px; color: #25D366; word-break: break-all; }
    #sf-builder-actions { display: flex; gap: 10px; }
    .sf-builder-button { 
      padding: 8px 16px; 
      border: 1px solid rgba(255,255,255,0.2); 
      background: transparent; 
      color: #F2F4F6;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .sf-builder-button:hover:not(:disabled) { background: rgba(255,255,255,0.1); }
    .sf-builder-button:disabled { cursor: not-allowed; opacity: 0.5; }
    .sf-builder-button-danger:hover { background: #ff6b7a; border-color: #ff6b7a; }

    @media (max-width: 720px) {
      #${BUILDER_UI_IDS.CONTAINER} {
        flex-direction: column;
        align-items: stretch;
        bottom: 10px;
        padding: 15px;
      }
      #sf-builder-content {
        margin-bottom: 15px;
      }
      #sf-builder-actions {
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
      }
      .sf-builder-button {
        flex-grow: 1;
        min-width: 120px;
      }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);
}

// Updates the UI based on the current state
function updateBuilderUI() {
  if (!profileBuilderState?.isActive) return;

  const state = profileBuilderState;
  const step = state.steps[state.currentStepIndex];

  // Update instructions
  const instructionEl = document.getElementById(BUILDER_UI_IDS.INSTRUCTIONS);
  if (instructionEl) instructionEl.innerHTML = `<strong>Step ${state.currentStepIndex + 1}/${state.steps.length}:</strong> ${step.instruction}`;

  // Update button states
  const undoButton = document.getElementById(BUILDER_UI_IDS.UNDO_BUTTON);
  if (undoButton) undoButton.disabled = state.currentStepIndex === 0 && !state.stagedElement;

  const confirmButton = document.getElementById(BUILDER_UI_IDS.CONFIRM_BUTTON);
  if (confirmButton) confirmButton.disabled = !state.stagedElement;
}

// Attaches all necessary event listeners for the builder
function attachBuilderEventListeners() {
  // Use a single object for listener functions to easily add/remove them
  const listeners = {
    mouseover: (e) => {
      if (!profileBuilderState?.isActive) return;
      const target = e.target;
      if (target.id === BUILDER_UI_IDS.CONTAINER || target.closest(`#${BUILDER_UI_IDS.CONTAINER}`)) return;

      // Un-highlight previous element
      if (profileBuilderState.hoveredElement) {
        profileBuilderState.hoveredElement.style.outline = '';
      }

      // Highlight new element and update state
      target.style.outline = '2px dashed #25D366';
      profileBuilderState.hoveredElement = target;
      
      // Update selector preview
      const selectorPreview = document.getElementById(BUILDER_UI_IDS.SELECTOR_PREVIEW);
      if (selectorPreview) {
        selectorPreview.textContent = generateSelector(target);
      }
      
      // Update confirm button state
      const confirmButton = document.getElementById(BUILDER_UI_IDS.CONFIRM_BUTTON);
      if (confirmButton) confirmButton.disabled = false;
    },

    mouseout: (e) => {
       if (profileBuilderState?.hoveredElement) {
        profileBuilderState.hoveredElement.style.outline = '';
        profileBuilderState.hoveredElement = null;

        const selectorPreview = document.getElementById(BUILDER_UI_IDS.SELECTOR_PREVIEW);
        if (selectorPreview) selectorPreview.textContent = 'Hover over an element...';
        
        const confirmButton = document.getElementById(BUILDER_UI_IDS.CONFIRM_BUTTON);
        if (confirmButton) confirmButton.disabled = true;
      }
    },
    
    click: (e) => {
      if (!profileBuilderState?.isActive) return;
      const state = profileBuilderState;
      if (e.target.id === BUILDER_UI_IDS.CONTAINER || e.target.closest(`#${BUILDER_UI_IDS.CONTAINER}`)) return;
      
      e.preventDefault();
      e.stopPropagation();

      if (state.hoveredElement) {
        // Unstage previous element if any
        if (state.stagedElement) {
          state.stagedElement.style.outline = '';
        }
        
        // Stage the new selection
        state.stagedElement = state.hoveredElement;
        state.hoveredElement = null; // Clear hover state
        
        // Apply staging highlight & update UI
        state.stagedElement.style.outline = '2px solid #007bff';
        document.getElementById(BUILDER_UI_IDS.SELECTOR_PREVIEW).textContent = generateSelector(state.stagedElement);
        document.getElementById(BUILDER_UI_IDS.CONFIRM_BUTTON).disabled = false;

        // Temporarily disable hover effects so user can move to confirm button
        document.removeEventListener('mouseover', state.listeners.mouseover);
        document.removeEventListener('mouseout', state.listeners.mouseout);
      }
    },

    confirmClick: () => {
      if (!profileBuilderState?.isActive || !profileBuilderState.stagedElement) return;

      const state = profileBuilderState;
      const step = state.steps[state.currentStepIndex];
      const selectedElement = state.stagedElement;
      
      // Generate and store selector
      if (step.isRelative) {
        const parentStep = state.steps[state.currentStepIndex - 1];
        step.selector = generateRelativeSelector(selectedElement, parentStep.element);
      } else {
        step.selector = generateSelector(selectedElement);
      }
      step.element = selectedElement; // Store element for relative selections
      
      // Clear outline from confirmed element
      selectedElement.style.outline = '3px solid #28a745'; // Green persistent highlight

      state.stagedElement = null; // Clear staging

      // Move to next step or finish
      if (state.currentStepIndex < state.steps.length - 1) {
        state.currentStepIndex++;
        updateBuilderUI();
        showContentToast(`Step ${state.currentStepIndex} completed. Now for the next step.`, 'success');
        
        // Re-enable hover listeners for the next step
        document.addEventListener('mouseover', state.listeners.mouseover);
        document.addEventListener('mouseout', state.listeners.mouseout);
      } else {
        finishProfileCreation();
      }
    },

    undoClick: () => {
      if (!profileBuilderState?.isActive) return;
      const state = profileBuilderState;

      // If an element is staged, undo just unstages it.
      if (state.stagedElement) {
          state.stagedElement.style.outline = '';
          state.stagedElement = null;
          
          // Re-enable hover listeners
          document.addEventListener('mouseover', state.listeners.mouseover);
          document.addEventListener('mouseout', state.listeners.mouseout);
          
          document.getElementById(BUILDER_UI_IDS.CONFIRM_BUTTON).disabled = true;
          document.getElementById(BUILDER_UI_IDS.SELECTOR_PREVIEW).textContent = 'Hover over an element...';
          showContentToast('Selection cancelled. Hover to select an element.', 'info');
          return;
      }

      if (state.currentStepIndex === 0) return;
      
      // Clear current selection highlight (if any)
      const currentStep = state.steps[state.currentStepIndex];
      if (currentStep.element) {
        currentStep.element.style.outline = '';
      }
      
      state.currentStepIndex--;

      const previousStep = state.steps[state.currentStepIndex];
      if (previousStep.element) {
        previousStep.element.style.outline = ''; // Clear persistent highlight
      }
      previousStep.selector = null;
      previousStep.element = null;
      
      // Re-enable hover listeners for the current step
      document.addEventListener('mouseover', state.listeners.mouseover);
      document.addEventListener('mouseout', state.listeners.mouseout);

      updateBuilderUI();
      const selectorPreview = document.getElementById(BUILDER_UI_IDS.SELECTOR_PREVIEW);
      if (selectorPreview) {
        selectorPreview.textContent = previousStep.selector || 'Hover over an element...';
      }
      showContentToast(`Reverted to step ${state.currentStepIndex + 1}.`, 'info');
    },

    cancelClick: () => {
      cleanupBuilder();
      chrome.runtime.sendMessage({ action: 'selectionCancelled', reason: 'User cancelled.' });
      showContentToast('Profile creation cancelled.', 'error');
    },
    
    keydown: (e) => {
        if (!profileBuilderState?.isActive) return;
        if (e.key === 'Escape') {
            listeners.cancelClick();
        }
    }
  };

  profileBuilderState.listeners = listeners;

  // Attach main listeners
  document.addEventListener('mouseover', listeners.mouseover);
  document.addEventListener('mouseout', listeners.mouseout);
  document.addEventListener('click', listeners.click, true);
  document.addEventListener('keydown', listeners.keydown, true);

  // Attach UI button listeners
  document.getElementById(BUILDER_UI_IDS.CONFIRM_BUTTON).addEventListener('click', listeners.confirmClick);
  document.getElementById(BUILDER_UI_IDS.UNDO_BUTTON).addEventListener('click', listeners.undoClick);
  document.getElementById(BUILDER_UI_IDS.CANCEL_BUTTON).addEventListener('click', listeners.cancelClick);
}

// Tears down the UI and all event listeners
function cleanupBuilder() {
  if (!profileBuilderState || !profileBuilderState.isActive) return;

  const { listeners, steps, hoveredElement, stagedElement } = profileBuilderState;

  // Remove event listeners
  if (listeners) {
    document.removeEventListener('mouseover', listeners.mouseover);
    document.removeEventListener('mouseout', listeners.mouseout);
    document.removeEventListener('click', listeners.click, true);
    document.removeEventListener('keydown', listeners.keydown, true);
  }

  // Remove highlights
  if (hoveredElement) hoveredElement.style.outline = '';
  if (stagedElement) stagedElement.style.outline = '';
  steps.forEach(step => {
    if (step.element) step.element.style.outline = '';
  });

  // Remove UI
  const panel = document.getElementById(BUILDER_UI_IDS.CONTAINER);
  if (panel) panel.parentElement.removeChild(panel);
  
  const style = document.head.querySelector(`style[id*="sf-builder"]`);
  if (style) style.parentElement.removeChild(style);

  // Reset state
  profileBuilderState = null;
}

// Finalizes the process and sends data to the background
function finishProfileCreation() {
  if (!profileBuilderState?.isActive) return;
  
  const { steps, isEditing, originalHostname } = profileBuilderState;

  // Construct the profile object from the stored selectors
  const profileToSave = {
    questionListContainer: steps[0].selector,
    questionBlock: steps[1].selector,
    questionText: steps[2].selector,
    // The answer field needs special handling for type detection
    answerField: {
      selector: steps[3].selector,
      type: determineFieldType([steps[3].element]),
    }
  };

  const action = isEditing ? 'profileUpdated' : 'profileCompleted'; // NEW: Different action based on mode
  const message = isEditing ? 'Profile updated successfully!' : 'Profile created successfully!';
  const hostnameToSend = isEditing ? originalHostname : window.location.hostname;

  console.log(`Profile ${isEditing ? 'editing' : 'creation'} complete. Final profile:`, profileToSave);
  showContentToast(message, 'success');
  
  // Send the complete profile to the background script
  chrome.runtime.sendMessage({
    action: action,
    profile: profileToSave,
    hostname: hostnameToSend,
  });

  cleanupBuilder();
}

/**
 * Generates a more robust and readable CSS selector for an element.
 * @param {Element} el The element to generate a selector for.
 * @returns {string} A CSS selector.
 */
function generateSelector(el) {
    if (!(el instanceof Element)) return;
    const path = [];
    while (el.nodeType === Node.ELEMENT_NODE) {
        let selector = el.nodeName.toLowerCase();
        if (el.id) {
            selector += `#${el.id}`;
            path.unshift(selector);
            break; // ID is unique, no need to go further
        } else {
            let sib = el, nth = 1;
            while (sib.previousElementSibling) {
                sib = sib.previousElementSibling;
                if (sib.nodeName.toLowerCase() == selector) nth++;
            }
            if (nth != 1) selector += `:nth-of-type(${nth})`;
        }
        path.unshift(selector);
        el = el.parentNode;
    }
    return path.join(" > ");
}

/**
 * Generates a CSS selector for a target element relative to a root element.
 * @param {Element} targetEl The element to select.
 * @param {Element} rootEl The root element for the relative path.
 * @returns {string} A relative CSS selector.
 */
function generateRelativeSelector(targetEl, rootEl) {
    if (!targetEl || !rootEl || !rootEl.contains(targetEl)) {
        console.warn("generateRelativeSelector: Target is not a descendant of root. Falling back to absolute selector.");
        return generateSelector(targetEl);
    }
    
    const path = [];
    let currentEl = targetEl;
    while (currentEl && currentEl !== rootEl) {
        let selector = currentEl.nodeName.toLowerCase();
        // Prefer class names if they are reasonably specific
        if (currentEl.className && typeof currentEl.className === 'string') {
            const stableClasses = currentEl.className.split(' ').filter(c => c && !c.match(/[:]/));
            if (stableClasses.length > 0) {
                selector = '.' + stableClasses.join('.');
            }
        }
        
        let sib = currentEl, nth = 1;
        while ((sib = sib.previousElementSibling)) {
            if (sib.nodeName === currentEl.nodeName) nth++;
        }
        if (nth > 1) {
            selector += `:nth-of-type(${nth})`;
        }
        
        path.unshift(selector);
        currentEl = currentEl.parentElement;
    }
    return path.join(' > ');
}




// Helper to dynamically detect answer field type and elements within a given question block
function getAnswerFieldAndTypeInBlock(questionBlockElement) {
    if (!questionBlockElement) return null;

    // --- 1. Check for single text input/textarea ---
    const textInput = questionBlockElement.querySelector('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]), textarea');
    if (textInput) {
        const relativeSelector = generateRelativeSelector(textInput, questionBlockElement);
        if (relativeSelector) {
            return { type: 'text_input', selector: relativeSelector, element: textInput };
        }
    }

    // --- 2. Check for dropdown (select element) ---
    const dropdown = questionBlockElement.querySelector('select');
    if (dropdown) {
        const relativeSelector = generateRelativeSelector(dropdown, questionBlockElement);
        if (relativeSelector) {
            return { type: 'dropdown', selector: relativeSelector, element: dropdown };
        }
    }

    // --- 3. Check for multiple choice (radio buttons) ---
    const radioInputs = questionBlockElement.querySelectorAll('input[type="radio"]');
    if (radioInputs.length > 0) {
        const selectors = Array.from(radioInputs).map(el => generateRelativeSelector(el, questionBlockElement)).filter(Boolean);
        if (selectors.length > 0) {
            return { type: 'multiple_choice', selectors: selectors, elements: Array.from(radioInputs) };
        }
    }
    
    // Check for div/span/label based multiple choice
    const genericChoices = questionBlockElement.querySelectorAll('div[role="radio"], span[role="radio"], label[role="radio"], div[role="option"], span[role="option"], label[role="option"], div[role="button"], span[role="button"], label[role="button"], .choice-item, .option-item');
    if (genericChoices.length > 0) {
        const selectors = Array.from(genericChoices).map(el => generateRelativeSelector(el, questionBlockElement)).filter(Boolean);
        if (selectors.length > 0) {
            return { type: 'multiple_choice', selectors: selectors, elements: Array.from(genericChoices) };
        }
    }

    // --- 4. Check for checkboxes ---
    const checkboxes = questionBlockElement.querySelectorAll('input[type="checkbox"]');
    if (checkboxes.length > 1) { 
        const selectors = Array.from(checkboxes).map(el => generateRelativeSelector(el, questionBlockElement)).filter(Boolean);
        if (selectors.length > 0) {
            return { type: 'checkbox_group', selectors: selectors, elements: Array.from(checkboxes) };
        }
    } else if (checkboxes.length === 1) {
        const selector = generateRelativeSelector(checkboxes[0], questionBlockElement);
        if (selector) {
            return { type: 'single_checkbox', selector: selector, element: checkboxes[0] };
        }
    }

    console.warn("getAnswerFieldAndTypeInBlock: No identifiable answer field found in block.", questionBlockElement);
    return null; // No identifiable field found
}

function determineFieldType(elements) {
    if (!elements || elements.length === 0) return 'unknown';

    if (elements.length === 1) {
        const el = elements[0];
        const tagName = el.tagName.toLowerCase();
        const inputType = el.type ? el.type.toLowerCase() : '';

        if (tagName === 'input' && ['text', 'email', 'password', 'number', 'tel', 'url'].includes(inputType)) {
            return 'text_input';
        }
        if (tagName === 'textarea') {
            return 'text_input';
        }
        if (tagName === 'select') {
            return 'dropdown';
        }
        if (tagName === 'input' && inputType === 'checkbox') {
            return 'single_checkbox';
        }
        if (['div', 'span', 'label'].includes(tagName) && el.hasAttribute('role') && el.getAttribute('role').includes('radio')) {
            return 'multiple_choice';
        }
    }

    if (elements.length > 1) {
        const firstEl = elements[0];
        const tagName = firstEl.tagName.toLowerCase();
        const inputType = firstEl.type ? firstEl.type.toLowerCase() : '';

        if (tagName === 'input' && inputType === 'radio') {
            return 'multiple_choice';
        }
        if (tagName === 'input' && inputType === 'checkbox') {
            return 'checkbox_group';
        }
        if (['div', 'span', 'label'].includes(tagName) && inputType === '') {
            // More generic check for clickable choices. If multiple non-input divs/spans/labels are selected, assume multiple_choice.
            return 'multiple_choice';
        }
    }

    return 'unknown';
}

function escapeCssSelector(str) {
  // Escape common CSS selector special characters, especially ':' for Tailwind CSS
  return str.replace(/([.:])/g, '\\$1');
}

function generateRelativeSelector(el, rootElement) {
    console.log("DEBUG: generateRelativeSelector called with el:", el, "rootElement:", rootElement);
    if (!el) { console.log("DEBUG: generateRelativeSelector returning null because el is null."); return null; }
    if (!rootElement) { console.log("DEBUG: generateRelativeSelector returning null because rootElement is null."); return null; }
    if (!rootElement.contains(el)) { 
        console.log("DEBUG: generateRelativeSelector returning null because rootElement does not contain el.");
        showContentToast("Error: The selected element is not contained within the previously selected block. Please try again, ensuring your selections are hierarchical.", "error");
        return null;
    }
    if (el === rootElement) { console.log("DEBUG: generateRelativeSelector returning :scope."); return ':scope'; }

    const parts = [];
    let currentEl = el;
    while (currentEl && currentEl !== rootElement) {
        let part = currentEl.tagName.toLowerCase();
        
        const classes = Array.from(currentEl.classList);
        if (classes.length > 0) {
            part += '.' + classes.map(cls => escapeCssSelector(cls)).join('.');
        }

        let sibling = currentEl;
        let nth = 1;
        while (sibling = sibling.previousElementSibling) {
            if (sibling.tagName === currentEl.tagName) {
                nth++;
            }
        }
        part += `:nth-of-type(${nth})`;

        parts.unshift(part);
        currentEl = currentEl.parentElement;
    }
    console.log("DEBUG: generateRelativeSelector returning:", parts.join(' > '));
    return parts.join(' > ');
}

function generateSelector(el) {
    if (!el) return null;

    // If the element has a unique ID, use it
    if (el.id) {
        const selector = `#${escapeCssSelector(el.id)}`;
        if (document.querySelectorAll(selector).length === 1) {
            return selector;
        }
    }

    // Otherwise, build a path of tag names and classes
    const parts = [];
    let currentEl = el;
    while (currentEl && currentEl.tagName !== 'BODY') {
        let part = currentEl.tagName.toLowerCase();
        
        const classes = Array.from(currentEl.classList);
        if (classes.length > 0) {
            part += '.' + classes.map(cls => escapeCssSelector(cls)).join('.');
        }

        // Add nth-of-type to distinguish between siblings
        // Removed for better compatibility with dynamic content where positions change.
        // If the selector is not unique enough, the user might need to adjust their selection.
        // The current strategy relies more on classes and tag names.



        parts.unshift(part);
        currentEl = currentEl.parentElement;
    }

    return parts.join(' > ');
}
}