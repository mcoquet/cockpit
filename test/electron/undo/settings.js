// Settings (settings.html): the global environment variables editor.
module.exports = async ({ click, check, shot }) => {
  await click('button', 'Add variable');
  await check('settings env var name (input)', '.env-var-name', 'API_URL');
  await check('settings env var value (input)', '.env-var-value', 'http://x');
  await shot('settings.png');
};
