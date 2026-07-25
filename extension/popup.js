const APP_URL = 'https://your-live-app-url.com/';

document.getElementById('openApp').addEventListener('click', () => {
  chrome.tabs.create({ url: APP_URL });
});
