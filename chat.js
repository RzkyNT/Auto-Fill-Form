document.addEventListener('DOMContentLoaded', () => {
  const chatContainer = document.getElementById('chat-container');
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const sendButton = chatForm.querySelector('button');
  const backButton = document.getElementById('back-button');
  const htmlRoot = document.documentElement;

  // --- Theme Application ---
  chrome.storage.local.get("themeMode", (result) => {
    const themeMode = result.themeMode || "light";
    htmlRoot.classList.toggle("light", themeMode !== "dark");
  });
  
  backButton.addEventListener('click', () => window.history.back());

  // --- Chat Logic ---
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const messageText = messageInput.value.trim();
    if (!messageText) return;

    appendMessage(messageText, 'user');
    messageInput.value = '';
    messageInput.focus();

    showLoadingIndicator();

    // Call background script to get AI response
    chrome.runtime.sendMessage({ action: "callAiApi", prompt: messageText }, (response) => {
      removeLoadingIndicator();
      if (chrome.runtime.lastError) {
        appendMessage(`Error: ${chrome.runtime.lastError.message}`, 'bot', true);
        return;
      }
      if (response.error) {
        appendMessage(response.error, 'bot', true);
      } else {
        appendMessage(response.answer, 'bot');
      }
    });
  });

  function appendMessage(text, sender, isError = false) {
    const bubble = document.createElement('div');
    bubble.classList.add('message-bubble', `${sender}-message`);
    bubble.textContent = text;
    if (isError) {
      bubble.classList.add('error');
    }
    chatContainer.appendChild(bubble);
    scrollToBottom();
  }

  function showLoadingIndicator() {
    const bubble = document.createElement('div');
    bubble.classList.add('message-bubble', 'bot-message', 'loading');
    bubble.id = 'loading-indicator';
    bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    chatContainer.appendChild(bubble);
    scrollToBottom();
  }

  function removeLoadingIndicator() {
    const indicator = document.getElementById('loading-indicator');
    if (indicator) {
      indicator.remove();
    }
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
  
  // Initial greeting
  appendMessage("Hello! I'm ready. Ask me anything.", 'bot');
});
