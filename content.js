// Listen for manual trigger
window.addEventListener("fakeFiller:run", doFakeFill);
window.addEventListener("fakeFiller:smartFill", doSmartFill);

let smartFillSession = null;
let answerToastTimer = null;
let kahootHighlightedOption = null;
let quizContentObserver = null;
let debounceTimer = null;

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
  // Check if SweetAlert2 is already injected
  if (document.getElementById('sweetalert2-script')) {
    return;
  }

  const cssLink = document.createElement('link');
  cssLink.href = chrome.runtime.getURL('vendor/sweetalert2/sweetalert2.min.css');
  cssLink.rel = 'stylesheet';
  document.head.appendChild(cssLink);

  const jsScript = document.createElement('script');
  jsScript.id = 'sweetalert2-script';
  jsScript.src = chrome.runtime.getURL('vendor/sweetalert2/sweetalert2@11.js');
  jsScript.async = true;
  document.head.appendChild(jsScript);
}

function showToast(icon, title, timer = 3000) {
  // Ensure Swal is available before trying to use it
  if (typeof Swal === 'undefined') {
    console.warn('SweetAlert2 not loaded, falling back to alert:', title);
    console.error('SweetAlert2 not loaded. Message:', title);
    return;
  }

  Swal.fire({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: timer,
    timerProgressBar: true,
    icon: icon,
    title: title
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
  const entry = document.createElement("li");
  entry.innerHTML = `<strong>${status}</strong>${detail ? ` — ${detail}` : ""}`;
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
}

// Action Button SVG icons
const fullscreenEnterIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M200-200h280v-80H280v-200h-80v280Zm280-560v-80h280v280h-80v-200H480Z"/></svg>`;
const fullscreenExitIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M280-200v-280h80v200h200v80H280Zm400-320v-200H480v-80h280v280h-80Z"/></svg>`;
const runAiIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/></svg>`;
const cancelAiIcon = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>`;


/**
 * Updates the fullscreen button's icon and style based on the current state.
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
  // Fetch custom profiles to determine if an overlay should be created
  const { customProfiles } = await chrome.storage.local.get({ customProfiles: {} });
  const host = window.location.hostname;
  const hasCustomProfile = !!customProfiles[host];

  const isGForm = host === 'docs.google.com' && window.location.pathname.includes('/forms/');
  const isWayground = host.includes('wayground.com');
  const isQuizziz = host.includes('quizziz.com');
  const isKahoot = host.includes('kahoot.it') || host.includes('play.kahoot.it');
  const isCbt = host === '115.124.76.241';

  const shouldShowOverlay = hasCustomProfile || isGForm || isWayground || isQuizziz || isKahoot || isCbt;

  if (!shouldShowOverlay) return;

  // Check for the container ID instead of the button ID
  if (document.getElementById('smart-fill-trigger-container')) return;

  const triggerContainer = document.createElement("div");
  triggerContainer.id = "smart-fill-trigger-container";
  triggerContainer.className = "tooltip-container"; // Use class for styling consistency
  triggerContainer.innerHTML = `
    <button id="smart-fill-trigger-button">
        <div class="smart-fill-icon">
            <span></span>
            <span></span>
            <span></span>
        </div>
    </button>
    <div class="tooltip-content">
        <div class="social-icons">
            <a href="#" id="run-ai-button" class="social-icon" title="Run AI">
                ${runAiIcon}
            </a>
            <a href="#" id="fullscreen-button" class="social-icon" title="Toggle Fullscreen">
                ${fullscreenEnterIcon}
            </a>
        </div>
    </div>
  `;

  const style = document.createElement("style");
  style.id = "smart-fill-trigger-style";
  style.textContent = `
    #smart-fill-trigger-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483645;
    }
    /* Original button styles */
    #smart-fill-trigger-button {
      width: 64px;
      height: 64px;
      background: #EDE1FF;
      border-radius: 18px;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      transition: transform .2s ease, box-shadow .2s ease;
    }
    #smart-fill-trigger-button:hover {
      transform: scale(1.06);
      box-shadow: 0 6px 15px rgba(0,0,0,0.28);
    }
    #smart-fill-trigger-button .smart-fill-icon {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    #smart-fill-trigger-button .smart-fill-icon span {
      width: 24px;
      height: 4px;
      background: #5E3BAE;
      border-radius: 4px;
    }

    /* Tooltip styles from prompt.txt */
    .tooltip-container {
        position: relative;
        display: inline-block;
        font-family: "Arial", sans-serif;
    }

    .tooltip-content {
        position: absolute;
        bottom: 105%;
        left: 50%;
        transform: translateX(-50%) scale(0.8);
        background: white;
        border-radius: 15px;
        padding: 15px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        z-index: 100;
        pointer-events: none;
    }

    #smart-fill-trigger-container.active .tooltip-content {
        opacity: 1;
        visibility: visible;
        transform: translateX(-50%) scale(1);
        pointer-events: auto;
    }

    .social-icons {
        display: flex;
        justify-content: center;
        gap: 12px;
    }

    .social-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #f0f0f0;
        transition: all 0.3s ease;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        text-decoration: none;
    }

    .social-icon:hover {
        transform: translateY(-3px) scale(1.05);
        box-shadow: 0 8px 15px rgba(0, 0, 0, 0.15);
    }

    .social-icon svg {
        width: 24px;
        height: 24px;
        fill: #333;
    }

    #run-ai-button:hover { background: #c8e6c9; }
    #run-ai-button.processing {
      background-color: #ffcdd2;
    }
    #run-ai-button.processing:hover {
      background-color: #ef9a9a;
    }
    #fullscreen-button:hover { background: #bbdefb; }
    #fullscreen-button.active {
      background-color: #81d4fa;
      box-shadow: 0 8px 15px rgba(129, 212, 250, 0.4);
    }
    #fullscreen-button.active:hover {
      background-color: #4fc3f7;
    }

    /* Responsive Design for Mobile */
    @media (max-width: 768px) {
      #smart-fill-trigger-button {
        width: 56px;
        height: 56px;
      }
      .tooltip-content {
        padding: 12px;
      }
      .social-icon {
        width: 44px;
        height: 44px;
      }
      .social-icon svg {
        width: 22px;
        height: 22px;
      }
    }

    @media (max-width: 480px) {
      #smart-fill-trigger-button {
        width: 50px;
        height: 50px;
      }
      .tooltip-content {
        padding: 10px;
      }
      .social-icon {
        width: 40px;
        height: 40px;
      }
      .social-icon svg {
        width: 20px;
        height: 20px;
      }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(triggerContainer);

  const mainButton = document.getElementById('smart-fill-trigger-button');
  const runAiButton = document.getElementById('run-ai-button');
  const fullscreenButton = document.getElementById('fullscreen-button');

  // Toggle tooltip visibility on click of the main button
  mainButton.addEventListener('click', (e) => {
    e.preventDefault();
    triggerContainer.classList.toggle('active');
  });

  runAiButton.addEventListener('click', (e) => {
    e.preventDefault();
    triggerContainer.classList.remove('active'); // Hide tooltip after action

    const isProcessing = runAiButton.classList.contains('processing');
    if (isProcessing) {
      // If AI is running, cancel it.
      ensureSmartFillSession();
      if (smartFillSession) {
        smartFillSession.stopRequested = true;
      }
      updateAiButtonState(false); // Immediately reflect cancellation
    } else {
      // If AI is not running, start it.
      doSmartFill();
    }
  }, { capture: true });

  fullscreenButton.addEventListener('click', (e) => {
    e.preventDefault();
    handleFullscreen();
    triggerContainer.classList.remove('active'); // Hide tooltip after action
  });
  
  // Set initial state and listen for changes
  updateFullscreenButtonState();
  updateAiButtonState(false); // Ensure AI button is in default state on load
  document.addEventListener('fullscreenchange', () => {
    const isFullscreen = !!document.fullscreenElement;
    // Persist the state for future page loads
    chrome.storage.local.set({ 'fullscreen-enabled': isFullscreen });
    // Update the button UI
    updateFullscreenButtonState();
  });

  // Add listener to close tooltip when clicking outside
  document.addEventListener('click', (e) => {
    // If the click is outside the trigger container and the container is active
    if (!triggerContainer.contains(e.target) && triggerContainer.classList.contains('active')) {
      triggerContainer.classList.remove('active');
    }
  });
}

/**
 * Toggles fullscreen mode.
 */
function handleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
    });
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
        showToast('error', `An error occurred: ${error.message}`, 5000);
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
      showToast('error', "Smart Fill currently supports Google Forms, wayground.com, quizziz.com, kahoot.it, and the CBT instance.", 6000);
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
      showToast('error', `An error occurred while using the AI provider: ${error.message}`, 5000);
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
    showToast('error', `An error occurred: ${error.message}`, 5000);
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
  clearKahootRecommendation(); // Just in case

  // We need to check if the initial question element is present to set up the observer target.
  // If it's not present, we cannot proceed with this profile.
  const initialQuestionElement = document.querySelector(profile.question);
  if (!initialQuestionElement) {
    throw new Error("Initial question element not found. Profile may be invalid or page not ready.");
  }

  // Find a suitable element to observe.
  const targetNode = initialQuestionElement.parentElement || document.body; // Fallback to body if parent is null

  ensureSmartFillSession();
  const showOverlay = await getOverlayPreference();
  if (showOverlay) {
    createProgressOverlay();
  } else {
    removeProgressOverlay();
  }

  // Create a promise that resolves when stopRequested is true
  const stopPromise = new Promise(resolve => {
    smartFillSession.stopSignalResolver = resolve;
  });

  const mutationCallback = (mutationsList, observer) => {
    // Check if smart fill was stopped by user or an error occurred
    if (smartFillSession?.stopRequested) {
      observer.disconnect();
      quizContentObserver = null;
      removeProgressOverlay(); // Also remove overlay on stop
      if (smartFillSession.stopSignalResolver) {
        smartFillSession.stopSignalResolver();
        smartFillSession.stopSignalResolver = null;
      }
      return;
    }
    // Debounce the processing of the quiz state to avoid excessive calls
    debounce(() => processCurrentQuizState(profile), 500);
  };

  // Disconnect any existing observer before creating a new one
  if (quizContentObserver) {
    quizContentObserver.disconnect();
  }

  // Create and start the MutationObserver
  quizContentObserver = new MutationObserver(mutationCallback);
  quizContentObserver.observe(targetNode, {
    childList: true, // Observe direct children additions/removals
    subtree: true,   // Observe all descendants
    attributes: true, // Observe attribute changes (e.g., class, id)
    characterData: true, // Observe changes to text content
  });
  console.log("MutationObserver started on:", targetNode);

  // Initial processing of the current quiz state (with hashing)
  await processCurrentQuizState(profile);

  // Wait until a stop is requested (e.g., by the stop button or an internal error)
  await stopPromise;

  // Cleanup after stopPromise resolves
  if (quizContentObserver) {
    quizContentObserver.disconnect();
    quizContentObserver = null;
    console.log("MutationObserver disconnected.");
  }
  removeProgressOverlay(); // Ensure overlay is removed
  updateAiButtonState(false); // Reset button state
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
      showToast('info', 'Pertanyaan ini sudah dijawab sebelumnya.', 3000);
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // This listener now handles multiple actions
  if (request.action === 'showToast' && request.toast) {
    showToast(request.toast.icon, request.toast.title);
    sendResponse({status: 'ok'}); // Acknowledge receipt
  } else if (request.action === 'startSelection') {
    // This now just triggers the mode, doesn't wait for a response here.
    enterElementSelectionMode(request.options);
    sendResponse({status: 'selection_started'}); // Acknowledge receipt
  }
  return true;
});

function enterElementSelectionMode(options) {
  // The Promise wrapper is removed. This function now fires and forgets.
  
  const isMulti = options.multi === true;
  const type = typeof options === 'string' ? options : options.type;
  
  // --- Overlay and Instructions ---
  const overlay = document.createElement('div');
  overlay.id = 'fake-filler-selection-overlay';
  // (Styles are mostly the same, so omitting for brevity in thought process)
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  overlay.style.zIndex = '2147483647';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'flex-start';
  overlay.style.paddingTop = '20px';
  overlay.style.color = 'white';
  overlay.style.fontSize = '18px';
  overlay.style.fontFamily = 'sans-serif';
  overlay.style.pointerEvents = 'none';

  const instructions = isMulti
    ? `Click on each <strong>${type}</strong> element. Press 'Enter' when finished.`
    : `Click to select the <strong>${type}</strong> element.`;

  overlay.innerHTML = `
    <div style="background: black; padding: 15px 25px; border-radius: 10px; pointer-events: auto; border: 1px solid #333;">
      ${instructions} Press 'Esc' to cancel.
    </div>
  `;
  document.body.appendChild(overlay);

  // --- State Variables ---
  let lastHighlightedElement = null;
  const selectedElements = [];

  // --- Event Handlers ---
  const mouseoverHandler = (e) => {
    const target = e.target;
    if (overlay.contains(target) || selectedElements.includes(target)) {
      return;
    }
    target.style.outline = '2px solid #25D366';
    lastHighlightedElement = target;
  };

  const mouseoutHandler = (e) => {
    if (lastHighlightedElement) {
      lastHighlightedElement.style.outline = '';
    }
  };

  const cleanup = () => {
    document.removeEventListener('mouseover', mouseoverHandler);
    document.removeEventListener('mouseout', mouseoutHandler);
    document.removeEventListener('click', clickHandler, true);
    document.removeEventListener('keydown', keydownHandler, true);
    
    // Clear all highlights
    if (lastHighlightedElement) lastHighlightedElement.style.outline = '';
    selectedElements.forEach(el => el.style.outline = '');

    if (document.body.contains(overlay)) {
      document.body.removeChild(overlay);
    }
  };

  const clickHandler = (e) => {
    if (overlay.contains(e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    const clickedEl = e.target;
    
    if (isMulti) {
      // Toggle selection for multi-mode
      const index = selectedElements.indexOf(clickedEl);
      if (index > -1) {
        selectedElements.splice(index, 1);
        clickedEl.style.outline = ''; // Remove highlight
      } else {
        selectedElements.push(clickedEl);
        clickedEl.style.outline = '3px solid #007bff'; // Persistent blue highlight
      }
      lastHighlightedElement = null; // Prevent mouseout from clearing the blue highlight
    } else {
      // Single selection mode
      const selector = generateSelector(clickedEl);
      if (lastHighlightedElement) lastHighlightedElement.style.outline = '';
      clickedEl.style.outline = '3px solid #28a745'; // Success green

      setTimeout(() => {
        cleanup();
        // Send the result back to the background script
        chrome.runtime.sendMessage({ action: 'elementSelected', selector: selector });
      }, 300);
    }
  };
  
  const keydownHandler = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      cleanup();
      // Optionally, notify the background script of cancellation
      chrome.runtime.sendMessage({ action: 'selectionCancelled' });
    }
    if (isMulti && e.key === 'Enter') {
      if (selectedElements.length > 0) {
        const selectors = selectedElements.map(generateSelector);
        cleanup();
        // Send the result back to the background script
        chrome.runtime.sendMessage({ action: 'elementSelected', selectors: selectors });
      } else {
        cleanup();
        // Optionally, notify of no selection
        chrome.runtime.sendMessage({ action: 'selectionCancelled', reason: 'No elements selected.' });
      }
    }
  };

  document.addEventListener('mouseover', mouseoverHandler);
  document.addEventListener('mouseout', mouseoutHandler);
  document.addEventListener('click', clickHandler, true);
  document.addEventListener('keydown', keydownHandler, true);
}

function escapeCssSelector(str) {
  // Escape common CSS selector special characters, especially ':' for Tailwind CSS
  return str.replace(/([.:])/g, '\\$1');
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
        // let sibling = currentEl;
        // let nth = 1;
        // while (sibling = sibling.previousElementSibling) {
        //     if (sibling.tagName === currentEl.tagName) {
        //         nth++;
        //     }
        // }
        // part += `:nth-of-type(${nth})`;


        parts.unshift(part);
        currentEl = currentEl.parentElement;
    }

    return parts.join(' > ');
}

