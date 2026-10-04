// Service worker: a toolbar click injects probe.js (page's MAIN world, for framework introspection) and then
// content.js (isolated world). Re-clicking is fine: content.js toggles the panel when it is already there.
chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab.id
  if (tabId === undefined) return
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["probe.js"],
    })
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    })
  } catch {
    // chrome:// pages, the Web Store, PDF viewer...: nothing can be injected there.
    await chrome.action.setBadgeText({ tabId, text: "!" })
    // The tab may be gone by then.
    setTimeout(
      () => chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {}),
      2000
    )
  }
})
