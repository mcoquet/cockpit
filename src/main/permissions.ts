import { execFileSync } from 'child_process';

export type PermissionType = 'calendar' | 'reminders' | 'automation';

/**
 * Request a specific permission by triggering its access prompt.
 * Returns true if permission was already granted or user approved.
 */
export async function requestPermission(type: PermissionType): Promise<boolean> {
  try {
    switch (type) {
      case 'calendar':
        // Trigger calendar permission prompt via AppleScript
        execFileSync('osascript', ['-e', 'tell application "Calendar" to calendars'], {
          timeout: 10000,
        });
        return true;

      case 'reminders':
        // Trigger reminders permission prompt via AppleScript
        execFileSync('osascript', ['-e', 'tell application "Reminders" to lists'], {
          timeout: 10000,
        });
        return true;

      case 'automation':
        // Trigger automation permission prompt via System Events
        execFileSync('osascript', ['-e', 'tell application "System Events" to get name of first process'], {
          timeout: 10000,
        });
        return true;

      default:
        return false;
    }
  } catch {
    // User denied or error occurred
    return false;
  }
}

/**
 * Request multiple permissions at once.
 * Shows prompts sequentially for any not yet granted.
 */
export async function requestPermissions(types: PermissionType[]): Promise<Record<PermissionType, boolean>> {
  const results: Record<string, boolean> = {};

  for (const type of types) {
    results[type] = await requestPermission(type);
  }

  return results as Record<PermissionType, boolean>;
}
