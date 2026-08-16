const handleMessage = request => {
  if (!request) {
    console.log('Received undefined message');
    return;
  }

  if (request.action === 'customCommitMessageUpdated') {
    chrome.storage.local.set({ custom_commit_message: request.message });
  }
};

chrome.runtime.onMessage.addListener(handleMessage);
