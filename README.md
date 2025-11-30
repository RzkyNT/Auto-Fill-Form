# Gemini CLI Extension

This Chrome Extension enhances web form filling and interaction with AI capabilities, including smart form filling, custom profile creation for dynamic pages, and an integrated AI chat.

## Features

-   **AI-Powered Smart Fill:** Automatically fills web forms and quizzes with AI-generated answers.
-   **Custom Profiles:** Create custom rules for Smart Fill on complex or dynamic web pages by selecting elements hierarchy.
-   **Dynamic Input Type Handling:** Custom profiles can now automatically detect and fill various input types (text inputs, textareas, radio buttons, checkboxes, dropdowns) within question blocks.
-   **AI Chat Overlay:** An integrated chat interface to interact with an AI assistant.
-   **Copy AI Response:** Easily copy AI chat responses to your clipboard.
-   **Formatted AI Responses:** AI chat responses using `**text**` are rendered as bold.
-   **Smart Fill History:** Keeps a record of previously answered questions.
-   **Supports Specific Platforms:** Built-in support for Google Forms, Wayground, Quizziz, Kahoot, and a local CBT instance.

## Installation

1.  **Download/Clone:** Get the extension files to your local machine.
2.  **Open Chrome Extensions:** Open Chrome and navigate to `chrome://extensions`.
3.  **Enable Developer Mode:** Toggle "Developer mode" on (usually in the top right corner).
4.  **Load Unpacked:** Click on "Load unpacked" and select the directory where you saved the extension files.
5.  **Pin Extension:** Pin the extension icon to your Chrome toolbar for easy access.

## How to Use

### General Smart Fill

Navigate to a supported web page (e.g., Google Forms, Quizziz). Open the extension's popup and click the "Run AI" button. The extension will attempt to fill known form types automatically.

### Custom Profiles (Advanced)

For pages not natively supported or with complex structures, you can create a custom profile:

1.  **Start Profile Creation:**
    *   Navigate to the target webpage.
    *   Open the extension's popup and click "Create Profile".
    *   **Keep the Developer Tools Console open (`F12` > `Console` tab) during this process for debugging.**

2.  **Follow On-Screen Instructions (Crucial Steps):**

    *   **Step 1: "Click to select the main container that holds ALL questions."**
        *   Select the broadest HTML element that contains *all* the questions on the page. This is usually a `div` or `form` that wraps the entire quiz or survey content.

    *   **Step 2: "Click to select the **ENTIRE container** of ONE question, including its text AND all its answer options."**
        *   Select *one single question block*. This should be an element (e.g., `div`) that encapsulates *one complete question*, including its text and all its associated answer input fields (radio buttons, text input, etc.). This element *must be a child/descendant* of the container selected in Step 1.

    *   **Step 3: "Click to select the question TEXT within the selected question block."**
        *   *Within the question block you just selected*, click specifically on the HTML element that displays the actual text of the question. This element *must be a descendant* of the question block selected in Step 2.

    *   **Step 4: "Click to select the answer input field(s) (e.g., text input, checkboxes, dropdown). If multiple options (radio/checkbox group), click all & press Enter."**
        *   *Within the same question block*, select the input element(s) for the answer:
            *   **For Text Input/Textarea/Dropdowns:** Click on the single input field, textarea, or `select` element.
            *   **For Radio Button Groups / Checkbox Groups:** Click on *each individual* radio button or checkbox in the group. After selecting all of them, press `Enter`.
            *   **For a Single Checkbox:** Click on the checkbox itself.

3.  **Profile Saved:** Once all steps are complete, the profile will be saved for that hostname.

4.  **Run Smart Fill:** After creating the profile, click the "Run AI" button. The extension will now automatically detect and fill questions of various types within the identified question blocks.

### AI Chat

Click the "AI Chat" button in the floating overlay to open a chat window. You can interact with an AI assistant there. AI responses containing `**text**` will be displayed in bold. Each AI message also has a copy icon to easily copy its content.

## Core Functionality and Code Explanation

The extension is primarily built using JavaScript for the client-side logic and interaction with web pages, and leverages Chrome's extension APIs.

### `manifest.json`

This file defines the core metadata and permissions for the Chrome Extension. It declares:
-   **`name`, `version`, `description`**: Basic information about the extension.
-   **`permissions`**: Access to active tab (`activeTab`), local storage (`storage`), and clipboard (`clipboardWrite`).
-   **`background`**: Specifies `background.js` as the service worker.
-   **`content_scripts`**: Specifies `content.js` to be injected into web pages.
-   **`web_accessible_resources`**: Declares resources (like `vendor` libraries, `images`) that can be loaded by content scripts.
-   **`action`**: Defines the popup UI (`popup.html`).

### `background.js` (Service Worker)

Acts as the central hub, running in the background and handling long-running tasks, API calls, and state management for profile creation. It **does not have direct DOM access**.

-   **`chrome.runtime.onMessage.addListener`**: Listens for messages from `content.js` and `popup.js`.
    -   Handles AI API calls (`callAiApi`, `callChatApi`) by forwarding prompts to external AI providers (Gemini/OpenAI) and returning responses.
    -   Manages the **Profile Creation Workflow**:
        -   Maintains `profileCreationState` to track the current step (`questionContainer`, `questionBlock`, `questionText`, `answerField`).
        -   Stores selected selectors (`questionListContainerSelector`, `exampleQuestionBlockSelector`, `questionTextRelativeSelector`) and the structured `answerField` data.
        -   Sends `startSelection` messages to `content.js` to initiate element selection on the active tab.
        -   Receives `elementSelected` messages from `content.js` with either absolute or relative selectors and the detected answer field type.

### `content.js` (Content Script)

This script is injected into every web page defined in `manifest.json`. It has **full DOM access** and interacts directly with the page content.

-   **`window.addEventListener("fakeFiller:run", ...)`**: Listens for external triggers to start filling.
-   **`createTriggerOverlay()`**: Creates the floating button UI (Smart Fill, Fullscreen, Reset, Chat) on the page.
-   **`createChatOverlay()`**: Creates the AI chat interface, handling message display, user input, and copy functionality.
    -   `appendChatMessage()`: Displays messages, formats AI responses, and adds copy button for bot messages.
-   **`doSmartFill()`**: Main entry point for Smart Fill logic.
    -   Fetches `customProfiles` or uses built-in handlers (e.g., `handleGoogleForms`).
    -   Calls `handleCustomProfile` if a custom profile exists.
-   **`handleCustomProfile(profile)`**:
    -   Finds the `questionListContainer` using `profile.questionListContainer`.
    -   Finds all `questionBlock` elements within it using `questionListContainer.querySelectorAll(profile.questionBlock)`.
    -   Iterates through each `questionBlockElement` and calls `processSingleCustomProfileQuestion`.
-   **`processSingleCustomProfileQuestion(questionBlockElement, profile, index, total)`**:
    -   Finds the question text within the `questionBlockElement` using `questionBlockElement.querySelector(profile.questionText)`.
    -   **Dynamic Answer Field Detection**: Calls `getAnswerFieldAndTypeInBlock(questionBlockElement)` to dynamically identify the *actual* type of input field(s) present in the current question block (text input, radio group, checkbox, dropdown).
    -   Based on the detected type, it formulates specific AI prompts, gets answers via `getAiResponse`, and fills/clicks/selects the appropriate elements.
-   **`enterElementSelectionMode(options)`**:
    -   Activates an overlay to guide the user through element selection during profile creation.
    -   Handles `mouseover`, `mouseout`, `click`, `keydown` events to let the user select elements.
    -   Uses `generateSelector` for absolute selectors (for `questionContainer` and `questionBlock`).
    -   Uses `generateRelativeSelector` for selectors relative to an `options.relativeTo` root (for `questionText` and `answerField`).
    -   Calls `getAnswerFieldType` to infer the type of selected answer fields before sending to `background.js`.
-   **`generateSelector(el)`**: Generates a unique CSS selector for an element (absolute path from `BODY` or by ID).
-   **`generateRelativeSelector(el, rootElement)`**: Generates a CSS selector for `el` relative to a specified `rootElement`.
-   **`getAnswerFieldType(elements)`**: Infers the type of an input field or group of fields based on their HTML tag, type attributes, and roles (used during profile creation).
-   **`getAnswerFieldAndTypeInBlock(questionBlockElement)`**: Dynamically inspects a `questionBlockElement` to identify the answer input field(s) and their type (used during Smart Fill execution).
-   **`showContentToast(message, type)`**: Displays a custom toast notification on the webpage.

### `popup.html` / `popup.js`

These files define the user interface that appears when you click the extension icon. `popup.js` sends messages to `background.js` to trigger actions like starting profile creation or running Smart Fill.

### `utils.js`

Contains helper utilities, such as `FakeGen` for generating random data (used by `doFakeFillStandard`), and other general-purpose functions.

## Troubleshooting

-   **Always check the Developer Tools Console (`F12` > `Console` tab)** for error messages during profile creation or Smart Fill execution. The extension is verbose with `DEBUG:` messages which can help diagnose issues.
-   Ensure you select elements precisely as guided by the on-screen prompts during Custom Profile creation, respecting the hierarchical relationships.
-   After any code changes or updates, **always reload the extension** from `chrome://extensions`.
