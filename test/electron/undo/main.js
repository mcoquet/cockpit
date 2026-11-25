// Electron harness for #33: loads a built renderer page (dist/renderer/<page>) with a
// stubbed window.cockpit, sends real key events, and calls webContents.undo()/redo(),
// which is what the app menu's Edit > Undo/Redo roles do. Run through ./run.sh.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '../../..');
const page = process.argv[process.argv.length - 1];
const scenario = require(path.resolve(process.env.SCENARIO));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  const win = new BrowserWindow({
    width: 420, height: 640, show: true,
    webPreferences: { preload: path.join(__dirname, 'stub-preload.js'), contextIsolation: false },
  });
  await win.loadFile(path.join(root, 'dist/renderer', page));
  await sleep(500);
  win.focus();
  const wc = win.webContents;
  const js = (s) => wc.executeJavaScript(s);
  const type = async (text) => {
    for (const c of text) {
      wc.sendInputEvent({ type: 'keyDown', keyCode: c });
      wc.sendInputEvent({ type: 'char', keyCode: c });
      wc.sendInputEvent({ type: 'keyUp', keyCode: c });
      await sleep(30);
    }
    await sleep(100);
  };
  const undo = async () => { wc.undo(); await sleep(150); };
  const redo = async () => { wc.redo(); await sleep(150); };
  const shot = async (name) => {
    if (!process.env.SHOTS) return;
    fs.writeFileSync(path.join(process.env.SHOTS, name), (await wc.capturePage()).toPNG());
  };
  const click = async (sel, text) => {
    await js(`[...document.querySelectorAll(${JSON.stringify(sel)})].find(e => ${text ? `e.textContent.trim() === ${JSON.stringify(text)}` : 'true'}).click()`);
    await sleep(200);
  };
  let failed = 0;
  const report = (ok, line) => { if (!ok) failed++; console.log(`RESULT ${ok ? 'PASS' : 'FAIL'} | ${line}`); };

  // Focus a field, type, then undo until the field is back to its starting value.
  // Passes when that takes at most maxSteps undos and redo brings the text back.
  const check = async (label, sel, text, maxSteps = 1) => {
    await js(`document.querySelector(${JSON.stringify(sel)}).focus()`);
    await sleep(250);
    const val = () => js('document.activeElement.value');
    const focused = await js(`document.activeElement === document.querySelector(${JSON.stringify(sel)})`);
    const start = await val();
    await type(text);
    const typed = await val();
    let steps = 0;
    while ((await val()) !== start && steps < 20) { await undo(); steps++; }
    const undone = await val();
    for (let i = 0; i < steps; i++) await redo();
    const redone = await val();
    const ok = focused && typed === start + text && undone === start && redone === start + text && steps <= maxSteps;
    report(ok, `${label} | typed=${JSON.stringify(typed)} undoSteps=${steps} (max ${maxSteps}) afterUndo=${JSON.stringify(undone)} afterRedo=${JSON.stringify(redone)}`);
  };

  try {
    await scenario({ js, type, undo, redo, shot, click, check, report, sleep });
  } catch (e) {
    failed++;
    console.log('RESULT FAIL | scenario threw:', e);
  }
  app.exit(failed ? 1 : 0);
});
