import { execFile } from 'node:child_process';

// One AppleScript pass: find the frontmost app, and if it's a known browser,
// read its active tab/document URL. Returns "" for anything else. The try block
// swallows "no front window" and similar transient AppleScript errors.
const SCRIPT = `
tell application "System Events"
  set frontApp to name of first application process whose frontmost is true
end tell

set theURL to ""
try
  if frontApp is "Safari" then
    tell application "Safari" to set theURL to URL of front document
  else if frontApp is "Google Chrome" then
    tell application "Google Chrome" to set theURL to URL of active tab of front window
  else if frontApp is "Google Chrome Canary" then
    tell application "Google Chrome Canary" to set theURL to URL of active tab of front window
  else if frontApp is "Brave Browser" then
    tell application "Brave Browser" to set theURL to URL of active tab of front window
  else if frontApp is "Microsoft Edge" then
    tell application "Microsoft Edge" to set theURL to URL of active tab of front window
  else if frontApp is "Arc" then
    tell application "Arc" to set theURL to URL of active tab of front window
  end if
end try
return theURL
`;

/**
 * URL of the frontmost browser's active tab, or null if the foreground app
 * isn't a supported browser (or permission was denied). macOS only.
 *
 * Must be called *before* any Vellum window takes focus — once the capture
 * overlay is focused, Vellum becomes the frontmost app and this returns null.
 */
export function getActiveBrowserURL(): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('osascript', ['-e', SCRIPT], { timeout: 2000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const url = stdout.trim();
      resolve(url.length > 0 ? url : null);
    });
  });
}
