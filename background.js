chrome.action.onClicked.addListener((tab) => {
    // Inject content script into the current active tab
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['contentScript.js']
    }, () => {
      console.log('Content script injected');
    });
  });

  // Set an alarm to run every 30 days
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('fetchMedicalTerms', { periodInMinutes: 43200 }); // 30 days = 43200 minutes
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetchMedicalTerms') {
    fetchMedicalTermsAndStore();
  }
});

// Fetch medical terms and store them in chrome.storage.local
async function fetchMedicalTermsAndStore() {
  try {
    const response = await fetch('https://mdwiki.org/w/api.php?action=query&list=allpages&aplimit=1000&format=json&origin=*');
    const data = await response.json();
    const terms = data.query.allpages.map(page => page.title);

    // Store the terms in chrome.storage.local
    chrome.storage.local.set({ medicalTerms: terms }, () => {
      console.log('Medical terms updated and stored.');
    });
  } catch (error) {
    console.error('Error fetching medical terms:', error);
  }
}