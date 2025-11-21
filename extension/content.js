// Listen for manual trigger
window.addEventListener("fakeFiller:run", doFakeFill);
window.addEventListener("fakeFiller:smartFill", doSmartFill);

let smartFillSession = null;

// Auto-run if enabled
window.addEventListener('load', () => {
  chrome.storage.sync.get(["autoRun"], (result) => {
    if (result.autoRun) {
      setTimeout(doFakeFill, 500);
    }
  });
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
  smartFillSession = {
    stopRequested: false,
    totalSteps: 0,
    completedSteps: 0,
  };

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
      background: rgba(0,0,0,0.5);
    }
    .overlay-card {
      background: #fff;
      border-radius: 16px;
      padding: 20px;
      max-width: 360px;
      width: 100%;
      box-shadow: 0 14px 38px rgba(0,0,0,0.35);
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      text-align: left;
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
      color: #2c0d67;
    }
    .overlay-detail {
      font-size: 0.85em;
      color: #3b3b3b;
    }
    .overlay-status {
      font-size: 1em;
      font-weight: 600;
      color: #0f1d38;
      margin-bottom: 12px;
    }
    .overlay-history {
      list-style: none;
      padding: 0;
      margin: 12px 0 0 0;
      max-height: 160px;
      overflow-y: auto;
      border-top: 1px solid #eceef2;
      padding-top: 8px;
    }
    .overlay-history li {
      margin-bottom: 6px;
      font-size: 0.85em;
      color: #222;
    }
    .progress-bar {
      width: 100%;
      height: 6px;
      background: #eceef2;
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 12px;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(135deg, #7b2ce0, #e23c99);
      transition: width 0.2s ease;
      width: 0;
    }
    .overlay-stop-button {
      background: #ff4d60;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 6px 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s ease;
    }
    .overlay-stop-button:hover {
      background: #d43a4c;
    }
  `;
  document.body.appendChild(style);
  document.body.appendChild(overlay);
  const stopButton = overlay.querySelector(".overlay-stop-button");
  stopButton.addEventListener("click", () => {
    if (smartFillSession) {
      smartFillSession.stopRequested = true;
      updateProgressOverlay("Cancellation requested", "Tunggu sampai AI berhenti");
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
  smartFillSession = null;
}

function startHistoryEntry(questionText) {
  if (!smartFillSession) return;
  smartFillSession.currentEntry = {
    formName: document.title || window.location.hostname,
    formUrl: window.location.href,
    question: questionText,
    answer: "",
    status: "pending",
    timestamp: Date.now(),
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
 * Fills forms intelligently using Gemini AI.
 */
async function doSmartFill() {
  console.log("--- Smart Fill Initialized ---");
  createProgressOverlay();
  let encounteredError = null;
  const formName = document.title || (window.location.hostname + window.location.pathname);

  const isGForm = window.location.hostname === 'docs.google.com' && window.location.pathname.includes('/forms/');
  if (!isGForm) {
    alert("Smart Fill currently only works on Google Forms.");
    console.warn("Smart Fill aborted: Not a Google Form.");
    removeProgressOverlay();
    return;
  }

  const questions = document.querySelectorAll('div[role="listitem"]');
  console.log(`Found ${questions.length} question items.`);
  smartFillSession.totalSteps = questions.length;

    for (const [index, q] of questions.entries()) {
      console.log(`\n--- Processing Question ${index + 1} ---`);
      updateProgressOverlay(
        `Reading question ${index + 1}/${questions.length}`,
        q.querySelector('div[role="heading"]')?.textContent?.trim() || "No label detected"
      );
        const questionText = (q.querySelector('div[role="heading"]')?.textContent || '').trim();
    if (!questionText) {
      console.warn("Could not find question text for this item. Skipping.");
      continue;
    }
    startHistoryEntry(questionText);
    console.log(`Question Text: "${questionText}"`);

        try {
          // Handle multiple choice and checkboxes
      const choices = q.querySelectorAll('div[role="radio"], div[role="checkbox"]');
        if (choices.length > 0) {
        const choiceLabels = Array.from(choices).map(c => c.getAttribute('aria-label') || c.textContent).filter(Boolean);
        smartFillSession.currentEntry.events = [];
          if (choiceLabels.length === 0) {
            console.warn("Found choices but could not extract any labels. Skipping.");
            continue;
        }
        console.log("Detected Choices:", choiceLabels);
        
        const prompt = `Question: "${questionText}"\nOptions: [${choiceLabels.join(", ")}]\n\nFrom the options, which is the most likely correct answer? Respond with only the exact text of the best option. Do not add any explanation.`;
        console.log("Sending Prompt to Background:", prompt);
        updateProgressOverlay("Consulting AI provider...", choiceLabels.join(", "));

        if (smartFillSession?.stopRequested) {
          updateProgressOverlay("Stopped", "Pengisian dihentikan oleh pengguna.");
          break;
        }
        const aiAnswer = await getAiResponse(prompt);
        updateProgressOverlay("Giving AI response...", aiAnswer);
        console.log(`AI Answer Received: "${aiAnswer}"`);
        
        const targetChoice = Array.from(choices).find(c => {
          const label = (c.getAttribute('aria-label') || c.textContent);
          // A more robust check: see if the AI answer is a substring of the option label, or vice-versa.
          return label && (label.toLowerCase().includes(aiAnswer.toLowerCase()) || aiAnswer.toLowerCase().includes(label.toLowerCase()));
        });

        if (targetChoice) {
          console.log(`Match found! Clicking choice: "${targetChoice.getAttribute('aria-label') || targetChoice.textContent}"`);
          const matchedLabel = (targetChoice.getAttribute('aria-label') || targetChoice.textContent || '').trim();
          targetChoice.click();
          finalizeHistoryEntry("answered (choice)", matchedLabel || aiAnswer);
        } else {
          console.warn(`AI answer "${aiAnswer}" did not clearly match any option.`);
          console.log("Available options:", choiceLabels);
          finalizeHistoryEntry("no match", aiAnswer);
        }
      }
      // Handle text input
      else {
        const textInput = q.querySelector('input[type="text"], textarea');
        if (textInput) {
           console.log("Detected Text Input field.");
           const prompt = `Provide a concise and appropriate answer for the following question: "${questionText}"`;
           console.log("Sending Prompt to Background:", prompt);
           updateProgressOverlay("Analyzing The Answer...", questionText);
          const aiResponse = await getAiResponse(prompt);
          updateProgressOverlay("Typing AI answer...", aiResponse);
          console.log(`AI Answer Received: "${aiResponse}"`);
          textInput.value = aiResponse;
          textInput.dispatchEvent(new Event('input', { bubbles: true }));
          saveSmartFillHistory({
            formName,
            question: questionText,
            answer: aiResponse,
            status: "answered (text input)",
            formUrl: window.location.href,
          });
          finalizeHistoryEntry("answered (text input)", aiResponse);
        }
      }
      smartFillSession.completedSteps = index + 1;
      updateProgressBar((index + 1) / Math.max(1, smartFillSession.totalSteps));
      if (smartFillSession?.stopRequested) break;
        } catch (error) {
      encounteredError = error;
      console.error("Error during Smart Fill for this question:", error);
      updateProgressOverlay("Error", error.message);
      finalizeHistoryEntry("error", smartFillSession?.currentEntry?.answer || "");
      alert(`An error occurred while using the AI provider: ${error.message}`);
      break; 
    }
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between questions
    }
  console.log("--- Smart Fill Completed ---");
  if (!encounteredError && !(smartFillSession && smartFillSession.stopRequested)) {
    updateProgressOverlay("Smart fill complete", "Smart form filling completed!");
    updateProgressBar(1);
    setTimeout(removeProgressOverlay, 600);
  } else {
    setTimeout(removeProgressOverlay, 1500);
  }
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
