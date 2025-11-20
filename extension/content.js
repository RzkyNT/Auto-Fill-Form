// Listen for manual trigger
window.addEventListener("fakeFiller:run", doFakeFill);
window.addEventListener("fakeFiller:smartFill", doSmartFill);

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
    console.log("Fake Filler Running (Google Form Mode)...");
    await doFakeFillGForm();
  } else {
    console.log("Fake Filler Running (Standard Mode)...");
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
 * Sends a prompt to the background service worker to call the Gemini API.
 * @param {string} prompt The prompt to send to the AI.
 * @returns {Promise<string>} A promise that resolves with the AI's answer.
 */
function getAiResponse(prompt) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "callGeminiApi", prompt }, (response) => {
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
 * Fills forms intelligently using Gemini AI.
 */
async function doSmartFill() {
  console.log("--- Smart Fill Initialized ---");

  const isGForm = window.location.hostname === 'docs.google.com' && window.location.pathname.includes('/forms/');
  if (!isGForm) {
    alert("Smart Fill currently only works on Google Forms.");
    console.warn("Smart Fill aborted: Not a Google Form.");
    return;
  }

  const questions = document.querySelectorAll('div[role="listitem"]');
  console.log(`Found ${questions.length} question items.`);

  for (const [index, q] of questions.entries()) {
    console.log(`\n--- Processing Question ${index + 1} ---`);
    const questionText = (q.querySelector('div[role="heading"]')?.textContent || '').trim();
    if (!questionText) {
      console.warn("Could not find question text for this item. Skipping.");
      continue;
    }
    console.log(`Question Text: "${questionText}"`);

    try {
      // Handle multiple choice and checkboxes
      const choices = q.querySelectorAll('div[role="radio"], div[role="checkbox"]');
      if (choices.length > 0) {
        const choiceLabels = Array.from(choices).map(c => c.getAttribute('aria-label') || c.textContent).filter(Boolean);
        if (choiceLabels.length === 0) {
          console.warn("Found choices but could not extract any labels. Skipping.");
          continue;
        }
        console.log("Detected Choices:", choiceLabels);
        
        const prompt = `Question: "${questionText}"\nOptions: [${choiceLabels.join(", ")}]\n\nFrom the options, which is the most likely correct answer? Respond with only the exact text of the best option. Do not add any explanation.`;
        console.log("Sending Prompt to Background:", prompt);

        const aiAnswer = await getAiResponse(prompt);
        console.log(`AI Answer Received: "${aiAnswer}"`);
        
        const targetChoice = Array.from(choices).find(c => {
          const label = (c.getAttribute('aria-label') || c.textContent);
          // A more robust check: see if the AI answer is a substring of the option label, or vice-versa.
          return label && (label.toLowerCase().includes(aiAnswer.toLowerCase()) || aiAnswer.toLowerCase().includes(label.toLowerCase()));
        });

        if (targetChoice) {
          console.log(`Match found! Clicking choice: "${targetChoice.getAttribute('aria-label') || targetChoice.textContent}"`);
          targetChoice.click();
        } else {
          console.warn(`AI answer "${aiAnswer}" did not clearly match any option.`);
          console.log("Available options:", choiceLabels);
        }
      }
      // Handle text input
      else {
        const textInput = q.querySelector('input[type="text"], textarea');
        if (textInput) {
           console.log("Detected Text Input field.");
           const prompt = `Provide a concise and appropriate answer for the following question: "${questionText}"`;
           console.log("Sending Prompt to Background:", prompt);
           textInput.value = await getAiResponse(prompt);
           console.log(`AI Answer Received: "${textInput.value}"`);
           textInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    } catch (error) {
      console.error("Error during Smart Fill for this question:", error);
      alert(`An error occurred while using the Gemini API: ${error.message}`);
      break; 
    }
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between questions
  }
  console.log("--- Smart Fill Completed ---");
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
