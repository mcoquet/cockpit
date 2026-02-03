import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

interface SessionInfo {
  sessionId: string;
}

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function openSession(relativePath: string): Promise<SessionInfo> {
  const fullPath = escapeAppleScript(`${os.homedir()}/${relativePath}`);

  const script = `
    tell application "iTerm2"
      activate
      create window with default profile
      tell current window
        tell current session
          write text "cd \\"${fullPath}\\" && claude"
          set sessionId to id
        end tell
      end tell
      return sessionId
    end tell
  `;

  const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
  return { sessionId: stdout.trim() };
}

export async function focusSession(sessionId: string): Promise<boolean> {
  const escapedId = escapeAppleScript(sessionId);

  const script = `
    tell application "iTerm2"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if id of s is "${escapedId}" then
              select t
              select s
              set index of w to 1
              activate
              return true
            end if
          end repeat
        end repeat
      end repeat
      return false
    end tell
  `;

  const { stdout } = await execAsync(`osascript -e '${script}'`);
  return stdout.trim() === 'true';
}

export async function sessionExists(sessionId: string): Promise<boolean> {
  const escapedId = escapeAppleScript(sessionId);

  const script = `
    tell application "iTerm2"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if id of s is "${escapedId}" then
              return true
            end if
          end repeat
        end repeat
      end repeat
      return false
    end tell
  `;

  const { stdout } = await execAsync(`osascript -e '${script}'`);
  return stdout.trim() === 'true';
}
