const API_BASE = "http://localhost:3000";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PAGE_CONTENT") {
    handlePageContent(message.payload, sender.tab?.id, message.forceAnalysis);
  }
});

async function handlePageContent(pageData, tabId, forceAnalysis = false) {
  if (!pageData || !pageData.text || !tabId) {
    console.error('Invalid page data or tab ID');
    return;
  }

  console.log('Processing page content for fact-checking...', { forceAnalysis });
  
  try {
    // Check if fact-checking is enabled (skip this check for force analysis)
    if (!forceAnalysis) {
      const { factCheckEnabled = true } = await chrome.storage.sync.get(['factCheckEnabled']);
      
      if (!factCheckEnabled) {
        console.log('Fact-checking is disabled by user');
        return;
      }
    } else {
      console.log('Force analysis - bypassing user settings');
    }

    // Use fetch with streaming instead of EventSource (which doesn't work in service workers)
    const response = await fetch('http://localhost:3000/analyze-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pageData)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            // Forward the update to the content script
            chrome.tabs.sendMessage(tabId, {
              type: 'FACTCHECK_UPDATE',
              data: data
            }).catch(err => {
              console.log('Failed to send update to content script:', err);
            });
            
            // Break when analysis is complete
            if (data.type === 'complete' || data.type === 'error') {
              return;
            }
          } catch (error) {
            console.error('Error parsing streaming data:', error);
          }
        }
      }
    }

  } catch (error) {
    console.error('Error in fact-checking process:', error);
    
    // Send error message to content script
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: 'FACTCHECK_UPDATE',
        data: {
          type: 'error',
          message: error.message || 'Connection to fact-check service failed. Make sure the backend server is running on localhost:3000'
        }
      }).catch(err => {
        console.log('Failed to send error to content script:', err);
      });
    }
  }
}

// Initialize default settings
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.set({
    factCheckEnabled: true
  });
  console.log('News Fact Checker extension installed with default settings');
});