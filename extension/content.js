// Listen for manual trigger
window.addEventListener("fakeFiller:run", doFakeFill);
window.addEventListener("fakeFiller:smartFill", doSmartFill);

let smartFillSession = null;
let answerToastTimer = null;
let kahootHighlightedOption = null;

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
 * Fills forms intelligently using Gemini AI.
 */
async function doSmartFill() {
  console.log("--- Smart Fill Initialized ---");
  createProgressOverlay();
  let encounteredError = null;

  const host = window.location.hostname;
  const isGForm = host === 'docs.google.com' && window.location.pathname.includes('/forms/');
  const isWayground = host.includes('wayground.com');
  const isQuizziz = host.includes('quizziz.com');
  const isKahoot = host.includes('kahoot.it') || host.includes('play.kahoot.it');

  if (!isGForm && !isWayground && !isQuizziz && !isKahoot) {
    alert("Smart Fill currently supports Google Forms, wayground.com, quizziz.com, and kahoot.it.");
    console.warn("Smart Fill aborted: Unsupported host.");
    removeProgressOverlay();
    return;
  }

  try {
    if (isGForm) {
      await handleGoogleForms();
    } else {
      await handleQuizPlatforms(host);
    }
  } catch (error) {
    encounteredError = error;
    console.error("Error during Smart Fill:", error);
    updateProgressOverlay("Error", error.message);
    finalizeHistoryEntry("error", smartFillSession?.currentEntry?.answer || "");
    alert(`An error occurred while using the AI provider: ${error.message}`);
  } finally {
    console.log("--- Smart Fill Completed ---");
    if (!encounteredError && !(smartFillSession && smartFillSession.stopRequested)) {
      updateProgressOverlay("Smart fill complete", "Smart form filling completed!");
      updateProgressBar(1);
      setTimeout(removeProgressOverlay, 600);
    } else {
      setTimeout(removeProgressOverlay, 1500);
    }
  }
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
  startHistoryEntry(questionText);
  console.log(`Question Text: "${questionText}"`);

  try {
    await fillGoogleFormQuestion(q, questionText);
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

async function fillGoogleFormQuestion(q, questionText) {
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
  } else {
    finalizeHistoryEntry("no match", aiAnswer);
  }
  updateProgressBar(1);
}

function matchOption(options, aiAnswer) {
  const normalizedAnswer = normalizeQuizText(aiAnswer);
  if (!normalizedAnswer) return null;
  for (const option of options) {
    const normalizedLabel = normalizeQuizText(option.label);
    if (!normalizedLabel) continue;
    if (
      normalizedLabel === normalizedAnswer ||
      normalizedLabel.includes(normalizedAnswer) ||
      normalizedAnswer.includes(normalizedLabel)
    ) {
      return option;
    }
  }

  const answerTokens = normalizedAnswer.split(/\s+/).filter(Boolean);
  if (answerTokens.length > 1) {
    for (const option of options) {
      const normalizedLabel = normalizeQuizText(option.label);
      if (!normalizedLabel) continue;
      if (answerTokens.every(token => normalizedLabel.includes(token))) {
        return option;
      }
    }
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
      outline: 4px solid #ffffffff !important;
      box-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
      border-radius: 16px;
      position: relative;
    }
    .fake-filler-toast {
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translate(-50%, 20px);
      background: #2c0d67;
      color: #fff;
      padding: 12px 18px;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 600;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
      z-index: 2147483647;
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
