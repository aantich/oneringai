/**
 * Browser Automation Tools
 *
 * Tool definitions for browser automation. These tools allow agents to
 * navigate websites, extract content, interact with elements, and take screenshots.
 *
 * Phase 1: browser_navigate (fully implemented)
 * Phase 3+: Content extraction, interaction tools (placeholders)
 */

import type { ToolFunction } from 'oneringai';
import type { BrowserService } from '../BrowserService.js';
import type { NavigateOptions, ContentFormat, GetContentOptions, CookieData, ConsoleReadOptions } from './types.js';

/**
 * Dynamic UI content for browser element
 */
export interface BrowserDynamicUIContent {
  type: 'display';
  title: string;
  elements: Array<{
    type: 'browser';
    id: string;
    instanceId: string;
    showUrlBar?: boolean;
    showNavButtons?: boolean;
    currentUrl?: string;
    pageTitle?: string;
    isLoading?: boolean;
  }>;
}

/**
 * Callback type for emitting Dynamic UI content
 */
export type DynamicUIEmitCallback = (content: BrowserDynamicUIContent) => void;

/**
 * Create browser automation tools bound to a BrowserService instance
 *
 * NOTE: Dynamic UI emission is now handled by HoseaUIPlugin via the tool execution pipeline.
 * The plugin intercepts browser tool results and emits UI content automatically.
 *
 * @param browserService - The BrowserService instance to use
 * @param getInstanceId - Function to get the current agent instance ID
 * @returns Array of ToolFunction definitions
 */
export function createBrowserTools(
  browserService: BrowserService,
  getInstanceId: () => string
): ToolFunction[] {
  return [
    // ============ Phase 1: Navigation (Fully Implemented) ============

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_navigate',
          description:
            'Navigate to a URL in the browser. This is the FIRST tool to call when you need to visit a website. Opens a browser window and loads the webpage. Use this to: visit websites, open web applications, go to specific pages. After navigation, use browser_get_content to read the page or browser_find_elements to discover interactive elements. Returns the final URL (after any redirects), page title, and load time.',
          parameters: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The URL to navigate to. Can be a full URL (https://example.com) or just a domain (example.com) - https will be added automatically.',
              },
              waitUntil: {
                type: 'string',
                enum: ['load', 'domcontentloaded', 'networkidle'],
                description:
                  'When to consider navigation complete. "load" (default) waits for full page load including images/styles, "domcontentloaded" waits only for HTML to be parsed (faster), "networkidle" waits for network to be idle (best for SPAs/dynamic sites).',
              },
              timeout: {
                type: 'number',
                description: 'Maximum time to wait in milliseconds. Default: 30000 (30 seconds). Increase for slow sites.',
              },
            },
            required: ['url'],
          },
        },
      },
      execute: async (args: { url: string; waitUntil?: string; timeout?: number }) => {
        const instanceId = getInstanceId();
        const options: NavigateOptions = {
          waitUntil: args.waitUntil as 'load' | 'domcontentloaded' | 'networkidle',
          timeout: args.timeout,
        };

        const result = await browserService.navigate(instanceId, args.url, options);

        // NOTE: Dynamic UI emission is now handled by HoseaUIPlugin via the execution pipeline.
        // The plugin intercepts this result and emits UI content automatically.

        if (result.success) {
          const response: Record<string, unknown> = {
            success: true,
            url: result.url,
            title: result.title,
            loadTime: result.loadTime,
            message: `Successfully navigated to ${result.url} (${result.title}) in ${result.loadTime}ms`,
          };

          // Include overlay info if any were detected
          if (result.overlays && result.overlays.length > 0) {
            response.overlaysDetected = result.overlays.length;
            response.overlays = result.overlays.map((o) => ({
              type: o.type,
              selector: o.selector,
              title: o.title,
              buttons: o.buttons.map((b) => b.text).slice(0, 3),
            }));
            response.hint = 'Use browser_dismiss_overlay to close overlays. For cookie consent, use clickPrimary:true. For modals, specify buttonText or clickClose.';
          }

          return response;
        } else {
          return {
            success: false,
            error: result.error,
            message: `Failed to navigate: ${result.error}`,
          };
        }
      },
      describeCall: (args: { url: string }) => `Navigating to ${args.url}`,
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_get_state',
          description:
            'Get the current state of the browser. Use this to: check what page you are on, verify navigation succeeded, check if page is still loading, see if you can go back/forward in history. Returns current URL, page title, loading status, viewport size, and whether back/forward navigation is available. Call this when you need to confirm the current state before taking actions.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      execute: async () => {
        const instanceId = getInstanceId();
        const result = await browserService.getState(instanceId);

        if (result.success) {
          return {
            success: true,
            url: result.url,
            title: result.title,
            isLoading: result.isLoading,
            canGoBack: result.canGoBack,
            canGoForward: result.canGoForward,
            viewport: result.viewport,
          };
        } else {
          return {
            success: false,
            error: result.error,
          };
        }
      },
      describeCall: () => 'Getting browser state',
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_go_back',
          description:
            'Navigate back to the previous page in browser history, like clicking the browser back button. Use this when you need to return to a previous page after clicking a link or submitting a form. Only works if there is history to go back to (check browser_get_state canGoBack first if unsure).',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      execute: async () => {
        const instanceId = getInstanceId();
        const result = await browserService.goBack(instanceId);
        return result;
      },
      describeCall: () => 'Going back in browser history',
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_go_forward',
          description:
            'Navigate forward to the next page in browser history, like clicking the browser forward button. Only works if you previously went back and there is history to go forward to (check browser_get_state canGoForward first if unsure).',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      execute: async () => {
        const instanceId = getInstanceId();
        const result = await browserService.goForward(instanceId);
        return result;
      },
      describeCall: () => 'Going forward in browser history',
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_reload',
          description:
            'Reload/refresh the current page, like pressing F5 or clicking the refresh button. Use this when: the page content may have changed, you need to reset the page state, or after making changes that require a refresh to take effect.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      execute: async () => {
        const instanceId = getInstanceId();
        const result = await browserService.reload(instanceId);
        return result;
      },
      describeCall: () => 'Reloading page',
    },

    // ============ Phase 3: Content Extraction (Placeholder) ============

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_get_content',
          description:
            'Extract and read content from the current page. This is the PRIMARY tool for reading what is on a webpage. Use this AFTER navigating to read articles, get page text, extract data, or understand page structure. Format options: "markdown" (best for reading articles/docs - preserves headings, lists, links), "text" (plain text only - fastest, smallest), "html" (raw HTML - for debugging), "json" (structured data with title, headings, links, forms - best for understanding page structure), "accessibility" (accessibility tree - shows interactive elements and their roles). Use selector parameter to extract only a specific section (e.g., "main", "article", "#content").',
          parameters: {
            type: 'object',
            properties: {
              format: {
                type: 'string',
                enum: ['markdown', 'text', 'html', 'json', 'accessibility'],
                description:
                  'Output format. Use "markdown" for readable content with formatting. Use "text" for plain text. Use "json" to get structured data (links, forms, headings). Use "accessibility" to understand interactive elements.',
              },
              selector: {
                type: 'string',
                description: 'CSS selector to extract only a specific section. Examples: "main", "article", "#content", ".post-body". Omit to get the whole page.',
              },
              maxLength: {
                type: 'number',
                description: 'Maximum content length in characters. Default: 100000. Reduce for large pages to avoid overwhelming context.',
              },
              includeLinks: {
                type: 'boolean',
                description: 'Include link URLs in markdown output. Default: true. Set false for cleaner reading.',
              },
              includeImages: {
                type: 'boolean',
                description: 'Include image alt text and URLs. Default: false.',
              },
            },
            required: ['format'],
          },
        },
      },
      execute: async (args: {
        format: string;
        selector?: string;
        maxLength?: number;
        includeLinks?: boolean;
        includeImages?: boolean;
      }) => {
        const instanceId = getInstanceId();
        const options: GetContentOptions = {
          format: args.format as ContentFormat,
          selector: args.selector,
          maxLength: args.maxLength,
          includeLinks: args.includeLinks,
          includeImages: args.includeImages,
        };

        const result = await browserService.getContent(instanceId, options);
        return result;
      },
      describeCall: (args: { format: string; selector?: string }) =>
        args.selector ? `Getting ${args.format} content from ${args.selector}` : `Getting page content as ${args.format}`,
    },

    // ============ Phase 4: Element Interaction (Placeholder) ============

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_click',
          description:
            'Click an element on the page. Use this to: click buttons, click links, open menus, submit forms, interact with any clickable element. You can target elements by CSS selector (e.g., "#login-btn", "button.submit", "[data-testid=search]") OR by visible text using "text=" prefix (e.g., "text=Sign In", "text=Submit", "text=Next"). The text= method is often easier when you know what the button says. Element will be scrolled into view automatically before clicking. If the click navigates to a new page, set waitForNavigation=true.',
          parameters: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description:
                  'Target element. Use CSS selector (e.g., "#submit-btn", "button.primary", "a[href*=login]") OR "text=..." for visible text (e.g., "text=Sign In", "text=Submit Order"). Text matching is case-sensitive and partial.',
              },
              button: {
                type: 'string',
                enum: ['left', 'right', 'middle'],
                description: 'Mouse button. Default: "left". Use "right" for context menus.',
              },
              clickCount: {
                type: 'number',
                description: 'Number of clicks. Use 2 for double-click (e.g., to select a word). Default: 1',
              },
              waitForNavigation: {
                type: 'boolean',
                description: 'Set to true if this click will navigate to a new page (e.g., clicking a link or submit button). Will wait for new page to load. Default: false',
              },
              timeout: {
                type: 'number',
                description: 'Max time in ms to wait for element to appear. Default: 5000. Increase for slow-loading elements.',
              },
            },
            required: ['selector'],
          },
        },
      },
      execute: async (args: {
        selector: string;
        button?: string;
        clickCount?: number;
        waitForNavigation?: boolean;
        timeout?: number;
      }) => {
        const instanceId = getInstanceId();
        const result = await browserService.click(instanceId, {
          selector: args.selector,
          button: args.button as 'left' | 'right' | 'middle',
          clickCount: args.clickCount,
          waitForNavigation: args.waitForNavigation,
          timeout: args.timeout,
        });
        return result;
      },
      describeCall: (args: { selector: string }) => `Clicking ${args.selector}`,
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_type',
          description:
            'Type text into an input field, textarea, or editable element. Use this to: fill in forms, enter search queries, type in text fields, enter login credentials. The element will be focused and scrolled into view automatically. By default, existing content is cleared before typing (set clear=false to append). Use pressEnter=true to submit the form or trigger search after typing. Common selectors: "input[name=email]", "input[type=password]", "#search", "textarea".',
          parameters: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector for the input/textarea. Examples: "input[name=username]", "#email", "input[type=search]", "textarea.comment"',
              },
              text: {
                type: 'string',
                description: 'The text to type into the field.',
              },
              clear: {
                type: 'boolean',
                description: 'Clear existing content before typing. Default: true. Set false to append to existing text.',
              },
              pressEnter: {
                type: 'boolean',
                description: 'Press Enter key after typing. Use this to submit search forms or login forms. Default: false',
              },
              delay: {
                type: 'number',
                description: 'Delay between keystrokes in ms. Use 50-100ms to simulate human typing speed, which may help avoid bot detection. Default: 0 (instant)',
              },
            },
            required: ['selector', 'text'],
          },
        },
      },
      execute: async (args: {
        selector: string;
        text: string;
        clear?: boolean;
        pressEnter?: boolean;
        delay?: number;
      }) => {
        const instanceId = getInstanceId();
        const result = await browserService.type(instanceId, {
          selector: args.selector,
          text: args.text,
          clear: args.clear,
          pressEnter: args.pressEnter,
          delay: args.delay,
        });
        return result;
      },
      describeCall: (args: { selector: string; text: string }) =>
        `Typing "${args.text.slice(0, 20)}${args.text.length > 20 ? '...' : ''}" into ${args.selector}`,
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_select',
          description:
            'Select an option from a dropdown (<select>) element. Use this for dropdown menus in forms. You can select by: visible text (label), option value attribute, or index position. This only works for native HTML <select> elements, NOT for custom JavaScript dropdowns (for those, use browser_click on the dropdown then click the option). Provide exactly one of: value, label, or index.',
          parameters: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector for the <select> element. Examples: "select[name=country]", "#state-dropdown", "select.form-control"',
              },
              value: {
                type: 'string',
                description: 'Select by the option\'s value attribute. Example: value="US" for <option value="US">United States</option>',
              },
              label: {
                type: 'string',
                description: 'Select by the visible text shown to user. Example: label="United States" for <option value="US">United States</option>. Supports partial matching.',
              },
              index: {
                type: 'number',
                description: 'Select by position (0-based). Use 0 for first option, 1 for second, etc.',
              },
            },
            required: ['selector'],
          },
        },
      },
      execute: async (args: { selector: string; value?: string; label?: string; index?: number }) => {
        const instanceId = getInstanceId();
        const result = await browserService.select(instanceId, {
          selector: args.selector,
          value: args.value,
          label: args.label,
          index: args.index,
        });
        return result;
      },
      describeCall: (args: { selector: string; value?: string; label?: string }) =>
        `Selecting ${args.label || args.value || 'option'} from ${args.selector}`,
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_find_elements',
          description:
            'Find and list elements on the page. Use this BEFORE clicking or typing when you need to discover what elements are available. Returns detailed info about each element: unique CSS selector (to use with browser_click/browser_type), tag name, text content, attributes (href, type, name, etc.), visibility, and whether it is interactive. Call with no parameters to find all interactive elements (links, buttons, inputs). Use this when: you do not know the exact selector, you want to see what buttons/links are available, you need to find a form field.',
          parameters: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector to find specific elements. Examples: "button", "a", "input", ".menu-item", "[data-testid]"',
              },
              text: {
                type: 'string',
                description: 'Find elements containing this text (case-insensitive partial match). Example: "Sign" finds elements with "Sign In", "Sign Up", etc.',
              },
              role: {
                type: 'string',
                description: 'Find by ARIA role. Examples: "button", "link", "textbox", "navigation", "menu"',
              },
              limit: {
                type: 'number',
                description: 'Maximum results to return. Default: 10. Increase if you need to see more elements.',
              },
            },
            required: [],
          },
        },
      },
      execute: async (args: { selector?: string; text?: string; role?: string; limit?: number }) => {
        const instanceId = getInstanceId();
        const result = await browserService.findElements(instanceId, {
          selector: args.selector,
          text: args.text,
          role: args.role,
          limit: args.limit,
        });
        return result;
      },
      describeCall: (args: { selector?: string; text?: string }) =>
        args.selector
          ? `Finding elements matching ${args.selector}`
          : args.text
          ? `Finding elements containing "${args.text}"`
          : 'Finding elements',
    },

    // ============ Phase 5: Navigation & Utility (Placeholder) ============

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_scroll',
          description:
            'Scroll the page or a scrollable element. Use this to: see more content below the fold, load infinite scroll content, navigate long pages, scroll to reveal lazy-loaded elements. Use "down" to scroll down one viewport height, "bottom" to jump to page end, "top" to jump to page start. For infinite scroll pages, scroll down repeatedly and use browser_get_content between scrolls to get new content. Can also scroll within a specific scrollable container using the selector parameter.',
          parameters: {
            type: 'object',
            properties: {
              direction: {
                type: 'string',
                enum: ['up', 'down', 'left', 'right', 'top', 'bottom'],
                description: 'Scroll direction. "up/down/left/right" scroll by amount. "top/bottom" jump to start/end of page.',
              },
              amount: {
                type: 'number',
                description: 'Pixels to scroll for up/down/left/right. Default: one viewport height. Use smaller values (200-500) for precise scrolling.',
              },
              selector: {
                type: 'string',
                description: 'CSS selector for a scrollable container to scroll within (e.g., ".sidebar", "#chat-messages"). Omit to scroll the main page.',
              },
              smooth: {
                type: 'boolean',
                description: 'Use smooth animated scrolling. Default: true. Set false for instant scroll.',
              },
            },
            required: ['direction'],
          },
        },
      },
      execute: async (args: {
        direction: string;
        amount?: number;
        selector?: string;
        smooth?: boolean;
      }) => {
        const instanceId = getInstanceId();
        const result = await browserService.scroll(instanceId, {
          direction: args.direction as 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom',
          amount: args.amount,
          selector: args.selector,
          smooth: args.smooth,
        });
        return result;
      },
      describeCall: (args: { direction: string }) => `Scrolling ${args.direction}`,
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_wait',
          description:
            'Wait for an element to appear/disappear or a condition to become true. Use this when: waiting for dynamic content to load, waiting for a modal/popup to appear, waiting for a loading spinner to disappear, waiting for AJAX content, waiting after an action before proceeding. Essential for single-page apps (SPAs) and dynamic websites where content loads asynchronously. Use "visible" to wait for element to appear and be visible, "hidden" to wait for loading indicator to disappear.',
          parameters: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector to wait for. Examples: ".loading" (wait for spinner), "#results" (wait for search results), ".modal" (wait for popup)',
              },
              state: {
                type: 'string',
                enum: ['visible', 'hidden', 'attached', 'detached'],
                description: '"visible": wait for element to be visible (default). "hidden": wait for element to disappear. "attached": wait for element to exist in DOM. "detached": wait for element to be removed from DOM.',
              },
              timeout: {
                type: 'number',
                description: 'Maximum wait time in ms. Default: 30000 (30s). Reduce for faster failure, increase for slow operations.',
              },
              condition: {
                type: 'string',
                description: 'JavaScript expression returning true/false. Alternative to selector. Examples: "document.title.includes(\'Success\')", "document.querySelectorAll(\'.item\').length > 5"',
              },
            },
            required: [],
          },
        },
      },
      execute: async (args: { selector?: string; state?: string; timeout?: number; condition?: string }) => {
        const instanceId = getInstanceId();
        const result = await browserService.wait(instanceId, {
          selector: args.selector,
          state: args.state as 'visible' | 'hidden' | 'attached' | 'detached',
          timeout: args.timeout,
          condition: args.condition,
        });
        return result;
      },
      describeCall: (args: { selector?: string; condition?: string }) =>
        args.selector ? `Waiting for ${args.selector}` : args.condition ? 'Waiting for condition' : 'Waiting',
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_screenshot',
          description:
            'Take a screenshot of the current page or a specific element. Use this to: capture visual state for verification, see what the page looks like, capture charts/images/visual content, debug layout issues, document current state. Returns base64-encoded image data. Use selector to capture just one element (e.g., a chart, a form, an error message). Default captures only the visible viewport; the image can be analyzed for visual content.',
          parameters: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector to capture only that element. Examples: "#chart", ".error-message", "form". Omit to capture the whole viewport.',
              },
              fullPage: {
                type: 'boolean',
                description: 'Capture entire scrollable page (not just viewport). Warning: can be very large for long pages. Default: false',
              },
              format: {
                type: 'string',
                enum: ['png', 'jpeg'],
                description: 'Image format. PNG for quality/transparency, JPEG for smaller size. Default: "png"',
              },
              quality: {
                type: 'number',
                description: 'JPEG quality 0-100 (only applies to JPEG format). Lower = smaller file. Default: 80',
              },
            },
            required: [],
          },
        },
      },
      execute: async (args: { selector?: string; fullPage?: boolean; format?: string; quality?: number }) => {
        const instanceId = getInstanceId();
        const result = await browserService.screenshot(instanceId, {
          selector: args.selector,
          fullPage: args.fullPage,
          format: args.format as 'png' | 'jpeg',
          quality: args.quality,
        });
        return result;
      },
      describeCall: (args: { selector?: string; fullPage?: boolean }) =>
        args.selector
          ? `Taking screenshot of ${args.selector}`
          : args.fullPage
          ? 'Taking full page screenshot'
          : 'Taking screenshot',
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_evaluate',
          description:
            'Execute custom JavaScript code directly in the page context. This is a POWER USER tool for when other tools are insufficient. Use this for: extracting complex data structures, interacting with JavaScript APIs on the page, triggering custom events, accessing localStorage/sessionStorage, calling page functions, complex DOM manipulations. The script runs with full access to document, window, and all page JavaScript. Return a value to get data back. WARNING: Only use when simpler tools (browser_click, browser_type, browser_get_content) cannot achieve the goal.',
          parameters: {
            type: 'object',
            properties: {
              script: {
                type: 'string',
                description:
                  'JavaScript code to execute in page context. Has access to document, window, localStorage, etc. Use return statement to get data back. Examples: "return localStorage.getItem(\'token\')", "document.querySelector(\'form\').submit()", "return Array.from(document.querySelectorAll(\'.price\')).map(e => e.textContent)"',
              },
              returnValue: {
                type: 'boolean',
                description: 'Whether to return the result of the script. Default: true. Set false for side-effect-only scripts.',
              },
            },
            required: ['script'],
          },
        },
      },
      execute: async (args: { script: string; returnValue?: boolean }) => {
        const instanceId = getInstanceId();
        const result = await browserService.evaluate(instanceId, {
          script: args.script,
          returnValue: args.returnValue,
        });
        return result;
      },
      describeCall: () => 'Executing JavaScript',
    },

    // ============ Cookie Management ============

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_export_cookies',
          description:
            'Export all cookies from the browser session for saving. Use this to: save login session for later, backup authentication state before logging out, capture cookies after successful login. Returns all cookies as JSON array that can be stored and later restored with browser_import_cookies. Useful for maintaining login state across browser sessions or sharing authenticated state.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      execute: async () => {
        const instanceId = getInstanceId();
        const result = await browserService.exportCookies(instanceId);
        if (result.success && result.cookies) {
          return {
            success: true,
            cookies: result.cookies.map((c) => ({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path,
              secure: c.secure,
              httpOnly: c.httpOnly,
              sameSite: c.sameSite,
              expirationDate: c.expirationDate,
            })),
            count: result.cookies.length,
            message: `Exported ${result.cookies.length} cookies`,
          };
        }
        return result;
      },
      describeCall: () => 'Exporting browser cookies',
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_import_cookies',
          description:
            'Import cookies into the browser session to restore authentication/login state. Use this to: restore a previously exported session, set up pre-authenticated state, bypass login by importing session cookies. Import cookies BEFORE navigating to the site for them to take effect. The cookies array should come from a previous browser_export_cookies call or be manually constructed with at minimum name, value, and domain for each cookie.',
          parameters: {
            type: 'object',
            properties: {
              cookies: {
                type: 'array',
                description: 'Array of cookie objects to import. Use output from browser_export_cookies or construct manually.',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Cookie name (required)' },
                    value: { type: 'string', description: 'Cookie value (required)' },
                    domain: { type: 'string', description: 'Cookie domain. Include leading dot for subdomains (e.g., ".example.com"). Required for cross-subdomain cookies.' },
                    path: { type: 'string', description: 'Cookie path. Default: "/"' },
                    secure: { type: 'boolean', description: 'Only send over HTTPS. Default: true' },
                    httpOnly: { type: 'boolean', description: 'Not accessible via JavaScript. Default: false' },
                    sameSite: {
                      type: 'string',
                      enum: ['unspecified', 'no_restriction', 'lax', 'strict'],
                      description: 'SameSite policy for cross-site requests',
                    },
                    expirationDate: { type: 'number', description: 'Unix timestamp (seconds) when cookie expires. Omit for session cookie.' },
                  },
                  required: ['name', 'value'],
                },
              },
            },
            required: ['cookies'],
          },
        },
      },
      execute: async (args: { cookies: CookieData[] }) => {
        const instanceId = getInstanceId();
        const result = await browserService.importCookies(instanceId, args.cookies);
        if (result.success) {
          return {
            success: true,
            imported: result.imported,
            message: `Successfully imported ${result.imported} cookies`,
          };
        }
        return result;
      },
      describeCall: (args: { cookies: CookieData[] }) => `Importing ${args.cookies?.length || 0} cookies`,
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_clear_cookies',
          description:
            'Clear all cookies from the browser session, effectively logging out of all sites. Use this to: log out of all sites at once, reset to a clean unauthenticated state, clear session before testing login flows, ensure privacy by removing tracking cookies. After clearing, you will need to log in again to access authenticated content.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      execute: async () => {
        const instanceId = getInstanceId();
        const result = await browserService.clearCookies(instanceId);
        if (result.success) {
          return {
            success: true,
            message: 'All cookies cleared successfully',
          };
        }
        return result;
      },
      describeCall: () => 'Clearing browser cookies',
    },

    // ============ Popup/Overlay Detection and Handling ============

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_detect_overlays',
          description:
            'Re-check for modal dialogs, popups, and overlays. NOTE: Overlays are automatically detected after browser_navigate - check the "overlays" field in navigate results first. Only use this tool to re-check if: a new popup appeared after clicking something, you dismissed one overlay and want to check for more, or the page content changed dynamically. Returns detected overlays with type, buttons, and selector for dismissal.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      execute: async () => {
        const instanceId = getInstanceId();
        const result = await browserService.detectOverlays(instanceId);
        if (result.success && result.overlays.length > 0) {
          return {
            success: true,
            count: result.overlays.length,
            overlays: result.overlays.map((o) => ({
              type: o.type,
              selector: o.selector,
              title: o.title,
              textPreview: o.text?.slice(0, 100),
              buttons: o.buttons,
              position: o.boundingBox,
            })),
            hint: 'Use browser_dismiss_overlay to close an overlay. Pass selector and either buttonText, clickPrimary, or clickClose.',
          };
        } else if (result.success) {
          return {
            success: true,
            count: 0,
            message: 'No overlays detected on the page',
          };
        }
        return result;
      },
      describeCall: () => 'Detecting overlays and popups',
    },

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_dismiss_overlay',
          description:
            'Dismiss/close a popup, modal, cookie consent banner, or other overlay. Use after browser_detect_overlays identifies an overlay that is blocking interaction. Can target a specific overlay by selector and choose which button to click. For cookie consent: usually use clickPrimary to accept. For modals: use buttonText to click a specific option, or clickClose to dismiss without action.',
          parameters: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector of the overlay to dismiss (from browser_detect_overlays). If not provided, will target the topmost visible overlay.',
              },
              buttonText: {
                type: 'string',
                description: 'Text of the button to click (case-insensitive partial match). Examples: "Accept", "Close", "Cancel", "Submit", "Continue".',
              },
              clickPrimary: {
                type: 'boolean',
                description: 'Click the primary/accept/confirm button. Good for accepting cookie consent or confirming dialogs.',
              },
              clickClose: {
                type: 'boolean',
                description: 'Click the close/X/dismiss button to close without taking action.',
              },
            },
            required: [],
          },
        },
      },
      execute: async (args: {
        selector?: string;
        buttonText?: string;
        clickPrimary?: boolean;
        clickClose?: boolean;
      }) => {
        const instanceId = getInstanceId();
        const result = await browserService.dismissOverlay(instanceId, args);
        if (result.success) {
          return {
            success: true,
            clicked: result.clicked,
            message: `Dismissed overlay by clicking "${result.clicked}"`,
          };
        }
        return result;
      },
      describeCall: (args: { selector?: string; buttonText?: string; clickPrimary?: boolean; clickClose?: boolean }) => {
        if (args.buttonText) return `Dismissing overlay: clicking "${args.buttonText}"`;
        if (args.clickPrimary) return 'Dismissing overlay: clicking primary button';
        if (args.clickClose) return 'Dismissing overlay: clicking close button';
        return 'Dismissing overlay';
      },
    },

    // ============ Console Access ============

    {
      definition: {
        type: 'function',
        function: {
          name: 'browser_console_read',
          description:
            'Read the browser DevTools console output. All console messages (log, warn, error, info, debug) from the page are automatically captured from the moment the browser opens — no setup needed. Call this tool at any time to see what the page has logged. Use this to: diagnose why a page is broken or not working (check for JavaScript errors/exceptions), monitor failed network requests or API calls that log errors, verify that page scripts are running correctly, read application state or debug output logged by the page, troubleshoot form submissions or interactions that silently fail, check for CORS errors or security warnings. Returns messages newest-first. Typical workflow: navigate to a page, interact with it, then call browser_console_read with level="errors" to check if anything went wrong. Use search to find specific error messages. Use clear=true to reset the buffer and only capture fresh messages from that point forward.',
          parameters: {
            type: 'object',
            properties: {
              level: {
                type: 'string',
                enum: ['all', 'errors', 'warnings', 'info'],
                description:
                  'Filter by severity level. "all" (default) shows everything including debug/verbose messages. "errors" shows only errors. "warnings" shows warnings and errors. "info" shows info, warnings, and errors.',
              },
              search: {
                type: 'string',
                description:
                  'Filter messages containing this text (case-insensitive). Examples: "404", "TypeError", "fetch", "undefined".',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of messages to return. Default: 100. Most recent messages are returned first.',
              },
              clear: {
                type: 'boolean',
                description: 'Clear the console buffer after reading. Default: false. Use true to reset and only see new messages on next read.',
              },
            },
            required: [],
          },
        },
      },
      execute: async (args: { level?: string; search?: string; limit?: number; clear?: boolean }) => {
        const instanceId = getInstanceId();
        const options: ConsoleReadOptions = {
          level: args.level as ConsoleReadOptions['level'],
          search: args.search,
          limit: args.limit,
          clear: args.clear,
        };

        const result = browserService.readConsole(instanceId, options);

        if (result.success) {
          const response: Record<string, unknown> = {
            success: true,
            messageCount: result.messages.length,
            totalBuffered: result.totalBuffered,
            messages: result.messages.map((m) => ({
              level: m.level,
              message: m.message,
              source: m.source,
              line: m.line,
              timestamp: m.timestamp,
            })),
          };

          if (result.cleared) {
            response.cleared = true;
          }

          if (result.messages.length === 0) {
            response.message = result.totalBuffered === 0
              ? 'No console messages have been logged'
              : 'No messages match the specified filters';
          }

          return response;
        }
        return result;
      },
      describeCall: (args: { level?: string; search?: string }) => {
        const parts = ['Reading console'];
        if (args.level && args.level !== 'all') parts.push(`(${args.level})`);
        if (args.search) parts.push(`matching "${args.search}"`);
        return parts.join(' ');
      },
    },

  ];
}

/**
 * Tool names for browser automation
 */
export const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_get_state',
  'browser_go_back',
  'browser_go_forward',
  'browser_reload',
  'browser_get_content',
  'browser_click',
  'browser_type',
  'browser_select',
  'browser_find_elements',
  'browser_scroll',
  'browser_wait',
  'browser_screenshot',
  'browser_evaluate',
  'browser_export_cookies',
  'browser_import_cookies',
  'browser_clear_cookies',
  'browser_detect_overlays',
  'browser_dismiss_overlay',
  'browser_console_read',
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];
