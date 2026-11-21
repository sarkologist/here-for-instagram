// Saves files for the content scripts through Firefox's download manager.
// Answers true when the download has started, or the error's message.
browser.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'download') return undefined;
  return browser.downloads
    .download({ url: msg.url, filename: msg.filename, conflictAction: 'uniquify' })
    .then(() => true, (e) => String((e && e.message) || e));
});
