// Popup (index.html): search, Create tab, project editor details and schedules.
module.exports = async ({ js, click, check, report, shot, sleep }) => {
  // The search box filters the list; Chromium closes the typing undo group whenever a
  // keystroke removes rows, so "demo" (2 rows -> 1 on the first key) takes 2 undos.
  await check('popup search (textarea)', '.search-input', 'demo', 2);
  await shot('popup-search.png');
  await click('.mode-tab', 'Create');
  await check('popup create name (input)', '.create-container input', 'myproj');
  await click('.mode-tab', 'Search');
  await js(`document.querySelector('.project-item').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))`);
  await sleep(600);
  await check('editor name (input, prefilled)', '.editor-panel input[type=text]', ' Alpha');
  await check('editor description (input, prefilled)', '.editor-panel input[placeholder="What is this project for?"]', ' notes');
  await click('.editor-panel button', 'Add variable');
  await check('editor env var name (input)', '.env-var-name', 'FOO');
  await check('editor env var value (input)', '.env-var-value', 'bar');
  await shot('editor-details.png');
  await click('.editor-tab', 'Schedules');
  await click('.add-schedule-btn');
  await check('schedule description (textarea)', '.nl-input-row textarea', 'every weekday');
  await shot('schedule-describe.png');
  // Interpret fills the form from the (stubbed) parse; Edit Details mounts the prompt
  // textarea with a value the app set, which must show and then undo back to it.
  await click('.interpret-btn');
  await sleep(300);
  await click('.schedule-form button', 'Edit Details');
  const filled = await js(`document.querySelector('.schedule-form textarea').value`);
  report(filled === 'Check for security issues', `schedule prompt prefilled by Interpret (textarea mount) | value=${JSON.stringify(filled)}`);
  await check('schedule prompt (textarea, prefilled)', '.schedule-form textarea', ' daily');
  // Cancel unmounts the form; reopening must start empty again.
  await click('.schedule-form button', 'Cancel');
  await click('.add-schedule-btn');
  const after = await js(`document.querySelector('.nl-input-row textarea').value`);
  report(after === '', `schedule description empty after Cancel and reopen (remount) | value=${JSON.stringify(after)}`);
  await click('.schedule-form button', 'Manual Entry');
  await check('schedule name (input)', '.schedule-form input[type=text]', 'Daily');
  await check('schedule prompt (textarea)', '.schedule-form textarea', 'run tests');
};
