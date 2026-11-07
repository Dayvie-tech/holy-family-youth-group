(() => {
  const button = document.getElementById('install-app-button');
  if (!button) return;

  let installPrompt = null;
  const isInstalled = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  function hideInstallButton() {
    button.hidden = true;
  }

  if (isInstalled()) {
    hideInstallButton();
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    button.textContent = 'Install App ↓';
    button.setAttribute('aria-label', 'Install Holy Family Youth Group app');
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    hideInstallButton();
  });

  button.addEventListener('click', async () => {
    if (isInstalled()) {
      hideInstallButton();
      return;
    }

    if (!installPrompt) {
      window.alert(
        'To install Holy Family Youth Group:\n\n' +
        '1. Open this website in Chrome.\n' +
        '2. Tap the three dots (⋮).\n' +
        '3. Choose “Save and share”.\n' +
        '4. Tap “Install and create shortcut”.\n' +
        '5. Confirm the installation.'
      );
      return;
    }

    button.disabled = true;
    try {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      installPrompt = null;
      if (choice?.outcome === 'accepted') {
        button.textContent = 'Installing…';
      } else {
        button.textContent = 'Install App ↓';
      }
    } catch (error) {
      console.warn('The install prompt could not be opened:', error);
      window.alert('Chrome could not open the install prompt. Please use the browser menu: Save and share → Install and create shortcut.');
    } finally {
      button.disabled = false;
    }
  });

  // If the app is installed in another tab, update this page when it becomes visible again.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isInstalled()) hideInstallButton();
  });
})();
